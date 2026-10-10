export type CacheTtl = '5m' | '1h'

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Meter = {
  /** 這個 session 的識別：它第一次啟動的時間（重新打開舊 session 時不變，/clear 後換新） */
  sessionKey: string
  /** 目前認定的 cache 有效時間；預設 1h，由實際 cache 命中情況校正 */
  ttl: CacheTtl
  /** 主對話最後一次收到 API 回應的時間（cache 最後一次被刷新）；null 表示沒有 cache */
  lastCacheAt: number | null
  /** 已經為哪一次 lastCacheAt 跳過提醒，避免重複跳 */
  toastedFor: number | null
  isTurnRunning: boolean
  /** 主對話已完成幾個回合；handoff 按鈕用它判斷 /handoff 那一輪結束了沒 */
  completedTurns: number
  /** handoff 按鈕的流程正在跑，避免連按兩次 */
  isHandoffRunning: boolean
  /** 上下文視窗用了幾 %（引擎的 context.percent，與狀態列相同）；null 表示還沒有數字 */
  contextPercent: number | null
  rateLimits: RateLimit[]
  /** true：還沒收到這個 session 的回應，rateLimits 是上一次存下來的值 */
  isUsageStale: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-meter': { meter: Meter; now: number }
  }
}
