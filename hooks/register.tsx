import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meter } from '../types'
import {
  cacheColor,
  contextColor,
  countFittingSegments,
  countHandoffFiles,
  pickNewHandoff,
  detectTtl,
  displayWidth,
  formatCountdown,
  formatDuration,
  isWindowReset,
  parseStoredRateLimits,
  readSessionContext,
  rememberSessionContext,
  rateLimitLabel,
  toastThresholdMs,
  ttlToMs,
  usageColor,
} from './logic'

const INITIAL_METER: Meter = {
  sessionKey: '',
  ttl: '1h',
  lastCacheAt: null,
  toastedFor: null,
  isTurnRunning: false,
  completedTurns: 0,
  isHandoffRunning: false,
  contextPercent: null,
  rateLimits: [],
  isUsageStale: false,
}

// 用量是帳號層級的，存在 $.store 跨 session 保留；新 session 送出第一則訊息前先顯示它
const STORE_KEY = 'lastRateLimits'
// context 百分比按 session 分開存；重新打開舊 session、引擎還沒有數字時讀回
// （舊版存的 'sessionTokens' 不再使用，也不刪）
// ponytail: 多個 session 同時寫入可能蓋掉彼此一次，下一次回應會再寫回；要完全不漏需改成每個 session 一個 key
const CONTEXT_STORE_KEY = 'sessionContext'

// 這一列最右邊的按鈕：/handoff → /clear → 把交接內容填進輸入框（不送出）
const HANDOFF_BUTTON_LABEL = 'handoff'
// 要從文字可用的寬度扣掉的格數：按鈕的文字寬度 + 終端機畫成 [ 文字 ] 的框線 4 格 + 與左邊的間隔 1 格
const BUTTONS_RESERVE = displayWidth(HANDOFF_BUTTON_LABEL) + 4 + 1
// /handoff 那一輪最多等多久；超過就放棄，不 /clear
// ponytail: 固定 15 分鐘，交接常超過這個時間再改成設定值
const HANDOFF_TIMEOUT_MS = 15 * 60_000

const meter = atom({ plugin: 'cache-meter', key: 'meter' } as const, INITIAL_METER)
const clockNow = atom({ plugin: 'cache-meter', key: 'now' } as const, 0)

/** 每秒跑一次：更新倒數，並在剩下時間低於門檻時跳一次 toast */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, clockNow, () => now)

  const current = await read($, meter)
  if (current.isTurnRunning || current.lastCacheAt === null) {
    return
  }
  if (current.toastedFor === current.lastCacheAt) {
    return
  }
  const remainingMs = current.lastCacheAt + ttlToMs(current.ttl) - now
  if (remainingMs > 0 && remainingMs <= toastThresholdMs(current.ttl)) {
    const cacheAt = current.lastCacheAt
    await update($, meter, value => ({ ...value, toastedFor: cacheAt }))
    $.ui.toast(`Cache 剩 ${formatCountdown(remainingMs)} 就過期，要接著問就趁現在`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    const sessionKey = String(usage.startedAt)
    // 引擎有數字就用；新 session 或重新打開的舊 session 還沒有回應時，讀上次存的
    let contextPercent = readSessionContext(await $.store.get(CONTEXT_STORE_KEY), sessionKey)
    if (usage.context.percent !== undefined) {
      contextPercent = usage.context.percent
    }
    await update($, meter, value => ({ ...value, sessionKey, contextPercent }))
    if (usage.rateLimits.length > 0) {
      await update($, meter, value => ({ ...value, rateLimits: usage.rateLimits, isUsageStale: false }))
    } else {
      const stored = parseStoredRateLimits(await $.store.get(STORE_KEY))
      await update($, meter, value => ({ ...value, rateLimits: stored, isUsageStale: true }))
    }
    $.clock.every(1000, () => {
      void tick($)
    })

    return next(e)
  })

  // 主對話的回合開始（子代理不會觸發 turn.start）
  on('turn.start', async ($, e, next) => {
    await update($, meter, value => ({ ...value, isTurnRunning: true }))

    return next(e)
  })

  // 每一次 API 請求：校正 TTL，並把 cache 刷新時間記下來（只看主對話）
  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const result = yield* next(e)

    if (e.agentId === undefined && result.usage !== null) {
      const usage = result.usage
      const answeredAt = await $.clock.now()
      await update($, meter, value => {
        let ttl = value.ttl
        if (value.lastCacheAt !== null) {
          ttl = detectTtl(value.ttl, sentAt - value.lastCacheAt, usage)
        }
        return { ...value, ttl, lastCacheAt: answeredAt }
      })
    }

    return result
  })

  // 主對話的回合結束：停止「回覆中」
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, meter, value => ({ ...value, isTurnRunning: false, completedTurns: value.completedTurns + 1 }))
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // context 有變動：有數字就顯示並存起來；沒有數字（例如剛 /clear 或 compact）就顯示 --
    if (e.changed.includes('context')) {
      const percent = e.context.percent
      if (percent === undefined) {
        await update($, meter, value => ({ ...value, contextPercent: null }))
      } else {
        await update($, meter, value => ({ ...value, contextPercent: percent }))
        const current = await read($, meter)
        if (current.sessionKey !== '') {
          await $.store.set(CONTEXT_STORE_KEY, rememberSessionContext(await $.store.get(CONTEXT_STORE_KEY), current.sessionKey, percent))
        }
      }
    }
    if (e.rateLimits.length > 0) {
      await update($, meter, value => ({ ...value, rateLimits: e.rateLimits, isUsageStale: false }))
      await $.store.set(STORE_KEY, e.rateLimits)
    }

    return next(e)
  })

  // 換模型時引擎會告訴我們真正的 TTL；新模型沒有 cache，倒數歸零
  on('classic.PostModelSwitch', async ($, e, next) => {
    await update($, meter, value => ({ ...value, ttl: e.cache_ttl, lastCacheAt: null }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const value = await read($, meter)
    const now = await read($, clockNow)

    let cacheText = 'Cache --'
    let cacheTextColor = 'gray'
    if (value.isTurnRunning) {
      cacheText = 'Cache 回覆中'
      cacheTextColor = 'green'
    } else if (value.lastCacheAt !== null) {
      const remainingMs = value.lastCacheAt + ttlToMs(value.ttl) - now
      if (remainingMs <= 0) {
        cacheText = 'Cache 過期'
        cacheTextColor = 'red'
      } else {
        cacheText = `Cache ${formatCountdown(remainingMs)}`
        cacheTextColor = cacheColor(remainingMs)
      }
    }
    if (value.ttl === '5m') {
      cacheText += ' (5m)'
    }

    // 一行裡的每一段：文字和顏色。第一段是 cache 倒數，一定會顯示
    const segments: { text: string; color: string; isBold: boolean; isDim: boolean }[] = []
    segments.push({ text: cacheText, color: cacheTextColor, isBold: true, isDim: false })
    // 第二段是 context 用量，排在用量前面，面板變窄時比用量晚被省略
    if (value.contextPercent === null) {
      segments.push({ text: 'ctx --', color: 'gray', isBold: false, isDim: true })
    } else {
      const shownPercent = Math.min(100, value.contextPercent)
      segments.push({
        text: `ctx ${shownPercent}%`,
        color: contextColor(value.contextPercent),
        isBold: false,
        isDim: false,
      })
    }
    if (value.rateLimits.length === 0) {
      segments.push({ text: '用量 --', color: 'gray', isBold: false, isDim: true })
    }
    for (const limit of value.rateLimits) {
      const label = rateLimitLabel(limit.kind)
      // 舊資料且已過重置時間：百分比已不成立，等第一則回應再顯示
      if (value.isUsageStale && isWindowReset(limit.resetsAt, now)) {
        segments.push({ text: `${label} --`, color: 'gray', isBold: false, isDim: true })
        continue
      }
      // 例：5h 23% (2h10m)，括號內是距離重置的時間；不畫進度條，把空間留給按鈕
      let text = `${label} ${limit.percentUsed}%`
      if (limit.resetsAt !== undefined) {
        text += ` (${formatDuration(Date.parse(limit.resetsAt) - now)})`
      }
      if (value.isUsageStale) {
        text += ' 上次'
      }
      segments.push({ text, color: usageColor(limit.percentUsed), isBold: false, isDim: value.isUsageStale })
    }

    // 依面板寬度只留放得下的段落，確保永遠只有一行；右邊的按鈕要先扣掉
    const texts = segments.map(segment => segment.text)
    const textColumns = Math.max(0, e.props.bodyColumns - BUTTONS_RESERVE)
    const shown = segments.slice(0, countFittingSegments(texts, ' | ', textColumns))

    // 帶狀區只有一個位置：cache-meter 一律在最上面，下層 mod 的內容接在下面
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" flexShrink={1}>
            {shown.map((segment, index) => {
              let separator = ''
              if (index > 0) {
                separator = ' | '
              }
              return (
                <Text key={'segment' + index} wrap="truncate">
                  <Text dimColor>{separator}</Text>
                  <Text bold={segment.isBold} dimColor={segment.isDim} color={segment.color}>{segment.text}</Text>
                </Text>
              )
            })}
          </Box>
          <Box flexDirection="row" flexShrink={0}>
            <Button
              key="handoff"
              label={HANDOFF_BUTTON_LABEL}
              dimColor
              onPress={() => {
                void runHandoff($)
              }}
            />
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}

/** 交接檔的資料夾：mod 在 ~/.claude/mods/cache-meter，往上兩層就是 ~/.claude */
function handoffsDirectory($: EngineInterface): string {
  return `${$.plugin.root}/../../handoffs`
}

async function listHandoffs($: EngineInterface): Promise<{ name: string; kind: string; mtimeMs: number }[]> {
  try {
    return await $.fs.list(handoffsDirectory($))
  } catch {
    // 資料夾還不存在：還沒有任何交接檔
    return []
  }
}

/**
 * handoff 按鈕：/handoff → 等那一輪結束、確認交接檔多了一個 → /clear → 把交接內容填進輸入框，不送出。
 * 交接檔沒出現就不 /clear，對話保留。
 */
async function runHandoff($: EngineInterface): Promise<void> {
  const current = await read($, meter)
  if (current.isTurnRunning) {
    $.ui.toast('handoff：回覆中，請等回覆結束再交接')
    return
  }
  if (current.isHandoffRunning) {
    $.ui.toast('handoff：交接進行中，請稍候')
    return
  }
  await update($, meter, value => ({ ...value, isHandoffRunning: true }))
  try {
    const countBefore = countHandoffFiles(await listHandoffs($))
    const turnsBefore = current.completedTurns
    // 這個 promise 在 /handoff 排入後就 resolve，不會等模型寫完（SPEC §8 Task 3 實測）
    await $.command.run({ command: 'handoff' })

    const startedAt = await $.clock.now()
    let isTurnDone = false
    while (!isTurnDone) {
      await $.clock.sleep(1000)
      const latest = await read($, meter)
      if (latest.completedTurns > turnsBefore) {
        isTurnDone = true
      } else if ((await $.clock.now()) - startedAt > HANDOFF_TIMEOUT_MS) {
        $.ui.toast('handoff：等了 15 分鐘還沒完成，已放棄，對話保留，沒有 /clear')
        return
      }
    }

    const newest = pickNewHandoff(await listHandoffs($), countBefore)
    if (newest === null) {
      $.ui.toast('handoff：交接檔沒有產生，對話保留，沒有 /clear')
      return
    }
    const path = `${handoffsDirectory($)}/${newest}`
    const handoffText = await $.fs.read(path)
    await $.command.run({ command: 'clear' })
    const filled = await $.prompt.fill({ text: handoffText, mode: 'replace' })
    if (!filled.isFilled) {
      $.ui.toast(`handoff：已 /clear，但填入輸入框失敗，請打開 ${path} 自己複製`)
    }
  } catch (error) {
    $.ui.toast(`handoff：失敗（${String(error)}）`)
  } finally {
    await update($, meter, value => ({ ...value, isHandoffRunning: false }))
  }
}
