# Spec：context 用量與 handoff 按鈕（cache-meter 擴充）

## 名詞對照（本文件固定用法）

| 稱呼 | 指什麼 |
|---|---|
| cache-meter | 輸入框上方那一列（`~/.claude/mods/cache-meter`），顯示 cache 倒數、5h／weekly 用量 |
| 累計 token | 現在的 `in`／`out` 兩段：整個 session 所有回合加總，只增不減。本次改動後移除 |
| context 用量 | 最近一次主對話送給模型的量 ÷ 上下文視窗上限，以百分比顯示為 `ctx`。compact 或 `/clear` 後會下降 |
| 上下文視窗上限 | 模型一次能讀的 token 上限，依模型不同 |
| 交接內容 | `/handoff` 產生的一段文字，7 個欄位（見 §4.2） |
| 交接檔 | 交接內容存成的檔案，位於 `~/.claude/handoffs/` |

## 1. Objective

**目標：** 用 handoff 取代 compact。cache-meter 上看得到 context 用量，用它決定什麼時候該交接；按一顆按鈕就完成「寫交接 → 清空對話 → 用交接內容開始新對話」，送出前由使用者確認。

**使用者：** 使用者本人。

**為什麼：** compact 的時機、摘要內容、摘要結果都不由使用者控制，錯了也看不到。handoff 是自己挑時機、固定欄位、存成檔案、送出前看得到也改得了。

**拆成三個模組（已核准）：**

| 模組 id | 負責什麼 | 依賴 |
|---|---|---|
| `ctx-meter` | cache-meter 改顯示 context 用量 | — |
| `handoff-skill` | `/handoff` skill：產生交接內容並存成交接檔 | — |
| `handoff-button` | cache-meter 上的「handoff」按鈕，串起整個流程 | `handoff-skill` |

實作順序：`ctx-meter` → `handoff-skill` → `handoff-button`。

**不做（Out of scope）：**
- 交接內容自動送出（一律停在輸入框，由使用者按 Enter）
- ctx 到某個百分比時自動觸發 handoff
- 刪除或整理舊的交接檔
- 修改 session-status-panel 或其他 mod
- 交接內容放完整對話紀錄或工具輸出原文

## 2. Tech Stack

- `ctx-meter`、`handoff-button`：修改既有的 cache-meter mod，TypeScript + JSX（`hooks/register.tsx`、`hooks/logic.ts`），沿用 `turn.step`、`$.store`、`ui.render`、`Button`、`$.command.run`
- `handoff-skill`：使用者層級 skill，Markdown（`~/.claude/skills/handoff/SKILL.md`）
- 不引入任何外部套件

## 3. Commands

```
驗證 mod：   claude plugin validate C:\Users\User\.claude\mods\cache-meter
跑測試：     claude plugin test C:\Users\User\.claude\mods\cache-meter
型別檢查：   tsc -p C:\Users\User\.claude\mods\cache-meter
```

cache-meter 已列在 settings.json 的 `CLAUDE_CODE_PLUGIN_DIRS`（第 99 行），修改後要開新 session 才會載入。

## 4. 各模組規格

### 4.1 `ctx-meter`

**顯示：** `ctx 42%`，不畫進度條。5h／weekly 也同步拿掉進度條（使用者 2026-10-10 決定：加了 ctx 後 weekly 被擠掉，拿掉進度條把空間留給之後更多按鈕）。

| 範圍 | 顏色 |
|---|---|
| < 50% | `green` |
| 50% ～ < 75% | `AMBER`（`#E0A526`） |
| ≥ 75% | `red` |

**位置：** cache 倒數後面、5h／weekly 前面。面板太窄時後面的段落先被省略，ctx 要排在用量之前才不會先消失。`in`／`out` 兩段整段移除。

**計算（依 §8 查證結果修訂）：** 不自己算，直接用引擎提供的 `context`（`session.measure` 事件的 `e.context`，與 `$.session.usage().context` 同一份）：`percent` = 最近一次回應的輸入量 ÷ 模型的上下文視窗，和 Claude Code 狀態列的 `used_percentage` 是同一個數字。超過 100 顯示 100。引擎在新 session、剛 compact 後、收到第一個回應前不提供 `percent`。

**兩種情境檢查：**

| | ① 新 session，還沒輸入任何訊息 | ② 從側邊欄重新打開舊 session |
|---|---|---|
| 顯示 | 整列不出現：桌面版在新 session 送出第一則訊息前不畫這一列，改版前就是如此（使用者確認），mod 無法改變。終端機版預計顯示 `ctx --`（尚未驗證） | 讀回上次存的 context 量，顯示百分比；沒存過顯示 `ctx --` |
| 資料來源 | 引擎還沒有 `percent` | 引擎有 `percent` 就用；沒有就讀 `$.store` 新的 key `sessionContext`（按 `sessionKey` 分開存，做法同 `sessionTokens`）。舊的 `sessionTokens` 不改、不刪 |

`/clear` 後 `sessionKey` 換新，等同情境 ①，顯示 `ctx --`。

### 4.2 `handoff-skill`

**位置：** `~/.claude/skills/handoff/SKILL.md`，指令 `/handoff`。

**交接內容的 7 個欄位（依此順序）：**
1. 目標：這個任務最終要做到什麼，一兩句話
2. 目前進度：做完了什麼、做到哪一步
3. 決定與理由：選了什麼做法、為什麼
4. 試過但失敗的做法
5. 關鍵檔案：絕對路徑＋行號，每個附一句說明用途
6. 未解決的問題與下一步
7. 這次對話中使用者講過、但還沒寫進 CLAUDE.md 的偏好

**不放：** 完整對話紀錄、工具輸出原文、CLAUDE.md 已有的規則。

**存檔：** `~/.claude/handoffs/<app 編號>-<次數>-<YYYYMMDD>.md`，例如 `local_aaaaaaaa-…-3-20261010.md`。資料夾不存在就建立。存檔後讀回確認，回覆中附上檔案路徑。
- **app 編號**：桌面版側邊欄那一項的編號（`local_…`），不是紀錄檔編號。紀錄檔編號在 `/clear` 後會換新，用它的話次數永遠是 1
- **次數**：資料夾裡已有幾個同一個 app 編號開頭的交接檔，再加 1
- **app 編號怎麼取得**：環境變數 `CLAUDE_CODE_HOST_SESSION_ID`（2026-10-10 在本 session 實測為 `local_aaaaaaaa-…`）。終端機版沒有這個變數，改用 `cli-` + `CLAUDE_CODE_SESSION_ID` 前 8 碼。`/clear` 後不變（2026-10-10 實測：同一個 session /clear 前後產生 -1-、-2- 兩個檔，編號相同）

**交接內容開頭** 註明「這是從上一個 session 交接過來的內容，交接檔在 <路徑>」，讓新 session 知道可以回去讀檔。

### 4.3 `handoff-button`

**位置：** cache-meter 那一列最右側，文字「handoff」。扣寬度的方式：文字寬度 + 4 格框線 + 1 格間隔。

**流程（依 §8 Task 3 結果）：**
1. 按下 → 記下目前交接檔數量與主對話已完成的回合數 → 執行 `/handoff`
2. 等主對話的 `turn.complete` 多一次 → 檢查 `~/.claude/handoffs/` 是否多了一個 `.md`，有就讀最新那個當交接內容
3. 執行 `/clear`
4. 把交接內容**填進輸入框，不送出**
5. 使用者看過、可修改，自己按 Enter

**失敗處理：**
- `/handoff` 失敗或沒產生交接檔 → **不執行 `/clear`**，跳提示說明原因。對話保留，不會因為交接失敗而遺失
- 對話正在回覆中（`isTurnRunning`）時按下 → 不執行，跳提示「回覆中，請等回覆結束再交接」
- `/clear` 成功但填入輸入框失敗 → 跳提示，附上交接檔路徑，讓使用者自己打開複製

## 5. Code Style

沿用 cache-meter 現有風格：if/else 與完整名稱，不用三元運算子與縮寫；純邏輯放 `logic.ts`，只有 `register.tsx` 碰 `$`。

```ts
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
```

## 6. Testing Strategy

| 層級 | 內容 | 工具 |
|---|---|---|
| 單元測試 | `contextColor` 邊界（49／50／74／75）、百分比計算（含超過 100、上限為 0）、存讀 context 量（格式錯誤當作沒有） | `tests/logic.test.ts` |
| 畫面測試 | ctx 段落位置在 cache 與 5h 之間；`in`／`out` 不再出現；`ctx --` 情境；窄寬度時兩顆按鈕都保留；回覆中按 handoff 不執行 | `tests/render.test.ts` |
| skill 驗證 | 在一個真實 session 跑 `/handoff`，檢查 7 個欄位都有、交接檔存在且內容相同 | 手動，讀回檔案 |
| 實機驗證 | 顏色、按鈕位置、按鈕完整流程、兩種情境實際顯示 | **使用者看實際畫面** |

`claude plugin test` 不檢查顏色與實際外觀，外觀相關項目在使用者確認前一律標「尚未驗證」。

## 7. Boundaries

- **Always**
  - 交接內容只填進輸入框，不送出
  - `/clear` 只在交接檔已確認存在之後執行
  - 改邏輯前先寫測試；cache-meter 原有測試全數通過
  - 外觀相關改動回報時寫「尚未驗證」
  - 宣稱完成或已存檔前先讀回
- **Ask first**
  - 修改 `$.store` 已存資料的格式（`sessionTokens` 改存 context 量會影響舊資料）
  - 新增外部套件
  - 修改 cache-meter 以外的 mod
  - §8 任一技術假設驗證失敗時，要改用的替代做法
- **Never**
  - 自動送出交接內容
  - 交接失敗時仍執行 `/clear`
  - 刪除 `~/.claude/handoffs/` 裡的任何檔案
  - 在沒讀回確認前說「已修好」

## 8. Open Questions（技術假設查證結果）

依據：mod 型別定義 `.claude-plugin/types/claude-code/index.d.ts`（以下簡稱 d.ts）。「型別確認」代表 API 文件寫明可以，實機尚未驗證。

| # | 問題 | 結果 | 依據 |
|---|---|---|---|
| 1 | 上下文視窗上限從哪裡拿 | **型別確認**：`context.window`、`context.percent` 直接提供，不用寫死 | d.ts 10885–10900、11030–11037 |
| 2 | 按鈕能不能執行 skill | **型別確認**：`CommandSource` 包含使用者自己的檔案與 skill，`$.command.run` 不認得名稱時會 reject | d.ts 1864–1871、3037–3048 |
| 3 | 怎麼知道 `/handoff` 完成 | **未知**：`$.command.run` 會等 session 空閒才執行，但交給模型的指令，promise 是在模型回覆完才 resolve，還是排入後就 resolve，文件沒寫 | d.ts 3038–3043、1830 |
| 4 | 能不能用程式執行 `/clear` | **型別確認**：`/clear` 是內建指令，可用 `$.command.run` 執行。**未知**：`/clear` 之後，按鈕那段流程能不能繼續跑（`$` 是否仍有效） | d.ts 3038–3048 |
| 5 | 能不能把文字填進輸入框而不送出 | **型別確認**：`$.prompt.fill({ text, mode: 'replace' })`；有對話框擋住時回傳 `isFilled: false` | d.ts 2933–2946 |
| 6 | 交接檔名 | **使用者已決定**：`<app 編號>-<次數>-<YYYYMMDD>.md`，不用 session 名稱（見 §4.2）。**未知**：app 編號在 `/clear` 後是否不變、`/handoff` 怎麼取得它 | 使用者決定 |
| 7 | `/clear` 後 `sessionKey` 會不會換新 | **型別確認**：`startedAt` 在 `/clear` 時重新開始 | d.ts 11640–11642 |

**Task 3 實機結果（2026-10-10，`/handoff-probe` 在桌面版測試 session）：**

| 時間（UTC） | 發生的事 |
|---|---|
| 03:43:01.835 | 開始，交接檔 2 個 |
| 03:43:01.893 | `$.command.run('handoff')` **58ms 就 resolve**，交接檔仍是 2 個 → promise 是排入就 resolve，不等模型 |
| 03:43:14 | 第 3 個交接檔寫入（檔案修改時間） |
| 03:43:21.723 | 主對話 `turn.complete` |
| 03:43:23.525 | `$.command.run('clear')` resolve → `/clear` 排在 `/handoff` 的回合結束後才執行 |
| 03:43:23.538 | `prompt.fill` 成功（`isFilled=true`），使用者確認文字在輸入框且**沒有被送出** |

結論：
- 第 3 項：不能靠 `$.command.run` 的 promise 判斷完成，要等主對話的 `turn.complete`，再檢查交接檔是否多了一個
- 第 4 項：`/clear` 之後同一段流程的 `$` 仍可用，`prompt.fill` 正常
- 指令會依序排隊。但如果同時排入 `/handoff` 和 `/clear`，`/handoff` 失敗時 `/clear` 仍會執行，違反 §7「交接失敗不得 `/clear`」，所以要等確認交接檔出現後才排 `/clear`
- log 中 03:43:09、03:43:10 兩次 `session.start` 的 `startedAt` 與測試 session 無關。`$.store` 是跨 session 共用的，推測是其他 session 啟動時寫入的，不影響結論

## 9. Success Criteria

1. cache-meter 那一列不再有 `in`／`out`，改為 `ctx` 進度條，位置在 cache 倒數與 5h 之間
2. 顏色依 §4.1 門檻，單元測試涵蓋 49／50／74／75 邊界
3. 新 session、`/clear` 後顯示 `ctx --`；重新打開舊 session 顯示上次的值（有測試，並經使用者實機確認）
4. `/handoff` 產生含 7 個欄位的交接內容，存到 `~/.claude/handoffs/`，讀回內容一致
5. 按下 handoff 按鈕：交接檔存在 → `/clear` → 交接內容出現在輸入框且**沒有被送出**
6. 交接失敗時對話沒被清除（有測試）
7. 回覆中按下按鈕不執行（有測試）
8. 窄寬度時兩顆按鈕都保留，文字段落先被省略（有測試）
9. `claude plugin validate`、`claude plugin test`、`tsc -p` 全部通過
10. 顏色、按鈕位置與完整流程由使用者實機確認（在此之前標「尚未驗證」）
