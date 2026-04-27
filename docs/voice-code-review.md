# Voice 系统代码审查报告 v1.0

> 范围：覆盖 `services/voice.js` + `main.js` 中 voice 相关全部代码 + `preload.js` voice surface + `renderer/sidebar.html` voice 模块 + `renderer/launcher.html` voice 视觉。
> 目的：完整梳理逻辑链，定位潜在 bug，**不修改代码**。修改交给下游执行。

---

## 0. 涉及文件 / 行号索引

| 文件 | voice 相关位置 |
|---|---|
| `services/voice.js` | 全文（93 行）：sherpa-onnx 包装 |
| `main.js` | L1-20（uiohook 加载），L41-42（globals），L171-179（DEFAULT_STATE 中 voice 字段），L415-901（voice 主逻辑），L1027-1042（whenReady 启动），L1075-1089（before-quit 清理），L1544-1560（sidebar:reveal + voice:force-stop） |
| `preload.js` | L53-56, L62-64（voice IPC 桥） |
| `renderer/sidebar.html` | L832-871（settings 面板 voice UI），L920-995（hotkey 配置 + setVoiceMode），L1113-1119（forceStopVoice），L2702-2882（voice 捕获主流程） |
| `renderer/launcher.html` | L56-61, L213-219（voice-active 视觉指示） |
| `renderer/character.html` | 无直接 voice 引用，通过 `show-quip` IPC 接气泡 |

---

## 1. 模块全局状态地图

### 1.1 main.js voice 全局变量

| 变量 | 初始值 | 改写处 | 含义 |
|---|---|---|---|
| `voice` | require('./services/voice') | const | sherpa 包装 |
| `_pttPressed` | false | hold/toggle/force-stop/maxTimer | "当前是否正在录音" |
| `_pttUiohookStarted` | false | 仅 hold 模式首次成功调用 `uIOhook.start()` 后置 true，**永不复位** | uiohook 是否已启动 |
| `_pttToggleAccel` | null | toggle 模式下 register 时设、unregister 时设 null | 当前 toggle 模式下注册的 accel 字符串 |
| `_pttToggleActive` | false | toggle 回调内取反、force-stop / maxTimer 重置 | toggle 模式的"开/关"latch |
| `_pttBubbleTimer` | null | **声明了但代码里没用** ⚠️ | 死代码 |
| `_pttMaxDurationTimer` | null | onPttDown 里启动、onPttUp/maxTimer 自身里清 | 30s 强制结束保护 |
| `_pttUiohookSpec` | null | `_refreshPttUiohookSpec()` / 切换模式时清空 | hold 模式下当前热键的解析后 spec |
| `_pttHadKeyUpSinceDown` | false | onPttDown 里 false、任意 keyup 里 true | 区分 OS 自动连发 vs 用户重新按键 |
| `_shortcutsPaused` | false | shortcuts:pause-capture / resume | 录新热键时暂停热键拦截 |
| `_quickInsightShortcut` / `_respawnShortcut` | null | 各自注册时设值 | 截屏 / 召回热键当前 accel |

### 1.2 sidebar.html voice 全局变量

| 变量 | 初始值 | 含义 |
|---|---|---|
| `voiceCtx` | null | AudioContext |
| `voiceWorklet` | null | AudioWorkletNode |
| `voiceStream` | null | MediaStream from getUserMedia |
| `voiceMediaSrc` | null | MediaStreamSource |
| `voiceBuffer` | [] | Float32Array chunks |
| `voiceStartedAt` | 0 | recording 开始时间戳 |
| `voiceWorkletURL` | null | Blob URL of inline worklet |
| `voiceCapturing` | false | "renderer 这边是不是在录音" |
| `voiceWorkletInputRate` | 16000 | 实际拿到的采样率（device 可能不给 16k） |
| `_voiceBannerEl` | null | "🎙️ 听着呢" banner DOM ref |
| `_hkRecording` | null | 当前是否在录新热键，及 kind |

---

## 2. 完整逻辑链梳理（每条都画出来）

### 链条 A — 冷启动 → PTT 注册

```
app.whenReady()
  ↓
loadState() — 从 state.json 加载，shallow merge DEFAULT_STATE
  ↓ DEFAULT_STATE.preferences 包含:
  ↓   voice_input_shortcut: 'CommandOrControl+Alt+V'
  ↓   voice_input_enabled: true
  ↓   voice_input_mode: 'toggle'   ← 默认 toggle
  ↓   voice_input_language: 'auto'
  ↓   voice_input_min_duration_ms: 300
  ↓   voice_input_max_duration_ms: 30000
  ↓
createWindows() — 5 个 BrowserWindow，sideWin show:false
  ↓
注册截屏 + respawn 热键 (globalShortcut)
  ↓
setTimeout(800ms, () => {
  voice.initRecognizer()       — 同步加载 ~234MB 模型，阻塞 1-2s
    ├─ 失败 → _state.preferences.voice_input_enabled = false
    │         show alert bubble + return（不注册 PTT）
    └─ 成功 → registerVoicePTT()
                  ↓
                  if (!voice_input_enabled) return  ⚠ 见 BUG-4
                  ↓
                  mode = state.preferences.voice_input_mode === 'hold' ? 'hold' : 'toggle'
                  ↓
                  if (mode === 'toggle')
                    → _registerVoicePTTToggle()
                       └─ globalShortcut.register(accel, () => { 切换 _pttToggleActive 然后 onPtt[Down|Up] })
                  else (mode === 'hold')
                    → _refreshPttUiohookSpec()
                    → uIOhook.on('keydown', ...)        ← BUG-2 关键点：每次 register 都加新 listener
                    → uIOhook.on('keyup',   ...)
                    → uIOhook.on('mousemove', _pttModifierWatchdog)
                    → uIOhook.on('mousedown', _pttModifierWatchdog)
                    → uIOhook.on('mouseup',   _pttModifierWatchdog)
                    → uIOhook.on('wheel',     _pttModifierWatchdog)
                    → uIOhook.on('keydown',   _pttModifierWatchdog)  ← 重复挂的 keydown，BUG-2.5
                    → if (!_pttUiohookStarted) uIOhook.start(); _pttUiohookStarted = true
})
```

### 链条 B — PTT 触发（toggle 模式）

```
[用户按下 Ctrl+Shift+O]
   ↓ Windows OS 路由到 RegisterHotKey 监听者（Electron globalShortcut）
   ↓ 调度到 main 线程的回调
   ↓
() => {
  _pttToggleActive = !_pttToggleActive
  if (_pttToggleActive) onPttDown()
  else onPttUp()
}

press 1 (active: false → true) → onPttDown()
press 2 (active: true → false) → onPttUp()
press 3 (active: false → true) → onPttDown()
... 应该无限循环正常工作
```

### 链条 C — onPttDown 执行链

```
onPttDown()
  ├─ if (!voice.isReady()) → bubble alert + return
  ├─ ⚠ 这里之前有 sideWin.showInactive() — 已被移除（注释解释了原因）
  ├─ showCharBubble('🎙️ 听着呢...', { duration: 30000 })
  │     └─ charWin.webContents.send('show-quip', payload)
  │     └─ logBubble() → saveStateDebounced()
  ├─ launchWin.send('voice-active', true)
  │     └─ launcher 收到后 body.classList.add('voice-active') → halo 加速 + cyan tint
  ├─ sideWin.send('voice:start')
  │     └─ sidebar.html: window.sw.onVoiceStart(() => startVoiceCapture())
  │           └─ startVoiceCapture()
  │                 ├─ if (voiceCapturing) return  ← 防重入
  │                 ├─ voiceCapturing = true
  │                 ├─ voiceBuffer = []
  │                 ├─ voiceStartedAt = Date.now()
  │                 ├─ navigator.mediaDevices.getUserMedia({ audio: {...} })
  │                 │     ├─ 第一次：可能弹 Windows 麦克风权限对话框（如果未授权）
  │                 │     └─ 后续：立即 resolve
  │                 ├─ new AudioContext({ sampleRate: 16000 })
  │                 │     └─ 设备可能忽略 sampleRate；用 voiceCtx.sampleRate 兜底
  │                 ├─ inline AudioWorklet 注册（Blob URL → addModule）
  │                 ├─ 连接 mediaSrc → workletNode
  │                 ├─ port.onmessage 累积 Float32 chunks 到 voiceBuffer
  │                 └─ showVoiceBanner() — 在 sidebar 顶部显示 "🎙️ 听着呢" 浮条
  ├─ console.log('[voice] PTT pressed → mic start sent')
  └─ setTimeout(_pttMaxDurationTimer, 30000) — 强制 onPttUp 兜底
```

### 链条 D — onPttUp 执行链

```
onPttUp()
  ├─ clearTimeout(_pttMaxDurationTimer)
  ├─ launchWin.send('voice-active', false) — halo 恢复
  ├─ sideWin.send('voice:stop')
  │     └─ sidebar.html: window.sw.onVoiceStop(() => stopVoiceCapture())
  │           └─ stopVoiceCapture()
  │                 ├─ if (!voiceCapturing) hideVoiceBanner(); return
  │                 ├─ voiceCapturing = false
  │                 ├─ hideVoiceBanner()
  │                 ├─ buffered = voiceBuffer; inputRate = voiceWorkletInputRate
  │                 ├─ dur = Date.now() - voiceStartedAt
  │                 ├─ await teardownVoiceGraph()
  │                 │     ├─ voiceWorklet.disconnect()
  │                 │     ├─ voiceMediaSrc.disconnect()
  │                 │     ├─ voiceStream.getTracks().forEach(stop)
  │                 │     ├─ voiceCtx.close() — 异步
  │                 │     ├─ URL.revokeObjectURL(voiceWorkletURL)
  │                 │     └─ 全部清空为 null
  │                 ├─ if (dur < 300ms || buffer 空) → setQuip('—', 600) + return（误触保护）
  │                 ├─ 拼接 chunks → merged Float32Array
  │                 ├─ if (inputRate ≠ 16000) → downsampleLinear() 到 16k
  │                 ├─ showTyping() — sidebar 三点动画
  │                 ├─ await window.sw.voiceTranscribe(Array.from(samples), 16000)
  │                 │     └─ main.ipcMain.handle('voice:transcribe')
  │                 │           └─ voice.transcribe(f32, 16000)
  │                 │                 ├─ recognizer.createStream()
  │                 │                 ├─ stream.acceptWaveform({ samples, sampleRate })
  │                 │                 ├─ recognizer.decode(stream) — 同步阻塞 ~70-200ms
  │                 │                 └─ getResult(stream).text 剥 meta tag
  │                 ├─ hideTyping()
  │                 ├─ if (!ok || error) addMsg('ai', '识别炸了：' + err)
  │                 ├─ if (text 为空) setQuip('没听清，再说一遍？', 2000, pout)
  │                 ├─ else:
  │                 │   ├─ inpEl.value = text
  │                 │   ├─ setQuip('✓ ' + text.slice(0,24), 2200, success)
  │                 │   ├─ window.sw.revealSidebar() — 现在才显示 sidebar
  │                 │   └─ sendMsg() — 触发 agentic 循环
  ├─ console.log('[voice] PTT released → mic stop sent, transcribing...')
  └─ showCharBubble('💭 解析中...', { duration: 1800 }) — 覆盖"听着呢"气泡
```

### 链条 E — PTT 触发（hold 模式，opt-in）

```
[用户按下 Ctrl+Shift+O]
   ↓ libuiohook WH_KEYBOARD_LL 钩子捕获
   ↓ libuiohook 内部分发 → uiohook-napi → Node main 线程

uIOhook.on('keydown', e => {
  match = e.keycode === spec.keycode && 所有 modifier 满足
  if (!match) return
  if (_pttPressed)
    if (_pttHadKeyUpSinceDown) → 第二次按下检测 → 强制 onPttUp（绕开漏掉的 keyup）
    else → 自动连发，忽略
  else
    _pttPressed = true
    _pttHadKeyUpSinceDown = false
    onPttDown()
})

[用户松开 Ctrl 或 Shift 或 O 任一]
   ↓
uIOhook.on('keyup', e => {
  _pttHadKeyUpSinceDown = true        ← 任意 keyup 都触发
  if (!_pttPressed) return
  releasingMain = e.keycode === spec.keycode
  releasingCtrl = spec.needCtrl && !e.ctrlKey
  releasingAlt  = ...
  releasingShift = ...
  if (任一为 true)
    _pttPressed = false
    onPttUp()
  if (e.keycode === Escape && _pttPressed) → 紧急停止
})

[mousemove / mousedown / mouseup / wheel / keydown(任意键)]
   ↓
_pttModifierWatchdog(e)    ← 兜底，在 PTT 还以为按下时检查 modifier 实时状态
  if (!_pttPressed) return
  if (任一 needX 但 e.xKey=false) → _pttPressed = false; onPttUp()
```

### 链条 F — 用户在设置面板修改热键

```
User 点击「⏺ 录制」 → recordHotkey('voice')
  ↓
window.sw.pauseShortcutsForCapture()
  ↓
ipcMain.handle('shortcuts:pause-capture')
  ├─ globalShortcut.unregister(_quickInsightShortcut)
  ├─ globalShortcut.unregister(_respawnShortcut)
  ├─ if (toggle 模式) globalShortcut.unregister(_pttToggleAccel)
  └─ _pttUiohookSpec = null    ← hold 模式下禁用匹配

[用户按 Ctrl+Shift+X]
  ↓
window keydown listener (renderer)
  └─ _eventToAccel(e) → 'CommandOrControl+Shift+X'
  ↓
window.sw.setShortcut('voice', accel)
  ↓
ipcMain.handle('shortcuts:set', { kind:'voice', accel })
  └─ _reregisterShortcut('voice', accel)
        ├─ _state.preferences.voice_input_shortcut = accel
        ├─ if (uIOhook && _pttUiohookStarted)   ← 见 BUG-1
        │     → _refreshPttUiohookSpec() → return { ok:true, mode:'hold' }
        └─ else
              → _registerVoicePTTToggle() → return { ok, mode:'toggle' }
  ↓
window.sw.resumeShortcutsForCapture()
  └─ shortcuts:resume-capture 重新注册 quick-insight + respawn + (PTT if toggle)
```

### 链条 G — 用户切换 PTT 模式

```
User 点击「📣 按一次切换」/「🎙️ 按住说话」 → setVoiceMode(mode)
  ↓
window.sw.voiceSetMode(mode)
  ↓
ipcMain.handle('voice:set-mode', mode)
  ├─ if (_pttToggleAccel) globalShortcut.unregister + null
  ├─ _pttUiohookSpec = null     ← hold 模式下停止匹配（但 listener 还在）
  ├─ _pttPressed = false
  ├─ _pttToggleActive = false
  ├─ _state.preferences.voice_input_mode = mode
  ├─ registerVoicePTT()
  │     ├─ if (mode === 'toggle') → _registerVoicePTTToggle()
  │     └─ if (mode === 'hold')   → 又一次 uIOhook.on('keydown', ...) ⚠ BUG-2
  └─ saveStateDebounced()
```

### 链条 H — 强制结束录音

```
User 点击「⏹ 强制结束录音」 → forceStopVoice()
  ↓
window.sw.voiceForceStop()
  ↓
ipcMain.on('voice:force-stop')
  ├─ if (!_pttPressed && !_pttToggleActive) return
  ├─ _pttPressed = false
  ├─ _pttToggleActive = false
  └─ onPttUp()    ← 触发完整 stop 链路（同链条 D）
```

### 链条 I — 关机清理

```
app.on('before-quit')
  ├─ globalShortcut.unregisterAll()  ← 清掉所有 globalShortcut
  ├─ if (uIOhook && _pttUiohookStarted) uIOhook.stop()
  ├─ archiveAndPurge(_state)
  └─ writeFileSync(state.json)
```

---

## 3. Bug / 风险清单

按"导致用户看到的故障可能性"从高到低排：

### 🔴🔴 BUG-0（最致命，刚实测确认）：toggle 模式按住热键时回调被 OS 自动连发反复触发

**位置**：`main.js` L708-712，`_registerVoicePTTToggle()` 注册的 callback

```js
const ok = globalShortcut.register(accel, () => {
  _pttToggleActive = !_pttToggleActive
  if (_pttToggleActive) onPttDown()
  else onPttUp()
})
```

**实测现象**（用户 2026-04-27 提供）：

```
[voice] PTT (toggle fallback) 注册成功: CommandOrControl+Shift+O
[voice] PTT pressed → mic start sent
[voice] PTT released → mic stop sent, transcribing...
[voice] PTT pressed → mic start sent
[voice] PTT released → mic stop sent, transcribing...
... × 25+ 行
```

**根因**：
- 用户**按住**热键时，Windows OS 的键盘自动连发（默认 33ms / 30Hz）会让 `RegisterHotKey` 反复触发 `WM_HOTKEY` 消息
- Electron globalShortcut 没做内部去抖，每个 WM_HOTKEY 都直接调 callback
- 每次 callback 把 `_pttToggleActive` 取反，所以 pressed → released → pressed → released 高频交替
- 每次 onPttDown / onPttUp 都触发 mic 启停 + 识别 + bubble 切换，sidebar 被快速 reveal/hide，**整个语音管线被锯齿状轰炸**

这条 bug 直接导致 toggle 模式在用户长按时**完全不能用**——而 toggle 模式的 UX 本来就是"按一下"，但用户偶尔按住超过 50ms 就会触发这个 bug。

**复现条件**：toggle 模式 + 按住热键超过 ~500ms（OS 默认连发延迟）。

**修复方向**（**Priority 0**）：

callback 内加时间窗口去抖：

```js
let _lastTogglePressTime = 0
const TOGGLE_DEBOUNCE_MS = 300   // > OS auto-repeat interval (~33ms) and > human double-tap

const ok = globalShortcut.register(accel, () => {
  const now = Date.now()
  if (now - _lastTogglePressTime < TOGGLE_DEBOUNCE_MS) return   // OS auto-repeat 或人为双击，吞掉
  _lastTogglePressTime = now
  _pttToggleActive = !_pttToggleActive
  if (_pttToggleActive) onPttDown()
  else onPttUp()
})
```

**注意事项**：
- 300ms 是 OS 连发间隔（33ms）的 ~9 倍，且远短于人合理"按一下结束再按一下"的最快间隔（~250ms）。但要测真实使用——如果用户经常快速点 2 次想"开-关-开"，可能要把窗口缩到 200ms
- 这个去抖只能解决 **持续连发** 的问题。如果用户一次"长按 1 秒"，连发会被吞掉，但首次 callback 仍然只是 toggle 一次，结束时 _pttToggleActive=true，需要用户再按一次才能停。这是合理的：toggle 模式本来就不支持"按住"语义
- **更彻底的方案**：检测到 callback 在很短时间内反复触发，则进入"持续按住中"状态，等用户真正放手后（callback 停止 ~150ms 后）再做 toggle。但这需要 setTimeout 延迟决策，会引入用户感知的滞后。**不推荐**

### 🔴 BUG-1：`_reregisterShortcut('voice')` 用 `_pttUiohookStarted` 判断模式，错的

**位置**：`main.js` L730-740

```js
if (kind === 'voice') {
  _state.preferences.voice_input_shortcut = accel
  if (uIOhook && _pttUiohookStarted) {     // ⚠
    _refreshPttUiohookSpec()
    return { ok: true, mode: 'hold' }
  }
  // toggle 路径
  const ok = _registerVoicePTTToggle()
  return { ok: !!ok, mode: 'toggle', ... }
}
```

**问题**：`_pttUiohookStarted` 一旦置 true 就**永不复位**（见全局变量表）。如果用户先用过 hold 模式（启动 uiohook），再切回 toggle 模式，`_pttUiohookStarted` 仍是 true。此时改热键，会走 hold 分支，**toggle 的 globalShortcut 不会被 re-register**，新热键失效。

**正确做法**：判断 `_state.preferences.voice_input_mode === 'hold'`。

### 🔴 BUG-2：hold 模式 listener 永久泄漏 + 切换模式后重复挂载

**位置**：`main.js` L589-684 的 `registerVoicePTT()` hold 分支

每次进 hold 分支都执行：
```js
uIOhook.on('keydown', ...)    // 主 keydown handler
uIOhook.on('keyup',   ...)
uIOhook.on('mousemove', _pttModifierWatchdog)
uIOhook.on('mousedown', _pttModifierWatchdog)
uIOhook.on('mouseup',   _pttModifierWatchdog)
uIOhook.on('wheel',     _pttModifierWatchdog)
uIOhook.on('keydown',   _pttModifierWatchdog)   // ⚠ 第二个 keydown listener
```

**问题 A**：注释说 "uIOhook.removeListener requires the original function ref, which we don't track" — 但函数都是匿名内联的，无法 off()。**handlers 永久累积**。

**问题 B**：切换模式 hold→toggle→hold 之后会注册第二套 listener。第三次切换会有第三套。每次按键，所有套都执行。

**问题 C**：在 hold 分支内，**`_pttModifierWatchdog` 既挂在 keydown 又是主 keydown 的旁路**。每次 keydown 都跑两遍逻辑。

**症状**：mode-switch 后行为越来越怪，CPU 占用上升，bubbles 重复触发，可能触发 onPttUp 多次。

### 🔴 BUG-3：`registerVoicePTT()` 在 voice_input_enabled=false 时直接 return

**位置**：`main.js` L562

```js
function registerVoicePTT() {
  if (!_state || !_state.preferences || !_state.preferences.voice_input_enabled) return
  ...
}
```

**问题**：如果 state.json 里因为以前某次模型缺失把 `voice_input_enabled=false` 持久化了，**之后即使模型补上、initRecognizer 成功，也不会注册 PTT**。`whenReady` 里 init 成功后只是 `registerVoicePTT()`，没有重新 enable。

**正确做法**：init 成功后 `_state.preferences.voice_input_enabled = true`。

### 🔴 BUG-4：模型加载阻塞 + uiohook 启动顺序

**位置**：`main.js` L1027-1042

```js
setTimeout(() => {
  const ok = voice.initRecognizer()    // ← 同步阻塞 ~1-2s 加载 234MB 模型
  if (!ok) { ... return }
  registerVoicePTT()                   // ← 之后才启动 uiohook
}, 800)
```

**问题**：模型加载在 main 线程同步执行（sherpa-onnx-node 的 OfflineRecognizer ctor 是阻塞的）。这 1-2s 内主线程被冻。如果用户启动后立即按热键，事件可能丢。

不直接相关 PTT 卡住，但用户体验差。

### 🟡 BUG-5：toggle 模式下可能存在 hold mode 残留 listener

**场景**：用户启动时是 toggle，然后切到 hold（uiohook listener 装上 + start），再切回 toggle。
- `_pttUiohookSpec = null` → handler no-op
- toggle 的 globalShortcut 注册 OK

但 uiohook 仍在跑（_pttUiohookStarted=true），listener 全在，每次按键都执行那一堆 listener（即使 spec=null 短路返回）。**性能浪费 + 复杂状态**。

更糟：如果用户在 toggle 模式下按了 PTT 热键（被 globalShortcut 拦截），uiohook 也会看到这次按键（低级钩子在 globalShortcut 之前）。listener 检查 spec=null 短路，但 `_pttModifierWatchdog` 还是会跑。

### 🟡 BUG-6：voice:transcribe 同步阻塞 main

**位置**：`services/voice.js` transcribe()，`main.js` L885

```js
recognizer.decode(stream)   // sherpa-onnx-node 同步 C++ 调用，~70-200ms
```

**问题**：N-API 调用在 main 线程跑。如果用户在解码期间又按了 PTT 热键（toggle 模式），globalShortcut callback 会排队。100-200ms 的延迟用户能感觉到。

非致命，但是真锅。

### 🟡 BUG-7：showInactive 仍然在 sidebar:reveal IPC 里调用

**位置**：`main.js` L1544-1549

```js
ipcMain.on('sidebar:reveal', () => {
  if (!alive(sideWin)) return
  if (!sideWin.isVisible()) {
    try { sideWin.showInactive() } catch {}    // ⚠
  }
})
```

**注意**：`onPttDown` 里的 showInactive 已经移除，但识别成功后 sidebar 仍会通过 `revealSidebar` IPC 触发 showInactive。**sidebar 第一次显示仍会阻塞 main ~1-2s**。

如果用户在这期间想再按 PTT（toggle 模式），globalShortcut callback 排队等到 sidebar 加载完，**用户体验上感觉"第二次按键不响应"**。这非常可能是用户报告"用了第一次以后第二次就不会再触发了"的真因。

### 🟡 BUG-8：voiceBuffer 在 race condition 下可能丢

**位置**：`renderer/sidebar.html` L2753

```js
voiceWorklet.port.onmessage = (e) => { if (voiceCapturing) voiceBuffer.push(e.data) }
```

stopVoiceCapture 一开始就把 `voiceCapturing = false`：
```js
voiceCapturing = false
hideVoiceBanner()
const buffered = voiceBuffer       // 引用，之后不再 push
const inputRate = voiceWorkletInputRate
const dur = Date.now() - voiceStartedAt
await teardownVoiceGraph()         // ← 此前 worklet 还在跑，但 onmessage 短路
```

teardownVoiceGraph 是异步的（`voiceCtx.close()` 是 promise）。在 close 完成前，worklet 还在 post 消息，但都被 `if (voiceCapturing)` 短路。**末尾 50-100ms 的音频被丢**。

非致命但影响识别尾部完整性。

### 🟡 BUG-9：showCharBubble("💭 解析中...", duration:1800) 太短

**位置**：`main.js` L558

实际识别 + IPC 往返耗时 200ms-2s。"💭 解析中..." 1.8s 后消失。如果识别 > 1.8s，bubble 会先消失再被 sidebar 的 setQuip 覆盖（success 模式）。中间有 "无 bubble 状态"。

非 bug，但 UX 抖动。

### 🟢 ISSUE-10：force-stop 不会唤醒 sidebar 的 voiceCapturing

**位置**：`main.js` L1554-1560

`voice:force-stop` 直接 `onPttUp()` → 发 `voice:stop` IPC → sidebar 的 stopVoiceCapture 应该能跑。

**但如果 sidebar renderer 被卡了**（比如某种死锁），voice:stop IPC 不会处理，主进程以为成功了，实际 mic 还开着。

低概率，但兜底不够硬。

### 🟢 ISSUE-11：dead code / 死变量

- `_pttBubbleTimer` 声明了但从未使用
- 旧代码里可能有 `voice_debug` preference 的引用，state 里没声明（_state.preferences.voice_debug）

### 🟢 ISSUE-12：mode 切换时未检查当前是否正在录音

`voice:set-mode` 直接 `_pttPressed = false; _pttToggleActive = false`，但**没发 voice:stop IPC 给 sidebar**。如果用户在录音中切换模式：
- 主进程认为 PTT 停了
- sidebar 里 voiceCapturing=true，mic 还开着
- 下次 PTT 按下，startVoiceCapture 的 `if (voiceCapturing) return` 短路 → 永远启不来

### 🟢 ISSUE-13：parseAccelForUiohook 不识别 numpad / 多媒体键

如果用户用 ⏺ 录制 录了 Numpad+号、播放/暂停、Volume Up 等键，`UiohookKey['NumpadAdd']` 大概率不存在 → 解析失败 → spec=null → hold 模式不工作。

低概率（用户一般不会用这些做 PTT），但也是个边界。

### 🟢 ISSUE-14：toggle callback 闭包 vs accel 变化

```js
globalShortcut.register(accel, () => { _pttToggleActive = !_pttToggleActive; ... })
```

callback 不依赖 accel 变量。但每次 _registerVoicePTTToggle 都创建新闭包。OK，但每次切换都"丢弃"一个闭包，长期运行有微小内存堆积。无害。

---

## 4. "第二次按键不触发" / "持续触发 pressed/released" 根因（合并分析）

**结论已变**：v1.0 报告里说"第二次不触发"最可能是 BUG-7（sidebar 阻塞），实测推翻——
**用户长按时根本是 BUG-0（auto-repeat 反复触发）让 callback 跑了几十次，肉眼看上去最后状态不对，所以以为"第二次不响应"。**

按概率排（更新后）：

| 假设 | 证据 | 处方 |
|---|---|---|
| **BUG-0：用户按住时 OS 自动连发让 callback 跑 N 次，最终 toggle 状态和用户预期不一致** | 实测 log 26+ 行 pressed/released 交替 | 加 300ms 去抖（Priority 0） |
| **BUG-7：sidebar 首次 reveal 阻塞 1-2s** | 仍然是问题但被 BUG-0 掩盖 | sidebar 启动预热 |
| **BUG-1 + BUG-2：mode 状态错乱** | 多次切换模式 / 改热键后会触发 | 重构 mode 判断 + listener 一次性挂载 |
| **BUG-8：voiceBuffer 尾部丢失** | 不影响触发，只影响识别质量 | teardown 顺序修正 |

---

## 5. 改动建议（给 Claude Code 的 prompt 素材）

按修复优先级排：

### 🔥 Priority 0 — 修 BUG-0（toggle 模式 OS 连发去抖）⚠ 最紧急

`_registerVoicePTTToggle()` 内的 callback 加去抖：

```js
let _lastTogglePressTime = 0
const TOGGLE_DEBOUNCE_MS = 300

function _registerVoicePTTToggle() {
  const accel = (_state.preferences && _state.preferences.voice_input_shortcut) || 'CommandOrControl+Alt+V'
  if (_pttToggleAccel && _pttToggleAccel !== accel) {
    try { globalShortcut.unregister(_pttToggleAccel) } catch {}
  }
  _pttToggleAccel = accel
  try {
    const ok = globalShortcut.register(accel, () => {
      const now = Date.now()
      if (now - _lastTogglePressTime < TOGGLE_DEBOUNCE_MS) {
        // OS keyboard auto-repeat fires WM_HOTKEY at ~30Hz when the combo is
        // held; without this guard, _pttToggleActive flips at 30Hz and PTT
        // becomes unusable. Also catches accidental human double-taps.
        return
      }
      _lastTogglePressTime = now
      _pttToggleActive = !_pttToggleActive
      if (_pttToggleActive) onPttDown()
      else onPttUp()
    })
    ...
  } catch (e) { ... }
}
```

修完后验收：按住热键 2 秒，松手。预期看到**只有一对** `PTT pressed` / `PTT released`。

### Priority 1 — 修 BUG-1（mode 判断错误）

`_reregisterShortcut('voice', accel)` 改成判断 `_state.preferences.voice_input_mode`：

```js
if (kind === 'voice') {
  _state.preferences.voice_input_shortcut = accel
  const isHold = _state.preferences.voice_input_mode === 'hold'
  if (isHold && uIOhook && UiohookKey) {
    _refreshPttUiohookSpec()
    if (!_pttUiohookSpec) return { ok: false, error: 'unparseable_key' }
    return { ok: true, mode: 'hold' }
  }
  // toggle path
  const ok = _registerVoicePTTToggle()
  return { ok: !!ok, mode: 'toggle', error: ok ? undefined : 'register_failed' }
}
```

### Priority 2 — 修 BUG-2（listener 累积）

把 hold 模式 listener 注册改成"启动时挂一次，终生不变"，handler 内部根据 `_pttUiohookSpec` 和 `_state.preferences.voice_input_mode` 决定行为。把 `uIOhook.on(...)` 移出 `registerVoicePTT()`，挪到 app.whenReady 里只跑一次的 init 段（且必须在 `uIOhook.start()` 之前）。

切换模式时只改 `_pttUiohookSpec` 和 `_state.preferences.voice_input_mode`，不动 listener。

### Priority 3 — 修 BUG-7（sidebar 首次 reveal 阻塞）

两个方案任选：

**方案 A**：sidebar 在 createWindows 里就 showInactive 一次，立即 hide。让 HTML/JS 提前 parse。
**方案 B**：用 `BrowserWindow.show: true` 但靠 transparent + alpha 0 隐藏，让 OS 分配窗口资源但视觉不见。
**方案 C**：把 sidebar.html 拆小（91KB → 多份 lazy import）。

### Priority 4 — 修 BUG-3（enabled flag 卡死）

initRecognizer 成功后显式重置：
```js
const ok = voice.initRecognizer()
if (ok) {
  if (_state.preferences) _state.preferences.voice_input_enabled = true
  registerVoicePTT()
} else {
  ...
}
```

### Priority 5 — 修 ISSUE-12（mode 切换不通知 sidebar）

`voice:set-mode` 切换之前如果 _pttPressed/_pttToggleActive 为 true，先 onPttUp() 让 sidebar 清状态。

### Priority 6 — 修 BUG-8（teardown race，丢尾部音频）

stopVoiceCapture 的顺序改成：
1. disconnect worklet（停止 push）
2. 等一帧（让 in-flight messages 落到 buffer）
3. 取 buffered
4. 关 ctx + stream

```js
async function stopVoiceCapture() {
  if (!voiceCapturing) { hideVoiceBanner(); return }
  voiceCapturing = false
  // 先断开输入，stop pushing
  try { voiceMediaSrc && voiceMediaSrc.disconnect() } catch {}
  // 让 worklet 处理完 in-flight 帧
  await new Promise(r => setTimeout(r, 50))
  hideVoiceBanner()
  const buffered = voiceBuffer
  ...
  await teardownVoiceGraph()
  ...
}
```

### Priority 7 — 加调试 log

在以下位置加 console.log（不依赖 VOICE_DEBUG）：
- _registerVoicePTTToggle 注册时打印 register 返回值 + accel
- voice:set-mode 进入和退出
- voice:force-stop 触发
- voice:transcribe handler 入口和出口（含耗时）
- onPttDown / onPttUp 当前 mode 和 _pttPressed/_pttToggleActive 状态

---

## 6. 给下游的 prompt 模板（你可以复制改）

```
银狼桌宠 voice 系统现在有几个 bug 要修。详细审查见 docs/voice-code-review.md。请按这个优先级逐项修：

🔥 0. (最紧急) main.js _registerVoicePTTToggle 注册的 callback 加 300ms 去抖。当前 toggle
      模式下用户长按热键会导致 OS 自动连发反复触发 callback，pressed/released 高频
      交替，PTT 不可用。详见 §3 BUG-0 + §5 Priority 0。

1. main.js _reregisterShortcut('voice') 用 _state.preferences.voice_input_mode 判断 mode，
   不要用 _pttUiohookStarted（BUG-1）

2. main.js registerVoicePTT() hold 分支的 uIOhook.on(...) 全部挪到 app.whenReady 里
   只跑一次，handler 内通过 _pttUiohookSpec 和 voice_input_mode 决定行为；同时移除
   _pttModifierWatchdog 在 keydown 上的重复挂载（BUG-2）

3. main.js sidebar 首次 reveal 阻塞主线程的问题：在 createWindows 里立即 showInactive
   一次再 hide，让 sidebar.html 预 parse，避免后续 sidebar:reveal 阻塞 1-2s（BUG-7）

4. main.js whenReady 里 voice.initRecognizer() 成功时显式 _state.preferences.voice_input_enabled = true
   覆盖之前可能持久化的 false（BUG-3）

5. main.js voice:set-mode handler 在切换前如果 _pttPressed 或 _pttToggleActive 为 true，
   先调 onPttUp() 让 sidebar 同步停止 capture（ISSUE-12）

6. renderer/sidebar.html stopVoiceCapture 在断开 worklet 后等 50ms 再取 buffer，
   避免尾部音频丢失（BUG-8）

修完所有项后跑一次完整 PTT 流程（toggle 模式默认）：
- 启动 → 按一次热键 → 看 'PTT pressed' log → 说话 → 再按一次 → 看 'PTT released' log
- ★ 关键验收：按住热键 3 秒，应该只看到一对 pressed/released，不能反复触发（BUG-0）
- 验证 sidebar 弹出，user msg 是说的内容
- 再按一次热键应该能再次开始录音
- 在设置面板切换模式 + 改热键各 2 次，确保不卡
- 改完跑 docs/voice-input-accuracy-test.md 跑一遍准度测试
```

---

*Last updated: 2026-04-27*
