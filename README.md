# cache-meter

English: A Claude Code mod that shows a one-line meter above the prompt (cache countdown, context %, 5h / weekly usage) plus a **handoff** button that runs `/handoff` → `/clear` → fills the handoff text into the prompt box. Traditional Chinese UI only for now; English is on the to-do list.

輸入框上方的一列面板：cache 倒數、context 用量 %、5h／週用量，右側有一顆 **handoff** 按鈕。

## handoff 按鈕做什麼

按下去依序：執行 `/handoff` → 等它寫完交接檔 → `/clear` → 把交接內容填進輸入框（不會自動送出，你看過再送）。

**需要搭配 [handoff-skill](https://github.com/ELSKKR/handoff-skill)**，沒裝的話按鈕會跳出「指令不存在」的提示，不會 `/clear`。
交接檔存在 `~/.claude/handoffs/`，所以這個 mod 必須放在 `~/.claude/mods/cache-meter`。

## 想要「sessions 狀態」按鈕？

見 [session-status-panel](https://github.com/ELSKKR/session-status-panel) 的 `patches/`。

## 安裝

1. 下載到 Claude Code 的 mods 資料夾：

```bash
git clone https://github.com/ELSKKR/cache-meter.git ~/.claude/mods/cache-meter
```

2. 在 `~/.claude/settings.json` 的 `CLAUDE_CODE_PLUGIN_DIRS` 加入這個資料夾路徑（會長期保留的設定，改之前請先備份）。
3. 重新開一個新 session。

驗證：`claude plugin test ~/.claude/mods/cache-meter`

## 授權

MIT
