import type { CacheTtl, RateLimit } from '../types'

export const MINUTE_MS = 60_000

/** 黃色太亮，改用琥珀色（使用者從預覽中選定） */
export const AMBER = '#E0A526'

export function ttlToMs(ttl: CacheTtl): number {
  if (ttl === '5m') {
    return 5 * MINUTE_MS
  }
  return 60 * MINUTE_MS
}

/** 固定分鐘數：>30m 綠、>10m 黃、其餘紅 */
export function cacheColor(remainingMs: number): string {
  if (remainingMs > 30 * MINUTE_MS) {
    return 'green'
  }
  if (remainingMs > 10 * MINUTE_MS) {
    return AMBER
  }
  return 'red'
}

/** 剩下多少時間時跳 toast：1h 為 5 分鐘，短 TTL 為 1 分鐘 */
export function toastThresholdMs(ttl: CacheTtl): number {
  if (ttl === '5m') {
    return 1 * MINUTE_MS
  }
  return 5 * MINUTE_MS
}

/**
 * 事後校正 TTL：只有間隔落在 5～60 分鐘之間時，才看得出 TTL 是哪一種。
 * 一半以上的輸入來自 cache 讀取 → cache 還活著 → 1h；否則 → 5m。
 */
export function detectTtl(
  currentTtl: CacheTtl,
  gapMs: number,
  usage: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): CacheTtl {
  const isLongerThanShortTtl = gapMs > 5 * MINUTE_MS
  const isShorterThanLongTtl = gapMs < 60 * MINUTE_MS
  if (!isLongerThanShortTtl || !isShorterThanLongTtl) {
    return currentTtl
  }
  const totalInput = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (totalInput === 0) {
    return currentTtl
  }
  const isCacheHit = usage.cache_read_input_tokens * 2 >= totalInput
  if (isCacheHit) {
    return '1h'
  }
  return '5m'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 倒數用：52:07 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${pad(minutes)}:${pad(seconds)}`
}

/** 長時間用：3d4h、2h10m、15m */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) {
    return `${days}d${hours}h`
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`
  }
  return `${minutes}m`
}

export function rateLimitLabel(kind: string): string {
  if (kind === 'five_hour') {
    return '5h'
  }
  if (kind === 'seven_day') {
    return 'weekly'
  }
  return kind
}

/** 畫面上佔幾格：中日韓文字與全形符號佔 2 格，其餘佔 1 格 */
export function displayWidth(text: string): number {
  let width = 0
  for (const character of text) {
    const isWide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(character)
    if (isWide) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/** 用量顏色：<50% 綠、<80% 黃、80% 以上紅 */
export function usageColor(percentUsed: number): string {
  if (percentUsed < 50) {
    return 'green'
  }
  if (percentUsed < 80) {
    return AMBER
  }
  return 'red'
}

/** context 用量顏色：<50% 綠、<75% 琥珀、75% 以上紅 */
export function contextColor(percentUsed: number): string {
  if (percentUsed < 50) {
    return 'green'
  }
  if (percentUsed < 75) {
    return AMBER
  }
  return 'red'
}

/**
 * 從第一段開始依序放，回傳放得下幾段（至少 1 段）。
 * 放不下的後面幾段整段省略，不會切到一半，保證不超出一行。
 */
export function countFittingSegments(texts: string[], separator: string, columns: number): number {
  let width = 0
  let count = 0
  for (const text of texts) {
    let added = displayWidth(text)
    if (count > 0) {
      added += displayWidth(separator)
    }
    if (count > 0 && width + added > columns) {
      break
    }
    width += added
    count += 1
  }
  return count
}

/** 從 $.store 讀回的值要先檢查形狀，格式不對就當作沒有 */
export function parseStoredRateLimits(stored: unknown): RateLimit[] {
  if (!Array.isArray(stored)) {
    return []
  }
  const result: RateLimit[] = []
  for (const item of stored) {
    const isValid = typeof item === 'object' && item !== null
      && typeof item.kind === 'string' && typeof item.percentUsed === 'number'
    if (isValid) {
      result.push({ kind: item.kind, percentUsed: item.percentUsed, resetsAt: item.resetsAt })
    }
  }
  return result
}

/** 舊資料的重置時間已經過了：那個區間已歸零，舊的百分比不再成立 */
export function isWindowReset(resetsAt: string | undefined, now: number): boolean {
  if (resetsAt === undefined) {
    return false
  }
  return Date.parse(resetsAt) <= now
}

type HandoffEntry = { name: string; kind: string; mtimeMs: number }

function isHandoffFile(entry: HandoffEntry): boolean {
  return entry.kind === 'file' && entry.name.endsWith('.md')
}

/** 交接資料夾裡有幾個交接檔（.md） */
export function countHandoffFiles(entries: HandoffEntry[]): number {
  return entries.filter(isHandoffFile).length
}

/** 交接檔比之前多了，就回傳最新那個的檔名；沒有多就是 null（代表 /handoff 沒成功） */
export function pickNewHandoff(entries: HandoffEntry[], countBefore: number): string | null {
  const files = entries.filter(isHandoffFile)
  if (files.length <= countBefore) {
    return null
  }
  let newest = files[0]
  for (const file of files) {
    if (newest === undefined || file.mtimeMs > newest.mtimeMs) {
      newest = file
    }
  }
  if (newest === undefined) {
    return null
  }
  return newest.name
}

/** 只保留最近幾個 session 的 context 紀錄，避免存檔無限變大 */
export const SESSION_CONTEXT_LIMIT = 200

function toSessionContextMap(stored: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return result
  }
  for (const [key, item] of Object.entries(stored)) {
    if (typeof item === 'number') {
      result[key] = item
    }
  }
  return result
}

/** 讀回某個 session 上次的 context 百分比；沒存過（或格式不對）就是 null */
export function readSessionContext(stored: unknown, sessionKey: string): number | null {
  const map = toSessionContextMap(stored)
  const found = map[sessionKey]
  if (found === undefined) {
    return null
  }
  return found
}

/** 寫入某個 session 的 context 百分比，並把它移到最新；超過上限就丟掉最舊的 */
export function rememberSessionContext(stored: unknown, sessionKey: string, percent: number): Record<string, number> {
  const map = toSessionContextMap(stored)
  delete map[sessionKey]
  map[sessionKey] = percent
  const keys = Object.keys(map)
  const overflow = keys.length - SESSION_CONTEXT_LIMIT
  for (let index = 0; index < overflow; index += 1) {
    const oldestKey = keys[index]
    if (oldestKey !== undefined) {
      delete map[oldestKey]
    }
  }
  return map
}
