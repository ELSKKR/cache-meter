import { expect, test } from 'claude-code/testing'

import { countHandoffFiles, pickNewHandoff } from '../hooks/logic'
import { AMBER, cacheColor, contextColor, readSessionContext, rememberSessionContext, SESSION_CONTEXT_LIMIT, isWindowReset, parseStoredRateLimits, countFittingSegments, detectTtl, displayWidth, formatCountdown, MINUTE_MS, toastThresholdMs, usageColor } from '../hooks/logic'

test('顏色門檻：>30m 綠、>10m 黃、其餘紅', async () => {
  expect(cacheColor(45 * MINUTE_MS)).toBe('green')
  expect(cacheColor(30 * MINUTE_MS)).toBe(AMBER)
  expect(cacheColor(11 * MINUTE_MS)).toBe(AMBER)
  expect(cacheColor(10 * MINUTE_MS)).toBe('red')
  expect(cacheColor(4 * MINUTE_MS)).toBe('red')
})

test('toast 門檻：1h 剩 5 分鐘、短 TTL 剩 1 分鐘', async () => {
  expect(toastThresholdMs('1h')).toBe(5 * MINUTE_MS)
  expect(toastThresholdMs('5m')).toBe(1 * MINUTE_MS)
})

test('TTL 校正：只在 5～60 分鐘的間隔判斷', async () => {
  const hit = { input_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 500 }
  const miss = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000 }
  expect(detectTtl('1h', 10 * MINUTE_MS, miss)).toBe('5m')
  expect(detectTtl('5m', 10 * MINUTE_MS, hit)).toBe('1h')
  expect(detectTtl('1h', 2 * MINUTE_MS, miss)).toBe('1h')
  expect(detectTtl('1h', 90 * MINUTE_MS, miss)).toBe('1h')
})

test('倒數格式', async () => {
  expect(formatCountdown(52 * MINUTE_MS + 7000)).toBe('52:07')
})

test('用量顏色：<50% 綠、<80% 黃、80% 以上紅', async () => {
  expect(usageColor(49.9)).toBe('green')
  expect(usageColor(50)).toBe(AMBER)
  expect(usageColor(79.9)).toBe(AMBER)
  expect(usageColor(80)).toBe('red')
  expect(usageColor(105)).toBe('red')
})

test('一行寬度：最長內容的完整寬度，以及窄面板時整段省略', async () => {
  const texts = ['Cache 回覆中 (5m)', 'ctx 100%', '5h 100% (4h59m)', 'weekly 100% (6d23h)']
  const fullWidth = displayWidth(texts.join(' | '))
  expect(fullWidth).toBe(68)
  expect(countFittingSegments(texts, ' | ', fullWidth)).toBe(4)
  for (const columns of [20, 40, 60, 67]) {
    const count = countFittingSegments(texts, ' | ', columns)
    expect(displayWidth(texts.slice(0, count).join(' | ')) <= columns).toBe(true)
  }
  expect(countFittingSegments(texts, ' | ', 50)).toBe(3)
  // 面板再窄，cache 倒數也一定留著
  expect(countFittingSegments(texts, ' | ', 5)).toBe(1)
})

test('存檔的用量：格式不對就丟掉，重置時間已過就判定為已重置', async () => {
  expect(parseStoredRateLimits(undefined)).toEqual([])
  expect(parseStoredRateLimits([{ kind: 'five_hour', percentUsed: 'x' }, { kind: 'seven_day', percentUsed: 12 }]))
    .toEqual([{ kind: 'seven_day', percentUsed: 12, resetsAt: undefined }])
  expect(isWindowReset('1970-01-01T00:00:01Z', 5000)).toBe(true)
  expect(isWindowReset('2999-01-01T00:00:00Z', 5000)).toBe(false)
  expect(isWindowReset(undefined, 5000)).toBe(false)
})

test('context 顏色：<50% 綠、<75% 琥珀、75% 以上紅', async () => {
  expect(contextColor(49)).toBe('green')
  expect(contextColor(50)).toBe(AMBER)
  expect(contextColor(74)).toBe(AMBER)
  expect(contextColor(75)).toBe('red')
  expect(contextColor(120)).toBe('red')
})

test('每個 session 的 context：存了讀得回來，沒存過或格式不對是 null，超過上限丟最舊的', async () => {
  const saved = rememberSessionContext(undefined, 'a', 42)
  expect(readSessionContext(saved, 'a')).toBe(42)
  expect(readSessionContext(saved, 'b')).toBe(null)
  expect(readSessionContext('壞掉的存檔', 'a')).toBe(null)
  expect(readSessionContext({ a: '42' }, 'a')).toBe(null)
  let map: unknown = undefined
  for (let index = 0; index <= SESSION_CONTEXT_LIMIT; index += 1) {
    map = rememberSessionContext(map, 'session' + index, index)
  }
  expect(readSessionContext(map, 'session0')).toBe(null)
  expect(readSessionContext(map, 'session' + SESSION_CONTEXT_LIMIT)).toBe(SESSION_CONTEXT_LIMIT)
})

test('交接檔：只算 .md 檔；多了一個才回傳最新那個，沒多就是 null', async () => {
  const before = [
    { name: 'local_a-1-20261010.md', kind: 'file', mtimeMs: 100 },
    { name: 'probe-log.txt', kind: 'file', mtimeMs: 500 },
    { name: 'old.md', kind: 'directory', mtimeMs: 0 },
  ]
  expect(countHandoffFiles(before)).toBe(1)
  expect(pickNewHandoff(before, 1)).toBe(null)
  expect(pickNewHandoff([], 0)).toBe(null)
  const after = [...before, { name: 'local_a-2-20261010.md', kind: 'file', mtimeMs: 300 }]
  expect(pickNewHandoff(after, 1)).toBe('local_a-2-20261010.md')
})
