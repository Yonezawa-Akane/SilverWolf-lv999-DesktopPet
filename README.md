# Silver Wolf Pet · 银狼lv.999 桌宠

**Version 2.2.0** · [更新日志 / Changelog](./CHANGELOG.md)

> ⚠️ **Fan Project Disclaimer / 粉丝项目免责声明**
>
> 本项目为**非营利的粉丝二创**，与米哈游 / HoYoverse / Cognosphere **无任何关联**，亦未获得其授权或背书。"银狼"角色及《崩坏：星穹铁道》相关美术、名称、商标版权均归 **米哈游 (miHoYo Co., Ltd. / HoYoverse)** 所有。仓库内 `assets/sw_*.png` 等素材依据非营利合理使用原则收录，如版权方希望移除，请开 issue，会立即处理。
>
> This is an **unofficial, non-commercial fan project**. It is **NOT** affiliated with, endorsed by, or sponsored by **miHoYo / HoYoverse / Cognosphere**. The character "Silver Wolf (银狼)" and all related artwork, names, and trademarks from *Honkai: Star Rail* are the intellectual property of **miHoYo Co., Ltd. / HoYoverse**. Image assets in this repo (`assets/sw_*.png` etc.) are included under fair-use for non-commercial fan work. If you are a rights holder and want them removed, please open an issue — they will be taken down promptly.

**语言 / Language**: [简体中文](#-中文文档) | [English](#-english-documentation)

---

## 🇨🇳 中文文档

### 简介

银狼主题的 Windows AI 桌面伴侣 —— 基于 Electron + Anthropic Claude 打造。

一只能浮在桌面上的小狼，有完整的角色人格、屏幕感知能力、跨会话记忆、番茄钟、应用启动器，以及一堆星穹铁道风的悬浮面板。

### 功能特性

- **银狼角色**（崩坏：星穹铁道）—— 基于 GitHub 上开源的 `花火.skill` 蒸馏方案构建，完整人格通过 skill 蒸馏注入。对她而言，这世界不过是一场要打到极限通关的游戏
- **长期记忆**横跨多次会话：facts / 每日总结 / 180 天对话归档 / 跨日主动问候
- **全局截屏热键** `Ctrl+Shift+\` —— 5 种分析模式：解释 / 翻译 / 调试 / OCR / 总结
- **召回银狼热键** `Ctrl+Alt+W` —— 全屏游戏 alt-tab 后宠物 z-order 被踢看不见时，一键拉回前台并重置位置
- **番茄钟** —— 屏幕右上悬浮倒计时面板，阶段切换由银狼语音化播报
- **应用启动器** —— 五级回退策略（开始菜单 → 桌面快捷方式 → 桌面模糊匹配 → 开始菜单模糊匹配 → 卸载注册表），常见 Windows 安装下命中率 ~95%
- **中英应用别名互通**（微信 ↔ WeChat / QQ音乐 ↔ QQMusic 等）
- **个人任务清单** —— AI 工具同步：银狼可以通过工具新增/完成/列出任务，也保留手动 UI
- **三栏侧边栏**：聊天 / 任务 / 内置使用手册
- **文件转换器**（v2.1） —— 把任意支持的文件拖到 sidebar，菜单选目标格式 / 操作；输出回原目录。覆盖范围：
  - 图片互转（PNG / JPG / BMP / WebP）+ 图片 → PDF
  - PDF ↔ Word / TXT / 图片，含 ✂ 拆分（每页一个 PDF）和 ↻ 旋转 90°
  - Markdown / HTML / TXT 互转
  - Excel (XLSX/XLS) ↔ PDF / HTML / CSV
  - 多文件输出自动包文件夹
- **桌面快捷方式**（v2.1） —— 首次运行 `.exe` 弹窗询问是否创建；Launcher 右键 / 设置面板可随时切换。兼容 OneDrive 重定向桌面
- **PTT 语音输入**（v2.2） —— 全局热键说话直接发消息，本地 [SenseVoice-Small](https://github.com/FunAudioLLM/SenseVoice) 离线识别（中英粤日韩，~70ms 推理，0 网络）。两种模式：
  - 📣 **toggle**（默认，全平台稳定）：按一次开麦、再按一次结束
  - 🎙️ **hold**（按住说话，Discord 风格）：依赖 `uiohook-napi` 低级钩子，部分 Windows 配置可能不稳，可在设置面板中切换
  - 设置面板支持改 PTT / 截屏 / 召回三个全局热键的录制式自定义
  - 模型权重 ~234MB **不入库**，按 [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md) 单独下载到 `assets/models/sense-voice/`
- **银狼 lv.999 骇客风格悬浮面板**：六边形启动按钮 / 截屏洞察 HUD / 番茄钟覆层

### 系统要求

- Windows 10 / 11（x64）
- Node.js 18+（仅源码构建需要）
- Anthropic API Key（`sk-ant-...`）—— 用户自备，不内置

### 安装与构建

```bash
npm install
build.bat
```

产物：`dist/SilverWolfPet-vX.X.X-win-x64.zip`

zip 内含解压即用的 Electron 应用 + 中文使用手册（`快速开始.txt` + `使用说明书.md`）。最终用户解压后双击 `SilverWolfPet.exe` 即可启动，无需装 Node。

### 项目结构

```
.
├── main.js                          Electron 主进程
├── preload.js                       contextBridge：把 IPC 暴露给各 renderer
├── package.json / build.bat         构建入口
│
├── renderer/                        5 个窗口 HTML
│   ├── sidebar.html                 主聊天 UI + 三栏（聊天/任务/手册），Claude agentic 循环 + 文件拖放
│   ├── character.html               84×115 精灵动画 + 情绪化对话泡（240×140 透明窗口）
│   ├── launcher.html                控制侧边栏开关的六边形悬浮按钮
│   ├── helper.html                  截屏洞察模态框（5 模式 + 星穹铁道菜单风）
│   └── pomodoro.html                屏幕右上的番茄钟倒计时浮窗
│
├── services/                        文件转换（v2.1）
│   ├── converter.js                 转换路由表 + handler，纯 JS 主进程跑
│   └── pdf-render.html              隐藏 BrowserWindow，PDF.js 渲染到 canvas（PDF→图片用）
│
├── assets/                          美术资源 / 图标
│   ├── icon.ico / icon.png          应用图标（🐺 wolf emoji，多尺寸）
│   ├── sw_sheet.png                 character.html 用的 sprite sheet
│   ├── sw_side.png / sw_sprite*.png 美术原稿（不打包进 release）
│   ├── launcher_icon.png            launcher.html 用的图标
│   └── launcher_raw.png             launcher 图标原稿（gitignore）
│
├── scripts/                         构建/开发辅助
│   ├── get_windows.ps1              主进程通过 IPC 调用，枚举前台窗口
│   ├── gen_icon.py                  从 🐺 emoji 生成 assets/icon.ico + icon.png
│   ├── process_launcher_icon.py     从 launcher_raw 生成 launcher_icon
│   └── init_and_push.bat            一次性 git init + push
│
└── docs/
    ├── 使用说明书.md                  build.bat 拷入 release，由"打开手册"按钮调起
    ├── 快速开始.txt                   build.bat 拷入 release
    └── silver-wolf-skill-distilled.md sidebar.html 中 SW_PERSONA 常量的同步源
```

运行时状态持久化到 `%APPDATA%\silver-wolf-pet\state.json`。

### 许可证

MIT 许可证。详见 [LICENSE](./LICENSE)。

代码原作以 MIT 协议开源。**角色 IP 版权归米哈游所有**，MIT 协议不授予角色相关的任何 IP 权利。

### 第三方组件声明

本项目集成了多个第三方组件（npm 依赖、ASR 引擎、SenseVoice 语音模型权重等），各自保留原始协议（MIT / BSD-2-Clause / Apache-2.0 / FunASR Model License）。

**完整清单与各协议条款见** [docs/THIRD_PARTY_LICENSES.md](./docs/THIRD_PARTY_LICENSES.md)。

特别说明：语音输入功能使用 **FunAudioLLM/SenseVoice-Small** 模型，该模型采用 [FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)（非标准 OSI 协议，但允许商用与再分发）。模型权重文件请按 [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md) 单独下载。

---

## 🇬🇧 English Documentation

### Overview

Silver Wolf-themed AI desktop companion for Windows. Built on Electron + Anthropic Claude.

A floating desktop pet with full character persona, screen-aware shortcuts, cross-session memory, pomodoro timer, app launcher, and a stack of HSR-styled floating panels.

### Features

- **银狼 character** (Honkai: Star Rail) — built on the open-source `花火.skill` distillation from GitHub; full persona injected via skill distillation. To her, the world is just a game to be played to its limits
- **Long-term memory** across sessions: facts / daily summaries / 180-day conversation archive / proactive cross-day greeting
- **Global screenshot hotkey** (`Ctrl+Shift+\`) with 5 analysis modes: explain / translate / debug / OCR / summarize
- **Respawn-pet hotkey** (`Ctrl+Alt+W`) — pulls Silver Wolf back to the foreground and resets her position when fullscreen-game alt-tab demotes her z-order off-screen
- **Pomodoro** with floating top-right countdown panel and Silver-Wolf-voiced phase transitions
- **App launching** with 5-tier fallback strategy (StartMenu → Desktop `.lnk` → Desktop contains → StartMenu contains → Uninstall registry) hitting ~95% on typical Windows installs
- **Bilingual app aliases** (微信↔WeChat / QQ音乐↔QQMusic / etc.)
- **Personal task list** with AI sync — Silver Wolf can add/complete/list tasks via tools, manual UI also available
- **3-tab sidebar**: chat / tasks / built-in cheatsheet
- **File converter** (v2.1) — drop any supported file onto the sidebar; pick target format / operation from the menu; output goes back to the source directory. Coverage:
  - Image cross-conversion (PNG / JPG / BMP / WebP) + image → PDF
  - PDF ↔ Word / TXT / image, plus ✂ split (one PDF per page) and ↻ rotate 90°
  - Markdown / HTML / TXT cross-conversion
  - Excel (XLSX/XLS) ↔ PDF / HTML / CSV
  - Multi-file output is auto-wrapped in a folder
- **Desktop shortcut** (v2.1) — first-run `.exe` prompts whether to create one; toggle anytime from launcher right-click or settings panel. OneDrive-redirected Desktop is honored
- **PTT voice input** (v2.2) — global hotkey to dictate messages straight into chat, transcribed offline by [SenseVoice-Small](https://github.com/FunAudioLLM/SenseVoice) (zh / en / yue / ja / ko, ~70ms inference, zero network). Two modes:
  - 📣 **toggle** (default, stable everywhere): press once to start, again to stop
  - 🎙️ **hold-to-talk** (Discord-style): uses `uiohook-napi` low-level hook; can be flaky on some Windows setups, switchable from settings
  - Settings panel supports record-style custom rebinds for PTT / screenshot / respawn shortcuts
  - Model weights (~234MB) are **not bundled** — download separately into `assets/models/sense-voice/` per [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md)
- **Silver Wolf lv.999 hacker-styled floating panels**: hexagonal launcher button, screenshot insight HUD, pomodoro overlay

### Requirements

- Windows 10 / 11 (x64)
- Node.js 18+ (for building from source)
- Anthropic API key (`sk-ant-...`) — users provide their own; not bundled

### Build

```bash
npm install
build.bat
```

Output: `dist/SilverWolfPet-vX.X.X-win-x64.zip`

The zip contains the unpacked Electron app + manuals (`快速开始.txt` + `使用说明书.md`). End user just unzips and runs `SilverWolfPet.exe` — no Node required.

### Architecture

```
.
├── main.js                          Electron main process
├── preload.js                       contextBridge — IPC exposure to renderers
├── package.json / build.bat         build entrypoints
│
├── renderer/                        5 window HTMLs
│   ├── sidebar.html                 chat UI + 3-tab (chat/tasks/manual), agentic Claude loop + file drop
│   ├── character.html               84×115 sprite + speech bubble (240×140 transparent window)
│   ├── launcher.html                hexagonal floating button to toggle sidebar
│   ├── helper.html                  screenshot insight modal (5 modes, HSR styling)
│   └── pomodoro.html                floating top-right pomodoro countdown
│
├── services/                        File conversion (v2.1)
│   ├── converter.js                 routing table + handlers, pure-JS, runs in main process
│   └── pdf-render.html              hidden BrowserWindow that renders PDFs to canvas via PDF.js
│
├── assets/                          art / icons
│   ├── icon.ico / icon.png          app icon (🐺 wolf emoji, multi-size)
│   ├── sw_sheet.png                 sprite sheet used by character.html
│   ├── sw_side.png / sw_sprite*.png art originals (excluded from release build)
│   ├── launcher_icon.png            icon used by launcher.html
│   └── launcher_raw.png             launcher art original (gitignored)
│
├── scripts/                         build / dev helpers
│   ├── get_windows.ps1              foreground-window enumerator, called via IPC
│   ├── gen_icon.py                  renders 🐺 emoji into assets/icon.ico + icon.png
│   ├── process_launcher_icon.py     launcher_raw → launcher_icon
│   └── init_and_push.bat            one-shot git init + push
│
└── docs/
    ├── 使用说明书.md                  copied into release by build.bat; opened by Manual button
    ├── 快速开始.txt                   copied into release by build.bat
    └── silver-wolf-skill-distilled.md sync source for SW_PERSONA in sidebar.html
```

State persisted at `%APPDATA%\silver-wolf-pet\state.json`.

### License

MIT License. See [LICENSE](./LICENSE).

The original code is released under MIT. **The character IP belongs to miHoYo / HoYoverse** — the MIT license grants no rights over the underlying character IP.

### Third-Party Notices

This project bundles a range of third-party components (npm dependencies, ASR engine, SenseVoice model weights, etc.) under their original licenses (MIT / BSD-2-Clause / Apache-2.0 / FunASR Model License).

**See the full list and license terms at** [docs/THIRD_PARTY_LICENSES.md](./docs/THIRD_PARTY_LICENSES.md).

In particular: the voice input feature uses the **FunAudioLLM/SenseVoice-Small** model under the [FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE) (a non-OSI license that does permit commercial use and redistribution). Download the model weights separately per [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md).

---

Character © miHoYo · *Honkai: Star Rail*. AI backend © Anthropic.
