# 更新日志 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [2.2.1] — 2026-04-27 · **测试版 / Pre-release**

> ⚠ 本版本为 v2.2 主线的首个发布候选，核心 voice 链路在主流 Windows 11 + 麦克风配置下已通过功能验证；公开发布给少量用户实测识别准度、热键稳定性、跨设备兼容性。生产稳定版（v2.2.x）取决于本测试反馈。

### 新增 / Added

- **PTT 离线语音输入** —— 全局热键说话直接发消息到聊天，本地 [SenseVoice-Small](https://github.com/FunAudioLLM/SenseVoice) 模型转写（中英粤日韩五语种、~70ms 推理、零网络）。识别效果等价于"用户手敲完话按回车"，无缝接入现有 agentic 循环。
  - **toggle 模式**（默认 `Ctrl+Alt+V`）：按一次开麦、再按一次结束。Electron `globalShortcut` 单触发；加 300ms 去抖防 OS 自动连发反复触发 start/stop
  - **hold 模式**（按住说话，Discord 风格，opt-in）：基于 `uiohook-napi` 低级钩子；部分 Windows 配置下钩子可能被 OS 摘掉，所以默认是 toggle
  - **设置面板支持录制式自定义热键** —— PTT / 截屏 / 召回三个全局热键都能改；按下「⏺ 录制」再按新组合即生效，自动验 OS 冲突 + 暂停其他绑定避免被吃键
  - **强制结束录音**按钮：万一卡死可一键恢复
- **第三方组件许可声明** —— [docs/THIRD_PARTY_LICENSES.md](./docs/THIRD_PARTY_LICENSES.md) 列出全部 npm 依赖、ASR 引擎、SenseVoice 模型权重各自的开源协议；FunASR Model License 单独说明
- **使用说明书 §4.10「语音对话 PTT」** —— 完整流程 / 模式对比 / 热键自定义 / 模型下载位置 / 已知限制
- **sidebar 内置 cheatsheet「语音对话」小节** —— 快速参考所有 PTT 操作

### 改动 / Changed

- **`saveStateDebounced` 改异步写盘**（`fs.writeFile` 替代 `fs.writeFileSync`）—— hold 模式下按住热键 ~500ms 时同步写盘正好阻塞主线程 50–200ms，期间 libuiohook 的 WH_KEYBOARD_LL 钩子触发 Windows `LowLevelHooksTimeout` 被静默摘除，导致 keyup 永远收不到。`before-quit` 关机写盘仍保持同步以确保落盘
- **sidebar 窗口启动预热** —— `createWindows` 阶段 off-screen `showInactive` 然后 `hide`，让首次用户触发的 sidebar 显示不再阻塞主线程 1–2s（同一阻塞窗口期是 hold 模式钩子被摘的另一个诱因）
- **README + 使用说明书 + 快速开始 + 版本号 → 2.2.1**

### 修复 / Fixed

- **toggle 模式按住热键变成连发** —— OS 自动连发 ~33ms 一次，原版 toggle callback 每次都翻 `_pttToggleActive`，长按 3s 会触发 90 次 start/stop。加模块级 `_lastTogglePressTime` 300ms 去抖
- **hold 模式 listener 切模式后累积** —— `uIOhook.on()` 没有 `off()` 对应；切 hold↔toggle 多次会重复挂 handler，每次按键 callback 跑 N 次。重构成「启动时一次性安装、handler 内 spec/mode 双重 gate」的形式
- **改热键后立即生效** —— `_reregisterShortcut` / `pause-capture` / `resume-capture` 三处把模式判断从永不复位的 `_pttUiohookStarted` 改为读 `_state.preferences.voice_input_mode`，避免「切到 toggle 后改热键还在 hold 分支」
- **state.json 里 `voice_input_enabled=false` 后 PTT 永久卡死** —— init 成功后无条件重置为 true，从历史持久化故障恢复

### 安全网 / Safety nets（hold 模式专用）

- **modifier 静默 watchdog**：若 `_pttPressed=true` 但 3s 内无任何 uiohook 事件，强制 `onPttUp()` 释放（应付钩子被摘的极端场景）
- **mouse-event modifier watchdog**：用户讲完话挪鼠标时，`mousemove` 事件携带的 `ctrlKey/altKey` 实时标志位能反查"漏 keyup"的释放
- **re-press detection**：按住中又按一次相同组合（且中间发生过任意 keyup）→ 视为想停止，绕开漏掉的 keyup
- **Escape panic-stop** + 30s 硬上限 + 设置面板的强制结束按钮 —— 多重兜底

### 资源 / Assets

- **语音模型权重 `model.int8.onnx` (~234MB) 不入库**；用户按 [docs/voice-input-spec.md §8.1](./docs/voice-input-spec.md) 单独下载到 `assets/models/sense-voice/`
- `tokens.txt` (~25KB)、`hotwords.txt`（项目专有词热词表）、`LICENSE.txt`（FunASR 协议）入库

### 已知限制 / Known Limits

- 当前 sherpa-onnx-node 上 SenseVoice 仅支持 `greedy_search` 解码，**hotwords 实际不生效**（启动时会自动 fallback 到无 hotwords 配置 + warning 日志）。等上游 sherpa 对 SenseVoice 加 `modified_beam_search` 后 `hotwords.txt` 自动启用，无需改代码
- hold 模式在装了某些杀毒软件 / 第三方 IME / RDP 远程桌面环境下，钩子仍可能被摘。检测到 3s 静默会自动降级释放，不会卡死，但识别会丢这次输入。**生产环境推荐保留 toggle 默认。**

---

## [2.1.5] — 2026-04-26

### 新增 / Added

- **召回银狼全局热键 `Ctrl+Alt+W`** —— 全屏 DirectX 游戏 alt-tab、远程桌面、锁屏后，always-on-top 的 `screen-saver` z-order 经常被系统踢掉，银狼会被覆盖或漂到工作区外。新热键会把窗口 alwaysOnTop off→on 重新锚定到 `screen-saver` 层、检测越界后回到主屏底部居中、必要时重建窗口。可在 `state.preferences.respawn_pet_shortcut` 自定义。

### 修复 / Fixed

- **下载的 release zip 在 Windows 资源管理器里报"无效，无法完成提取"** —— PowerShell 5.1 的 `Compress-Archive` 写入非 ASCII 文件名（如 `使用说明书.md` / `快速开始.txt`）时用本机代码页（中文 Windows 是 GBK）但不设 zip 头里的 UTF-8 标志位，Windows 11 资源管理器严格校验时会拒绝整个包。改用 `[System.IO.Compression.ZipFile]::CreateFromDirectory` 显式传 `Encoding.UTF8`，正确写入 bit 11。

---

## [2.1.4] — 2026-04-26

### 修复 / Fixed

- **说明 tab 里的小标题（"快捷键" / "跟银狼说什么" / "截图模式" / "文件转换" / "设置"）字号过小** —— 同样是 Press Start 2P 7px 中文 fallback 问题。改 Noto Sans SC 13px / weight 600，标题清晰可读。

---

## [2.1.3] — 2026-04-26

### 修复 / Fixed

- **银狼鼠标接近后会原地颤抖** —— 之前 flee 状态结束后立刻又能被光标触发，鼠标稳定停在她落地点附近时她会反复飞→落→飞，看起来像在抖。现在 flee 触发后有 ~3.5 秒冷却，期间忽略光标距离；冷却后才会再次响应接近。

---

## [2.1.2] — 2026-04-26

### 新增 / Added

- **UI 缩放**（设置面板 → 4 档：小 / 默认 / 大 / 特大，对应 0.9 / 1.0 / 1.15 / 1.3）。所有窗口同步通过 `webContents.setZoomFactor` 缩放，持久化到 `state.preferences.ui_scale`。

### 修复 / Fixed

- **多开问题** —— 双击 `.exe` 或桌面快捷方式不会再生出新的银狼了。加了 `app.requestSingleInstanceLock()`，第二次启动会立刻退出并把已有的 sidebar 拉到前台。
- **快捷动作按钮（截图 / 搜索 / Pinterest / 下载 / 找文件）字号过小** —— 之前用了像素字体 Press Start 2P + 5.5px 字号，中文字符 fallback 到等宽字体后几乎看不清。改用 Noto Sans SC 11px。
- **底部 "银狼" name tag 同样字号偏小问题** —— 改 Noto Sans SC 11px / weight 500。
- **设置面板按钮（含 "清空对话历史"）字号偏小** —— 改 Noto Sans SC 11px。

### 内部 / Internal

- 移除 sidebar 内置 cheatsheet 标签里的版本标注（不再在用户 UI 显示版本号，由文档 / `CHANGELOG.md` 管理）。

---

## [2.1.1] — 2026-04-26

### 修复 / Fixed

- **Launcher 在不同分辨率电脑上消失** — 上次保存的位置（例如外接 4K 显示器右屏）拿到笔记本小屏上时，launcher 会落在屏幕外不可见。现在启动时校验保存坐标是否仍在某个显示器内，越界则自动回到主屏右下角
- **拔掉外接显示器后窗口卡在原位** — 监听 `display-removed` / `display-added` / `display-metrics-changed`，运行时自动救回所有越界窗口（launcher / 银狼 / sidebar / helper / pomodoro）
- **多显示器下 launcher 没法拖到副屏** — 之前 drag 只 clamp 在主屏内，导致拖到副屏时被拉回；现在按"扩展桌面 bounding box" clamp，可自由跨屏
- **打包后启动报 `Cannot find module ...index.js`** — 旧 build script 用 CLI `--ignore=^/dist`，cmd.exe 把 `^` 当转义符吃掉，正则退化为 `/dist` 无锚点，误杀了 `node_modules/<pkg>/dist/` 子目录，导致 html-to-docx 等运行时依赖的入口文件丢失。改为 `scripts/build.js` 程序化调用 `@electron/packager`，传 `RegExp` 对象，绕开 shell 转义

---

## [2.1.0] — 2026-04-26

### 新增 / Added

- **文件转换功能**（拖拽到 sidebar 触发）
  - 图片互转：PNG / JPG / BMP / WebP
  - 图片 → PDF
  - PDF → PNG / JPG / TXT / DOCX
  - PDF 操作：✂ 拆分（每页独立 PDF）、↻ 旋转 90°
  - 文档互转：Word (DOCX) ↔ HTML / Markdown / TXT / PDF
  - 表格：Excel (XLSX/XLS) ↔ PDF / HTML / CSV
  - 多页 / 多文件输出自动包文件夹（如 `xxx_pages/`、`xxx_split/`）
- **桌面快捷方式管理**
  - 首次运行 `.exe` 时弹出对话框询问是否创建（只问一次）
  - Launcher 右键菜单一键切换
  - 设置面板带状态指示
  - 兼容 OneDrive 重定向 / 中文 "桌面" 文件夹
- **应用图标更新**为 🐺 wolf emoji（替换原几何图标）
  - 通过 `scripts/gen_icon.py` 渲染 Segoe UI Emoji 字体生成
  - 多尺寸 .ico (16/24/32/48/64/128/256) + 256×256 .png 给运行时窗口

### 修复 / Fixed

- 系统消息气泡中英文字号不一致问题（之前用了纯英文像素字体导致中文 fallback 变大）

### 依赖 / Dependencies

新增运行时依赖：`jimp` `pdf-lib` `pdfjs-dist` `mammoth` `marked` `turndown` `html-to-docx` `pdf-parse` `xlsx`

### 内部 / Internal

- 新建 `services/converter.js` 路由表 + 各 handler，纯 JS 主进程跑
- 新建 `services/pdf-render.html`（隐藏 BrowserWindow，PDF.js 渲染到 canvas）
- `main.js` 加 IPC：`convert-file` / `convert-targets` / `shortcut-status` / `shortcut-create` / `shortcut-remove`
- `package.json` build 脚本去掉 `--ignore=node_modules`，让 runtime 依赖打包进 .exe

---

## [2.0.0] — 2025-04-25

### 项目首次开源发布

- 银狼角色 + 长期记忆 + 跨日主动问候
- 全局截图快捷键 `Ctrl+Shift+\`，5 种分析模式
- 番茄钟（屏幕右上浮窗）
- 应用启动器（5 级 fallback 策略 + 中英别名）
- 任务清单（手动 + AI 同步）
- 三栏 sidebar（聊天 / 任务 / 内置说明书）
