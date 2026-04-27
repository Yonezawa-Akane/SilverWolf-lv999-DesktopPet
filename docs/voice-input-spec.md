# 语音输入 PTT 实现规格 (v0.1 draft)

> 此文档是给 **Claude Code** 的实现交接单。读完即可动手，不需要再做架构决策。
> 所有"为什么"的设计权衡见 `## 决策记录`。改方案前先和用户对齐。

---

## 0. 目标 (TL;DR)

给银狼桌宠加一个 Discord 风格的 **按住说话 (Push-to-Talk)** 入口：

1. 用户按住 `Ctrl+Alt+V` → 银狼气泡冒出 `🎙️ 听着呢...` (cyan/processing)，开始录音
2. 用户松手 → 停止录音 → SenseVoice-Small 离线识别 → 文字塞进 `#inp` → 调用现有 `sendMsg()`
3. 等同于"用户手敲完话按回车"，无缝接入现有 agentic 循环
4. 离线、零网络依赖、中英粤日韩五语种、~70ms 推理

---

## 1. 技术栈

| 项 | 选型 | 备注 |
|---|---|---|
| ASR 引擎 | `sherpa-onnx-node` (npm) | k2-fsa 官方维护的 Node.js 绑定 |
| 模型 | `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17` | int8 量化，~234MB |
| 全局热键监听 | `uiohook-napi` (npm) | Electron 原生 `globalShortcut` 只能单击，听不到 keydown/keyup |
| 音频采集 | `getUserMedia` + `AudioContext`(16kHz) + `AudioWorkletNode` | 纯 Web API，无需新依赖 |
| 降级方案 | `globalShortcut` toggle 模式 | 当 `uiohook-napi` 加载失败时使用 |

**新增 npm 依赖**（写入 `package.json` `dependencies`）:
```json
"sherpa-onnx-node": "^1.10.0",
"uiohook-napi": "^1.5.4"
```
> 版本号以 npm 最新稳定版为准，安装时 `npm install <pkg>` 自动写入。

---

## 2. 用户需要预先放置的资源

**必须由用户手动下载并放进项目根目录**（避免 `npm install` 拉 ~234MB）:

```
项目根目录/
└── assets/
    └── models/
        └── sense-voice/
            ├── model.int8.onnx       # ~234MB，必须
            └── tokens.txt            # ~25KB，必须
```

**下载来源**（下方 `## 资源下载清单` 章节列出完整 URL）

实现时如果 `assets/models/sense-voice/model.int8.onnx` 不存在：
- 不报致命错误
- `voice_input_enabled` 自动置 false
- 启动时一次性 bubble 提示：`语音模型没塞进来，去 docs/voice-input-spec.md 看下载说明`

---

## 3. 数据流

```
[user 按下 Ctrl+Alt+V]
        │
        ▼
[uiohook-napi keydown]  ──── main.js
        │
        ├─→ showCharBubble('🎙️ 听着呢...', { source:'voice', mood:'processing', duration:30000 })
        ├─→ launcherWin.send('voice-active', true)        ── 启动 halo 加速 + cyan tint
        └─→ sideWin.send('voice:start')                    ── 让 sidebar 启动 MediaRecorder
                                                                │
                                                                ▼
                                                  [sidebar.html: getUserMedia + AudioWorklet]
                                                  累积 Float32Array PCM 16kHz mono
                                                                │
[user 松开 Ctrl+Alt+V]
        │
        ▼
[uiohook-napi keyup]  ──── main.js
        │
        └─→ sideWin.send('voice:stop')
                                                                │
                                                                ▼
                                                  [sidebar.html] 停止 worklet
                                                  invoke('voice:transcribe', { samples, sampleRate })
                                                                │
                                                                ▼
                                              [main.js: ipcMain.handle('voice:transcribe')]
                                              recognizer.createStream()
                                              stream.acceptWaveform({ samples, sampleRate:16000 })
                                              recognizer.decode(stream)
                                              text = recognizer.getResult(stream).text
                                              return text
                                                                │
                                                                ▼
                                                  [sidebar.html] 拿到 text:
                                                  - 太短 (<2 字 / <300ms) → bubble alert "没听清"，return
                                                  - 正常 → inpEl.value = text; sendMsg()
                                                  - 同时 showCharBubble('✓ ' + text.slice(0,20), { mood:'success' })
                                                                │
                                                                ▼
                                                  现有 agentic 循环接管，银狼正常回复
```

---

## 4. 文件改动清单

### 4.1 `package.json`
增加两条 dependencies（详见 §1）。

### 4.2 `main.js`
**(A) 顶部 require:**
```js
const sherpa = require('sherpa-onnx-node')
let uIOhook = null  // optional, lazy-loaded
try { uIOhook = require('uiohook-napi').uIOhook } catch (e) {
  console.warn('[voice] uiohook-napi 加载失败，PTT 降级为 toggle 模式:', e.message)
}
```

**(B) DEFAULT_STATE.preferences 增加字段:**
```js
voice_input_shortcut: 'CommandOrControl+Alt+V',
voice_input_enabled: true,                  // 模型缺失时自动 false
voice_input_language: 'auto',               // 'auto' | 'zh' | 'en' | 'yue' | 'ja' | 'ko'
voice_input_min_duration_ms: 300,           // 短于这个阈值就丢弃，避免误触
voice_input_max_duration_ms: 30000          // 上限保护
```

**(C) 新模块（建议新建 `services/voice.js`，main.js 只引用）:**
```js
// services/voice.js
const path = require('path')
const fs = require('fs')
const sherpa = require('sherpa-onnx-node')

let recognizer = null
let modelReady = false

function initRecognizer() {
  const modelDir = path.join(__dirname, '..', 'assets', 'models', 'sense-voice')
  const modelPath  = path.join(modelDir, 'model.int8.onnx')
  const tokensPath = path.join(modelDir, 'tokens.txt')
  if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
    console.warn('[voice] 模型文件缺失:', modelPath)
    return false
  }
  try {
    recognizer = new sherpa.OfflineRecognizer({
      modelConfig: {
        senseVoice: {
          model: modelPath,
          language: 'auto',
          useInverseTextNormalization: 1,
        },
        tokens: tokensPath,
        numThreads: 2,
        debug: 0,
        provider: 'cpu',
      }
    })
    modelReady = true
    console.log('[voice] SenseVoice 模型加载完成')
    return true
  } catch (e) {
    console.error('[voice] 模型初始化失败:', e)
    return false
  }
}

function transcribe(float32Samples, sampleRate) {
  if (!modelReady || !recognizer) return ''
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples: float32Samples, sampleRate })
  recognizer.decode(stream)
  const r = recognizer.getResult(stream)
  // SenseVoice 输出可能含 <|zh|><|NEUTRAL|><|Speech|> 这种前缀 tag —— 用正则剥掉
  return (r.text || '').replace(/<\|[^|]*\|>/g, '').trim()
}

function isReady() { return modelReady }

module.exports = { initRecognizer, transcribe, isReady }
```

**(D) 在 `app.whenReady().then(...)` 里：**
```js
// 异步初始化，不阻塞启动
const voice = require('./services/voice')
setTimeout(() => {
  if (!voice.initRecognizer()) {
    if (_state.preferences) _state.preferences.voice_input_enabled = false
    showCharBubble('语音模型没塞进来，PTT 暂时不能用～', { source:'voice', mood:'alert', duration:4000 })
  }
}, 800)

// 注册 PTT 热键
registerVoicePTT()
```

**(E) 新函数 `registerVoicePTT()`：**
```js
const PTT_KEYCODES = {
  // uiohook-napi UiohookKey 常量映射；以 Ctrl+Alt+V 为例
  // 实际实现里直接 import { UiohookKey } from 'uiohook-napi'
  SPACE: 57,
  CTRL_L: 29, CTRL_R: 3613,
  ALT_L: 56,  ALT_R: 3640,
}

let _pttPressed = false

function registerVoicePTT() {
  if (!_state.preferences || !_state.preferences.voice_input_enabled) return

  if (uIOhook) {
    // 主路径：hold-to-talk
    const isCtrlAltSpace = (e) => e.keycode === PTT_KEYCODES.SPACE && e.altKey && e.ctrlKey

    uIOhook.on('keydown', (e) => {
      if (!isCtrlAltSpace(e) || _pttPressed) return
      _pttPressed = true
      onPttDown()
    })
    uIOhook.on('keyup', (e) => {
      if (e.keycode !== PTT_KEYCODES.SPACE || !_pttPressed) return
      _pttPressed = false
      onPttUp()
    })
    uIOhook.start()
    console.log('[voice] PTT (hold mode) 注册成功')
  } else {
    // 降级路径：toggle，按一下开 / 再按一下结束
    const accel = _state.preferences.voice_input_shortcut || 'CommandOrControl+Alt+V'
    let toggling = false
    globalShortcut.register(accel, () => {
      toggling = !toggling
      if (toggling) onPttDown(); else onPttUp()
    })
    console.log('[voice] PTT (toggle fallback) 注册成功')
  }
}

function onPttDown() {
  if (!voice.isReady()) {
    showCharBubble('模型还没准备好。', { source:'voice', mood:'alert', duration:1800 })
    return
  }
  showCharBubble('🎙️ 听着呢...', { source:'voice', mood:'processing', duration: 30000 })
  if (alive(launchWin)) launchWin.webContents.send('voice-active', true)
  if (alive(sideWin))   sideWin.webContents.send('voice:start')
}

function onPttUp() {
  if (alive(launchWin)) launchWin.webContents.send('voice-active', false)
  if (alive(sideWin))   sideWin.webContents.send('voice:stop')
  // bubble 由 sidebar 拿到结果后接管（success/alert）
}
```

**(F) 新增 IPC handler:**
```js
ipcMain.handle('voice:transcribe', async (_e, payload) => {
  // payload: { samples: Array<number>, sampleRate: number }
  if (!voice.isReady()) return { ok:false, error:'model_not_ready' }
  try {
    const f32 = new Float32Array(payload.samples)
    const text = voice.transcribe(f32, payload.sampleRate)
    return { ok:true, text }
  } catch (e) {
    console.error('[voice] transcribe failed:', e)
    return { ok:false, error: e.message }
  }
})
```

**(G) 在 `app.on('before-quit', ...)` 里清理：**
```js
if (uIOhook) { try { uIOhook.stop() } catch {} }
```

### 4.3 `preload.js`
增加：
```js
onVoiceStart:    (cb)              => ipcRenderer.on('voice:start', cb),
onVoiceStop:     (cb)              => ipcRenderer.on('voice:stop',  cb),
voiceTranscribe: (samples, sr)     => ipcRenderer.invoke('voice:transcribe', { samples, sampleRate: sr }),
onVoiceActive:   (cb)              => ipcRenderer.on('voice-active', (e, v) => cb(v)),  // launcher 用
```

### 4.4 `renderer/sidebar.html`
**(A) 顶部新增模块（在 `<script>` 里现有代码末尾）:**

```js
// ── Voice PTT ──────────────────────────────────
let voiceCtx = null
let voiceWorklet = null
let voiceStream = null
let voiceBuffer = []   // 累积的 Float32 PCM 块
let voiceStartedAt = 0
const VOICE_SAMPLE_RATE = 16000
const VOICE_MIN_MS = 300

async function startVoiceCapture() {
  voiceBuffer = []
  voiceStartedAt = Date.now()
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: VOICE_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    voiceCtx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
    // AudioWorklet 内联代码：把每个 128 samples 的 Float32 通过 port 发给主线程
    const workletCode = `
      class Cap extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0][0]
          if (ch && ch.length) this.port.postMessage(ch.slice(0))
          return true
        }
      }
      registerProcessor('cap', Cap)
    `
    const blob = new Blob([workletCode], { type:'application/javascript' })
    await voiceCtx.audioWorklet.addModule(URL.createObjectURL(blob))
    const src = voiceCtx.createMediaStreamSource(voiceStream)
    voiceWorklet = new AudioWorkletNode(voiceCtx, 'cap')
    voiceWorklet.port.onmessage = (e) => voiceBuffer.push(e.data)
    src.connect(voiceWorklet)
    showVoiceBanner()  // 在 chat 区域显示 "🎙️ 听着呢... ●●●"
  } catch (e) {
    console.error('[voice] mic 启动失败:', e)
    addMsg('ai', '麦克风没授权，去系统设置打开吧。')
  }
}

async function stopVoiceCapture() {
  if (!voiceCtx) return
  try { voiceWorklet && voiceWorklet.disconnect() } catch {}
  try { voiceStream && voiceStream.getTracks().forEach(t => t.stop()) } catch {}
  try { await voiceCtx.close() } catch {}
  hideVoiceBanner()

  const dur = Date.now() - voiceStartedAt
  voiceCtx = voiceWorklet = voiceStream = null
  if (dur < VOICE_MIN_MS || voiceBuffer.length === 0) return  // 误触，丢弃

  // 拼接所有 chunks 成一个 Float32Array
  const total = voiceBuffer.reduce((n, b) => n + b.length, 0)
  const merged = new Float32Array(total)
  let off = 0
  for (const b of voiceBuffer) { merged.set(b, off); off += b.length }
  voiceBuffer = []

  // 注意：IPC 不能直接传 Float32Array，要转成普通数组（Electron 25+ 可以，但安全起见用 Array.from）
  // 实测：130KB Float32Array 直接传也可以；超大要考虑 transferable，但 30s 上限内问题不大
  showTyping()  // 复用现有的 .tyd 三点动画
  try {
    const r = await window.sw.voiceTranscribe(Array.from(merged), VOICE_SAMPLE_RATE)
    hideTyping()
    if (!r || !r.ok || !r.text) {
      addMsg('ai', '没听清，再说一遍？')
      return
    }
    inpEl.value = r.text
    autoH(inpEl)
    sendMsg()  // ★ 等同于按回车
  } catch (e) {
    hideTyping()
    console.error('[voice] transcribe 失败:', e)
    addMsg('ai', '识别炸了：' + e.message)
  }
}

// 简单 banner，复用 chat 上方区域
let _voiceBannerEl = null
function showVoiceBanner() {
  if (_voiceBannerEl) return
  const el = document.createElement('div')
  el.id = 'voice-banner'
  el.innerHTML = '🎙️ 听着呢 <span class="tyd"></span><span class="tyd"></span><span class="tyd"></span>'
  // 样式可以放 <style> 里：fixed top, 半透明 cyan 框，z-index 高
  el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);' +
    'background:rgba(6,2,18,.95);border:1px solid rgba(34,211,238,.7);' +
    'color:#bef;padding:6px 14px;border-radius:8px;font-size:11px;z-index:9999;' +
    'box-shadow:0 0 12px rgba(34,211,238,.45)'
  document.body.appendChild(el)
  _voiceBannerEl = el
}
function hideVoiceBanner() {
  if (_voiceBannerEl) { _voiceBannerEl.remove(); _voiceBannerEl = null }
}

// IPC 绑定
window.sw.onVoiceStart(() => startVoiceCapture())
window.sw.onVoiceStop(()  => stopVoiceCapture())
```

### 4.5 `renderer/launcher.html`
**(A) 在 `<style>` 里加：**
```css
body.voice-active #halo {
  animation: halo 1.0s ease-in-out infinite;  /* 加速 */
  background: linear-gradient(135deg, var(--cyan), var(--pink));
}
body.voice-active #core {
  border-color: var(--cyan);
  filter: drop-shadow(0 0 8px var(--cyan));
}
```

**(B) 在 `<script>` 末尾加：**
```js
window.sw.onVoiceActive(v => {
  document.body.classList.toggle('voice-active', !!v)
})
```

### 4.6 `scripts/build.js`
**当前 `prune: false` 已确保 `node_modules` 全打包**，所以 `sherpa-onnx-node` 和 `uiohook-napi` 的 native binaries 会自动带上。

**但模型文件**默认在 `assets/models/sense-voice/`，由于 `assets/` 没在 ignore 列表里，会随包发布——**但要确认体积**：
- 现有 dist zip ~150MB
- 加上模型 +234MB → 总包 ~400MB

如果想保持 dist zip 小，可以采用"首次启动从 Hugging Face 下载到 `userData/models/`"的方案。但这违背"完全离线"的原则，**默认不采用**，仅作为 v0.2 优化项备选。

如果用户允许包变大，无需改 build.js。

如果想从 dist 排除模型并让用户手动放：在 `ignore` 数组里加：
```js
/^\/assets\/models(\/|$)/
```
然后 `services/voice.js` 改成同时检查 `path.join(app.getPath('userData'), 'models', 'sense-voice')` 作为 fallback。

**默认采用：模型随包打包**（最简，与项目"开箱即用"调性一致）。

---

## 5. 错误处理 / 边界情况

| 情况 | 行为 |
|---|---|
| 模型文件缺失 | 启动时一次性 bubble 提示；`voice_input_enabled = false`；PTT 热键不注册 |
| `uiohook-napi` 加载失败 | 自动降级 `globalShortcut` toggle 模式；console warn |
| 麦克风权限拒绝 | 在 sidebar 加一条系统消息提示用户去 Windows 设置打开 |
| 录音 < 300ms | 静默丢弃（误触防护） |
| 录音 > 30s | 正常截断到 30s 提交，不报错 |
| 识别为空字符串 | 气泡 alert "没听清，再说一遍？"，不调 sendMsg |
| sidebar 关闭时按 PTT | 仍触发录音；识别后**自动打开 sidebar**再 sendMsg（参考现有 `toggleSidebar` 逻辑） |
| 同时按下另一个全局热键 | uiohook 模式下互不干扰；toggle 模式下 globalShortcut 是独占的，多重按键就是分别响应 |
| sidebar reload 时还在录音 | 优雅 stop，不留资源 |

---

## 6. 验收测试清单

> Claude Code 写完后跑一遍这个列表确认。

1. ✅ 按住 `Ctrl+Alt+V` → 银狼气泡显示 `🎙️ 听着呢...`，launcher hex 变 cyan + halo 加速
2. ✅ 说"你好世界" → 松手 → sidebar 自动出现 user msg "你好世界"，agentic 循环正常运行
3. ✅ 中英混说 "帮我 debug 这段 code" → 识别准确（SenseVoice 强项）
4. ✅ 说不到 0.3 秒 → 不触发任何输入（误触保护）
5. ✅ 关闭 sidebar 状态下按 PTT → 识别后 sidebar 自动打开 + 显示对话
6. ✅ 删掉 `model.int8.onnx` 重启 → 启动 bubble 提示模型缺失，PTT 不响应
7. ✅ `npm uninstall uiohook-napi` 后启动 → console warn + 自动用 toggle 模式（按一下开，再按一下提交）
8. ✅ `build.js` 打包 → dist zip 解压后双击 .exe → PTT 仍工作（验证 native binding 打包正确）
9. ✅ Windows 设置里关闭麦克风权限 → PTT 时友好提示，不崩
10. ✅ 长按 60 秒（>30s 上限）→ 正常截断、识别、提交，不报错
11. ✅ 从全屏游戏 alt-tab 出来后 PTT 仍正常工作（验证 uiohook 不会被 z-order 影响）

---

## 7. 决策记录 (DR)

### DR-1: 为什么选 SenseVoice-Small 而不是 Paraformer / FireRedASR / Whisper
- **vs Paraformer**: SenseVoice 中英都强，Paraformer 偏中文，桌宠用户大概率说"帮我打开 GitHub"这种混读
- **vs FireRedASR**: FireRedASR-AED 1.1B 参数太重，桌宠常驻吃 RAM；FireRedASR-LLM 8.3B 必须 GPU
- **vs Whisper-v3-Turbo**: 中文 CER 高、原生不支持流式、模型 ~700MB 比 SenseVoice int8 大 3 倍
- SenseVoice-Small 70M 参数 + 70ms / 10s 音频，**对桌宠场景这是甜蜜点**

### DR-2: 为什么选 hold-to-talk 而不是 toggle
- 用户原话："按下快捷键... 松手就直接进行执行"，明确是 Discord 风格
- toggle 容易忘按第二下导致一直录
- 但保留 toggle 作为 uiohook-napi 不可用时的降级（部分 Windows 系统 native module 编译失败）

### DR-3: 为什么不直接用 CapsWriter-Offline
- 它是独立进程 + 全局 keyboard hook 输入，相当于"打字"到任何窗口
- 桌宠需要的是把识别结果直接喂进自己的 sidebar input，再触发 sendMsg
- 走外挂工具路径意味着 sidebar 需要监听焦点 + 文字注入，反而绕远

### DR-4: 模型放本地 vs 启动时下载
- 默认本地：包大但开箱即用，符合项目"双击 .exe 就能用"的调性
- 启动时下载：包小但首次需要联网 + 失败处理复杂，留作 v0.2 选项

### DR-5: 为什么 PCM 走 IPC 不走文件
- 30s 16kHz mono Float32 = 1.92MB，IPC 直传完全 OK（Electron 内部走结构化克隆）
- 写文件多一次 I/O + 清理负担，不值得

### DR-6: hotkey 选 Ctrl+Alt+V
- 早期版本（v0.1）默认 `Ctrl+Alt+Space`，但 **Claude Desktop 全局召唤热键就是 Ctrl+Alt+Space**，撞车
- 改为 `Ctrl+Alt+V`（V = Voice 助记），与现有 `Ctrl+Alt+W` (Wake) 同 Ctrl+Alt+字母系列，无系统/应用冲突
- 设置面板暴露三个热键的可视化录制 UI，不锁死

### DR-7: 设置面板可视化热键修改 (v0.2)
- 三个全局热键（语音 / 截屏 / 召回）在 sidebar settings 面板都暴露了"录制"按钮
- 用户点击 "⏺ 录制" → 按下任意 modifier+key 组合 → 自动转为 Electron accelerator 字符串 → IPC `shortcuts:set` 给 main → main 验证（OS 不接受时回滚 + 提示）
- 修改对 hold-mode (uiohook) 和 toggle-mode (globalShortcut) 都生效；hold-mode 不需要重新注册（handler 每次 keydown 重读 `_pttUiohookSpec`），toggle-mode 走 unregister + register
- ESC 键退出录制；点同一个"录制"按钮也是取消

---

## 8. 资源下载清单 (给用户看)

### 8.1 模型文件（必须）

**方案 A — 命令行下载（推荐，已自带 sha 校验）:**

```bash
# 1. 下载 (~113MB tar.bz2)
curl -L -o sense-voice.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2

# 2. 解压
tar -xjf sense-voice.tar.bz2

# 3. 把模型文件放进项目
mkdir -p assets/models/sense-voice
cp sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.int8.onnx assets/models/sense-voice/
cp sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tokens.txt      assets/models/sense-voice/
```

**方案 B — 浏览器下载（手动）:**

直接访问 [GitHub Releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) 找 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`，下载后用 7-Zip 解压两次（先解 .bz2 再解 .tar）。

**最终目录结构:**
```
SilverWolf-lv999-DesktopPet/
└── assets/
    └── models/
        └── sense-voice/
            ├── model.int8.onnx       (~234MB)
            └── tokens.txt            (~25KB)
```

### 8.2 npm 包（实现时跑一次即可）

```bash
npm install sherpa-onnx-node uiohook-napi
```

如果 `uiohook-napi` 在 Windows 上编译失败（有时缺少 VC++ Build Tools），可以跳过——降级 toggle 模式仍可用，只是失去 hold-to-talk 体验。

### 8.3 .gitignore 调整

模型文件不要进 git：
```
# 在 .gitignore 末尾追加
assets/models/sense-voice/*.onnx
assets/models/sense-voice/*.bin
```

`tokens.txt` 较小（~25KB）可以入库，方便协作者验证目录结构。

---

## 9. v0.2 备选优化（不在本次范围）

- 实时流式识别（边说边出文本到 banner，给用户即时反馈）
- VAD（Voice Activity Detection）自动判断说完，连"松手"都省了
- 情感 tag 反向映射到银狼气泡 mood：愤怒→alert / 开心→success
- 多麦克风设备选择 UI
- 识别置信度低时 highlight 可疑词（让用户编辑后再发）
- 离线下载模型（启动时拉取到 userData/）

---

## 10. 给 Claude Code 的最后嘱托

1. **顺序**：先改 `package.json` → `services/voice.js` → `main.js` → `preload.js` → `sidebar.html` → `launcher.html` → `build.js`（如需要）
2. **测试时**先在 dev 模式 (`npm start`) 跑通，再 `node scripts/build.js` 验证打包产物
3. **不要**改动现有的 `globalShortcut` 注册（截屏 / 召回那两个），它们工作良好
4. **不要**修改 `showCharBubble` 的签名，照现有 `{source, mood, duration}` 调用
5. **不要**在 `assets/sw_*.png` 上花时间，跟语音无关
6. 任何"应该这样做但和这份 spec 冲突"的地方，先在 chat 里和用户确认再动手
