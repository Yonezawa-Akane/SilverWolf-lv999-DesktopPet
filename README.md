# Silver Wolf Pet · 银狼lv.999 桌宠

> ⚠️ **Fan Project Disclaimer / 粉丝项目免责声明**
>
> This is an **unofficial, non-commercial fan project**. It is **NOT** affiliated with, endorsed by, or sponsored by **miHoYo / HoYoverse / Cognosphere**.
> The character "Silver Wolf (银狼)" and all related artwork, names, and trademarks from *Honkai: Star Rail* (《崩坏：星穹铁道》) are the intellectual property of **miHoYo Co., Ltd. / HoYoverse**. All character rights belong to their respective owners.
> Image assets in this repo (`sw_*.png` etc.) are included under fair-use for non-commercial fan work. If you are a rights holder and want them removed, please open an issue — they will be taken down promptly.
> 本项目为**非营利的粉丝二创**，与米哈游 / HoYoverse 无任何关联，亦未获得其授权或背书。"银狼"角色及相关美术、名称、商标版权均归米哈游所有。如版权方希望移除相关素材，请开 issue，会立即处理。

Silver Wolf-themed AI desktop companion for Windows. Built on Electron + Anthropic Claude.

A floating desktop pet with personality, screen-aware shortcuts, conversation memory, and pomodoro support.

## Features

- **银狼 character** (Honkai: Star Rail) with full persona injected via skill distillation
- **Long-term memory** across sessions: facts / daily summaries / 180-day conversation archive / proactive cross-day greeting
- **Global screenshot hotkey** (Ctrl+Shift+\\) with 5 analysis modes: explain / translate / debug / OCR / summarize
- **Pomodoro** with floating top-right countdown panel and Silver-Wolf-voiced phase transitions
- **App launching** with 5-tier fallback strategy (StartMenu → Desktop .lnk → Desktop contains → StartMenu contains → Uninstall registry) hitting ~95% on typical Windows installs
- **Bilingual app aliases** (微信↔WeChat / QQ音乐↔QQMusic / etc.)
- **Personal task list** with AI sync — silver wolf can add/complete/list tasks via tools, manual UI also available
- **3-tab sidebar**: chat / tasks / built-in cheatsheet
- **HSR-styled floating panels**: launcher hex button, screenshot insight HUD, pomodoro overlay

## Requirements

- Windows 10 / 11 (x64)
- Node.js 18+ (for building from source)
- Anthropic API key (`sk-ant-...`) — users provide their own; not bundled

## Build

```bash
npm install
build.bat
```

Output: `dist/SilverWolfPet-vX.X.X-win-x64.zip`

The zip contains the unpacked Electron app + manuals (快速开始.txt + 使用说明书.md). End user just unzips and runs `SilverWolfPet.exe`.

## Architecture

- `main.js` — Electron main process. State persistence, PowerShell IPC handlers, window management, global shortcut, pomodoro timer.
- `sidebar.html` — primary chat UI + 3-tab system (chat/tasks/manual). Hosts the agentic Claude tool-use loop.
- `character.html` — animated 84×115 sprite in 240×140 transparent window. State machine for hover/fly/flee/job. Speech bubble panel with mood variants.
- `launcher.html` — small floating hex button to toggle sidebar.
- `helper.html` — screenshot insight modal with 5 modes (HSR menu styling).
- `pomodoro.html` — floating top-right countdown panel.
- `preload.js` — context bridge exposing IPC to renderers.
- `silver-wolf-skill-distilled.md` — sync-source for `SW_PERSONA` constant in sidebar.html.

State persisted at `%APPDATA%\silver-wolf-pet\state.json`.

## License

MIT. Fan project, not affiliated with miHoYo / HoYoverse.

Character © miHoYo · Honkai: Star Rail. AI backend © Anthropic.
