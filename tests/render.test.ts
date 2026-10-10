import { expect, mock, test } from 'claude-code/testing'

import type {} from '../types'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('面板一行：cache 倒數、ctx、兩個用量百分比，且畫在下層 mod 上方', async ($, on) => {
  // 測試環境沒有 $.state，用記憶體代替
  const values = new Map<string, unknown>([
    ['meter', {
      sessionKey: '1', ttl: '1h', lastCacheAt: 0, toastedFor: null, isTurnRunning: false,
      contextPercent: 80,
      rateLimits: [{ kind: 'five_hour', percentUsed: 63 }, { kind: 'seven_day', percentUsed: 85 }],
      isUsageStale: false,
    }],
    ['now', 10 * 60_000],
  ])
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: 1 } }))
  // 代替下層 mod（例如 next-steps）
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return h(Text, {}, 'beneath')
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cache-meter', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Cache 50:00$/ })).toBeDefined()
    // 50～80% 用琥珀色：確認色碼寫法被兩種介面接受，且真的套在這段文字上
    const fiveHour = await ui.find({ type: 'Text', text: /^5h 63%$/ })
    expect(fiveHour?.props.color).toBe('#E0A526')
    expect(await ui.find({ type: 'Text', text: /^weekly 85%$/ })).toBeDefined()
    // context 75% 以上用紅色；累計 token 不再顯示
    const context = await ui.find({ type: 'Text', text: /^ctx 80%$/ })
    expect(context?.props.color).toBe('red')
    expect(await ui.find({ type: 'Text', text: /^(in|out) / })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /active/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    await ui.unmount()

    // ctx 排在 5h 前面：寬度只夠放兩段時，留下的是 cache 和 ctx
    const twoSegments = await $.ui.mount({
      plugin: 'cache-meter', surface, ...BAND, props: { ...BAND.props, bodyColumns: 37 },
    })
    expect(await twoSegments.find({ type: 'Text', text: /^ctx / })).toBeDefined()
    expect(await twoSegments.find({ type: 'Text', text: /^5h / })).toBeUndefined()
    await twoSegments.unmount()
  }
})

test('新 session 還沒輸入：顯示上次存的用量並標示「上次」，已過重置時間的顯示 --', async ($, on) => {
  const values = new Map<string, unknown>([
    ['meter', {
      sessionKey: '1', ttl: '1h', lastCacheAt: null, toastedFor: null, isTurnRunning: false,
      contextPercent: null, isUsageStale: true,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 40, resetsAt: '1970-01-01T00:00:01Z' },
        { kind: 'seven_day', percentUsed: 60, resetsAt: '2999-01-01T00:00:00Z' },
      ],
    }],
    ['now', 10 * 60_000],
  ])
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: 1 } }))
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return h(Text, {}, 'beneath')
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cache-meter', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^ctx --$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h --$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^weekly 60% \(.+\) 上次$/ })).toBeDefined()
    await ui.unmount()
  }
})

const METER_FOR_BUTTON = {
  sessionKey: '1', ttl: '1h', lastCacheAt: 0, toastedFor: null, isTurnRunning: false,
  contextPercent: 80,
  rateLimits: [{ kind: 'five_hour', percentUsed: 63 }, { kind: 'seven_day', percentUsed: 85 }],
  isUsageStale: false,
}

// ---- handoff 按鈕 ----
type HandoffWorld = {
  isTurnRunning?: boolean
  isHandoffMissing?: boolean
  isHandoffWritingFile?: boolean
}

/** 假的世界：state、交接資料夾、指令、輸入框都用記憶體代替，記下發生過的事 */
function fakeWorld(on: any, world: HandoffWorld) {
  const values = new Map<string, unknown>([
    ['meter', { ...METER_FOR_BUTTON, completedTurns: 0, isHandoffRunning: false, isTurnRunning: world.isTurnRunning === true }],
    ['now', 10 * 60_000],
  ])
  const files = [{ name: 'local_a-1-20261010.md', kind: 'file', size: 1, mtimeMs: 100, isLink: false }]
  const record = { commands: [] as string[], toasts: [] as string[], filled: [] as string[] }
  // 每次寫入版本加 1，update() 的比對才會成立
  let version = 1
  on('state.get', async (_$: any, e: any) => ({ value: { value: values.get(e.key) ?? null, version } }))
  on('state.set', async (_$: any, e: any) => {
    values.set(e.key, e.value)
    version += 1
    return { value: { isSet: true, version } }
  })
  on('fs.list', async () => ({ value: [...files] }))
  on('fs.read', async () => ({ value: '交接內容' }))
  on('ui.toast', async (_$: any, e: any) => {
    record.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', async (_$: any, e: any) => {
    record.filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: 0 }
  })
  on('command.run', async (_$: any, e: any) => {
    record.commands.push(e.command)
    if (e.command === 'handoff') {
      if (world.isHandoffMissing === true) {
        throw new Error('unknown command')
      }
      if (world.isHandoffWritingFile === true) {
        files.push({ name: 'local_a-2-20261010.md', kind: 'file', size: 1, mtimeMs: 200, isLink: false })
      }
      // 模擬 /handoff 那一輪結束
      const meterValue = values.get('meter') as { completedTurns: number }
      values.set('meter', { ...meterValue, completedTurns: meterValue.completedTurns + 1 })
    }
    return { value: { text: '' } }
  })
  on('ui.render', ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return h(Text, {}, 'beneath')
  })
  // 測試用的時鐘：只有 advance 時才會前進
  const clock = mock.clock(on)
  return { record, clock }
}

/** 按下按鈕後流程是非同步的：每次讓時鐘前進 1 秒，最多 30 次，直到條件成立 */
async function waitFor(clock: any, isDone: () => boolean): Promise<void> {
  await clock.settle()
  for (let index = 0; index < 30 && !isDone(); index += 1) {
    await clock.advance(1000)
  }
}

test('handoff 按鈕：窄寬度時留著', async ($, on) => {
  fakeWorld(on, {})
  for (const surface of ['terminal', 'desktop'] as const) {
    const narrow = await $.ui.mount({ plugin: 'cache-meter', surface, ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
    expect(await narrow.find({ type: 'Button', props: { label: 'handoff' } })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /^Cache 50:00$/ })).toBeDefined()
    await narrow.unmount()
  }
})

test('handoff 按鈕：成功時 /handoff → /clear → 交接內容填進輸入框', async ($, on) => {
  const { record, clock } = fakeWorld(on, { isHandoffWritingFile: true })
  const ui = await $.ui.mount({ plugin: 'cache-meter', surface: 'desktop', ...BAND })
  await ui.press({ plugin: 'cache-meter', key: 'handoff' })
  await waitFor(clock, () => record.filled.length > 0 || record.toasts.length > 0)
  expect(record.commands).toEqual(['handoff', 'clear'])
  expect(record.filled).toEqual(['交接內容'])
  expect(record.toasts).toEqual([])
  await ui.unmount()
})

test('handoff 按鈕：交接檔沒產生 → 不 /clear，跳提示', async ($, on) => {
  const { record, clock } = fakeWorld(on, {})
  const ui = await $.ui.mount({ plugin: 'cache-meter', surface: 'desktop', ...BAND })
  await ui.press({ plugin: 'cache-meter', key: 'handoff' })
  await waitFor(clock, () => record.toasts.length > 0)
  expect(record.commands).toEqual(['handoff'])
  expect(record.filled).toEqual([])
  expect(record.toasts[0]).toMatch(/沒有產生/)
  await ui.unmount()
})

test('handoff 按鈕：/handoff 指令不存在 → 不 /clear，跳提示', async ($, on) => {
  const { record, clock } = fakeWorld(on, { isHandoffMissing: true })
  const ui = await $.ui.mount({ plugin: 'cache-meter', surface: 'desktop', ...BAND })
  await ui.press({ plugin: 'cache-meter', key: 'handoff' })
  await waitFor(clock, () => record.toasts.length > 0)
  expect(record.commands).toEqual(['handoff'])
  expect(record.toasts[0]).toMatch(/失敗/)
  await ui.unmount()
})

test('handoff 按鈕：回覆中按下 → 什麼都不執行，跳提示', async ($, on) => {
  const { record, clock } = fakeWorld(on, { isTurnRunning: true })
  const ui = await $.ui.mount({ plugin: 'cache-meter', surface: 'desktop', ...BAND })
  await ui.press({ plugin: 'cache-meter', key: 'handoff' })
  await waitFor(clock, () => record.toasts.length > 0)
  expect(record.commands).toEqual([])
  expect(record.toasts[0]).toMatch(/回覆中/)
  await ui.unmount()
})
