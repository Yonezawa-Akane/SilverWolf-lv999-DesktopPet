# Silver Wolf Pet · 银狼lv.999 桌宠

**Version 2.2.3** · [更新日志 / Changelog](./CHANGELOG.md)

> ⚠️ **Fan Project Disclaimer / 粉丝项目免责声明**
>
> 本项目为**非营利的粉丝二创**，与米哈游 / HoYoverse / Cognosphere **无任何关联**，亦未获得其授权或背书。"银狼"角色及《崩坏：星穹铁道》相关美术、名称、商标版权均归 **米哈游 (miHoYo Co., Ltd. / HoYoverse)** 所有。仓库内 `assets/sw_*.png` 等素材依据非营利合理使用原则收录，如版权方希望移除，请开 issue，会立即处理。
>
> This is an **unofficial, non-commercial fan project**. It is **NOT** affiliated with, endorsed by, or sponsored by **miHoYo / HoYoverse / Cognosphere**. The character "Silver Wolf (银狼)" and all related artwork, names, and trademarks from *Honkai: Star Rail* are the intellectual property of **miHoYo Co., Ltd. / HoYoverse**. Image assets in this repo (`assets/sw_*.png` etc.) are included under fair-use for non-commercial fan work. If you are a rights holder and want them removed, please open an issue — they will be taken down promptly.

**语言 / Language**: [简体中文](#-中文文档) | [English](#-english-documentation)

---

## 🇨🇳 中文文档

### 给用户（90% 读者）

**不用装 Node 或 Git**。从 Releases 页面下载最新的 `SilverWolfPet-vX.X.X.zip`，按 3 步走：

1. **解压** zip 到 `D:\SilverWolfPet\`（⚠ 不要放 `C:\Program Files`）
2. 双击 **① 配置环境.bat** —— 自动装语音功能依赖的 VC++ 运行库，约 30 秒，**仅首次**
3. 双击 **② 启动银狼.bat** —— 在 sidebar 右上角 ⚙ 按钮里粘贴 Anthropic API Key

详细新手图文教程见 [docs/使用说明书.md §3.0](./docs/使用说明书.md)（从「30 秒看完就上手」读起）。完整功能 / 排查见同文档 §3.1 / §8。

> 没有 API Key？去 [console.anthropic.com](https://console.anthropic.com/) 注册，新用户有 $5 免费额度。中国大陆用户需要 VPN，详见 [使用说明书 §3.2](./docs/使用说明书.md)「Anthropic 注册踩坑」。

---

### 给开发者

#### 简介

银狼主题的 Windows AI 桌面伴侣 —— 基于 Electron + Anthropic Claude 打造。

一只能浮在桌面上的小狼，有完整的角色人格、屏幕感知能力、跨会话记忆、番茄钟、应用启动器，以及一堆星穹铁道风的悬浮面板。

#### 功能特性

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
  - 模型权重 ~234MB **自 v2.2.2 起打进发行包**；源码构建仍按 [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md) 单独下到 `assets/models/sense-voice/`
- **银狼 lv.999 骇客风格悬浮面板**：六边形启动按钮 / 截屏洞察 HUD / 番茄钟覆层

#### 系统要求 / 开发栈

- Windows 10 / 11（x64）
- Node.js 18+（仅源码构建需要）
- Anthropic API Key（`sk-ant-...`）—— 用户自备，不内置

#### 构建源码

```bash
npm install
npm run build       # 调用 scripts/build.js → @electron/packager
```

产物：`dist/SilverWolfPet-win32-x64/`，含已打包的 .exe + 模型 + 一键配置脚本（`配置环境.bat` / `启动银狼.bat` / `redist/vc_redist.x64.exe`）。

发行前需在 `release-assets/` 放置 `vc_redist.x64.exe` (~14MB)，build 阶段会自动拷入 `dist/.../redist/`。详细见 [release-assets/README.md](./release-assets/README.md)。

#### 项目结构

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
├── services/                        文件转换（v2.1）+ 语音 ASR（v2.2）
│   ├── converter.js                 转换路由表 + handler，纯 JS 主进程跑
│   ├── pdf-render.html              隐藏 BrowserWindow，PDF.js 渲染到 canvas（PDF→图片用）
│   └── voice.js                     SenseVoice ASR 封装；5-stage 错误分类 + voice-init.log（v2.2.2）
│
├── assets/                          美术资源 / 图标
│   ├── icon.ico / icon.png          应用图标（🐺 wolf emoji，多尺寸）
│   ├── sw_sheet.png                 character.html 用的 sprite sheet
│   ├── sw_side.png / sw_sprite*.png 美术原稿（不打包进 release）
│   ├── launcher_icon.png            launcher.html 用的图标
│   ├── launcher_raw.png             launcher 图标原稿（gitignore）
│   └── models/sense-voice/          SenseVoice 模型权重（model.int8.onnx ~234MB 进发行包）
│
├── release-assets/                  发行包附带的一键配置脚本（v2.2.2）
│   ├── 配置环境.bat                  首次运行装 VC++ 运行库
│   ├── 启动银狼.bat                  一键启动 .exe
│   └── vc_redist.x64.exe            Microsoft VC++ 2015-2022 (开发者本地放置)
│
├── scripts/                         构建/开发辅助
│   ├── build.js                     程序化 @electron/packager 调用 + dist 后处理（拷脚本 / 写 README - 必读）
│   ├── get_windows.ps1              主进程通过 IPC 调用，枚举前台窗口
│   ├── gen_icon.py                  从 🐺 emoji 生成 assets/icon.ico + icon.png
│   ├── process_launcher_icon.py     从 launcher_raw 生成 launcher_icon
│   └── init_and_push.bat            一次性 git init + push
│
└── docs/
    ├── 使用说明书.md                  用户主文档（§3.0 新手图文 / §3.1 功能速查 / §3.2 卡哪看哪 / §1-§8 详解）
    ├── 快速开始.txt                   30 秒上手版（随发行包发出，记事本兼容）
    ├── voice-input-spec.md            开发者文档：PTT 实现规格（不进发行包）
    ├── voice-code-review*.md          开发者文档：代码评审记录（不进发行包）
    └── silver-wolf-skill-distilled.md sidebar.html 中 SW_PERSONA 常量的同步源（不进发行包）
```

运行时状态持久化到 `%APPDATA%\silver-wolf-pet\state.json`。

### 许可证

MIT 许可证。详见 [LICENSE](./LICENSE)。

代码原作以 MIT 协议开源。**角色 IP 版权归米哈游所有**，MIT 协议不授予角色相关的任何 IP 权利。

### 第三方组件声明

本项目集成了多个第三方组件（npm 依赖、ASR 引擎、SenseVoice 语音模型权重等），各自保留原始协议（MIT / BSD-2-Clause / Apache-2.0 / FunASR Model License）。

**完整清单与各协议条款见** [docs/THIRD_PARTY_LICENSES.md](./docs/THIRD_PARTY_LICENSES.md)。

特别说明：语音输入功能使用 **FunAudioLLM/SenseVoice-Small** 模型，该模型采用 [FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)（非标准 OSI 协议，但允许商用与再分发）。模型权重文件随发行包分发；源码构建按 [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md) 单独下载。

---

## 🇬🇧 English Documentation

### For Users (90% of readers)

**No Node or Git required.** Download the latest `SilverWolfPet-vX.X.X-win-x64.zip` from the Releases page, then 3 steps:

1. **Unzip** to `D:\SilverWolfPet\` (⚠ avoid `C:\Program Files`)
2. Double-click **① 配置环境.bat** — auto-installs the VC++ runtime needed for offline voice; ~30s, **first time only**
3. Double-click **② 启动银狼.bat** — paste your Anthropic API key in the sidebar's ⚙ panel

Detailed walkthrough: [docs/使用说明书.md §3.0](./docs/使用说明书.md) (in Chinese; this guide assumes a complete beginner). Full feature reference / troubleshooting: §3.1 / §8 in the same file.

> No API key? Sign up at [console.anthropic.com](https://console.anthropic.com/) — first-time users get $5 trial credit. Mainland China users need a VPN; see [使用说明书 §3.2](./docs/使用说明书.md) "Anthropic 注册踩坑".

---

### For Developers

#### Overview

Silver Wolf-themed AI desktop companion for Windows. Built on Electron + Anthropic Claude.

A floating desktop pet with full character persona, screen-aware shortcuts, cross-session memory, pomodoro timer, app launcher, and a stack of HSR-styled floating panels.

#### Features

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
  - Model weights (~234MB) **bundled in release zip since v2.2.2**; source builds still download separately into `assets/models/sense-voice/` per [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md)
- **Silver Wolf lv.999 hacker-styled floating panels**: hexagonal launcher button, screenshot insight HUD, pomodoro overlay

#### Requirements / Dev Stack

- Windows 10 / 11 (x64)
- Node.js 18+ (for source builds only)
- Anthropic API key (`sk-ant-...`) — users provide their own; not bundled

#### Build From Source

```bash
npm install
npm run build       # invokes scripts/build.js → @electron/packager
```

Output: `dist/SilverWolfPet-win32-x64/` — packaged .exe + model + one-shot config scripts (`配置环境.bat` / `启动银狼.bat` / `redist/vc_redist.x64.exe`).

Before building a release, place `vc_redist.x64.exe` (~14MB) in `release-assets/`; build will auto-copy it into `dist/.../redist/`. See [release-assets/README.md](./release-assets/README.md).

#### Architecture

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
├── services/                        File conversion (v2.1) + voice ASR (v2.2)
│   ├── converter.js                 routing table + handlers, pure-JS, runs in main process
│   ├── pdf-render.html              hidden BrowserWindow that renders PDFs to canvas via PDF.js
│   └── voice.js                     SenseVoice ASR wrapper; 5-stage error tagging + voice-init.log (v2.2.2)
│
├── assets/                          art / icons
│   ├── icon.ico / icon.png          app icon (🐺 wolf emoji, multi-size)
│   ├── sw_sheet.png                 sprite sheet used by character.html
│   ├── sw_side.png / sw_sprite*.png art originals (excluded from release build)
│   ├── launcher_icon.png            icon used by launcher.html
│   ├── launcher_raw.png             launcher art original (gitignored)
│   └── models/sense-voice/          SenseVoice weights (model.int8.onnx ~234MB ships in release zip)
│
├── release-assets/                  release-zip helper scripts (v2.2.2)
│   ├── 配置环境.bat                  first-run VC++ runtime installer
│   ├── 启动银狼.bat                  one-click .exe launcher
│   └── vc_redist.x64.exe            Microsoft VC++ 2015-2022 (placed by dev locally)
│
├── scripts/                         build / dev helpers
│   ├── build.js                     programmatic @electron/packager + dist post-processing
│   ├── get_windows.ps1              foreground-window enumerator, called via IPC
│   ├── gen_icon.py                  renders 🐺 emoji into assets/icon.ico + icon.png
│   ├── process_launcher_icon.py     launcher_raw → launcher_icon
│   └── init_and_push.bat            one-shot git init + push
│
└── docs/
    ├── 使用说明书.md                  user-facing main manual (§3.0 newbie walkthrough, §3.1 feature tour, §3.2 pitfalls, §1-§8 deep dive)
    ├── 快速开始.txt                   30-second quickstart (ships in release, Notepad-friendly)
    ├── voice-input-spec.md            dev: PTT implementation spec (not in release)
    ├── voice-code-review*.md          dev: code review notes (not in release)
    └── silver-wolf-skill-distilled.md sync source for SW_PERSONA in sidebar.html (not in release)
```

State persisted at `%APPDATA%\silver-wolf-pet\state.json`.

### License

MIT License. See [LICENSE](./LICENSE).

The original code is released under MIT. **The character IP belongs to miHoYo / HoYoverse** — the MIT license grants no rights over the underlying character IP.

### Third-Party Notices

This project bundles a range of third-party components (npm dependencies, ASR engine, SenseVoice model weights, etc.) under their original licenses (MIT / BSD-2-Clause / Apache-2.0 / FunASR Model License).

**See the full list and license terms at** [docs/THIRD_PARTY_LICENSES.md](./docs/THIRD_PARTY_LICENSES.md).

In particular: the voice input feature uses the **FunAudioLLM/SenseVoice-Small** model under the [FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE) (a non-OSI license that does permit commercial use and redistribution). Model weights ship with the release zip; source builds download them separately per [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md).

---

Character © miHoYo · *Honkai: Star Rail*. AI backend © Anthropic.
