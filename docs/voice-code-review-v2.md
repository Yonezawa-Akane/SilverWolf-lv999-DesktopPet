# Voice 系统二次审查报告 v2.0

> 时间：2026-04-27
> 上一版：`docs/voice-code-review.md` v1.1（含 BUG-0 ~ BUG-9）
> 本次范围：核对 v1.1 列出的 bug 是否真被修复 + 找出 hold 模式仍卡死的根因。
> **不修改任何代码**。

---

## 1. v1.1 bug 修复状态核对

逐项核对当前 main.js 是否真的把上一份审查的 bug 修了：

| Bug | 修复状态 | 证据 |
|---|---|---|
| **BUG-0**：toggle 长按 OS 自动连发 | ✅ 已修 | L740 `if (now - _lastTogglePressTime < 300) return`，模块级 `_lastTogglePressTime` |
| **BUG-1**：mode 判断错用 `_pttUiohookStarted` | ✅ 已修（三处全改） | L770 (`_reregisterShortcut`)、L900 (`pause-capture`)、L928 (`resume-capture`) 全部改为 `voice_input_mode === 'hold'` |
| **BUG-2**：hold listener 累积 + 重复挂载 | ✅ 已修 | L575 `_installUiohookListenersOnce()` 一次性安装；L646-649 只挂 4 个 mouse 事件 watchdog（不再重挂 keydown）；listener 内通过 `_holdActive()` 判断是否生效 |
| **BUG-3**：voice_input_enabled 持久化卡死 | ✅ 已修 | L1127-1130 init 成功后无条件 `voice_input_enabled = true` + saveStateDebounced |
| **BUG-7**：sidebar 首次 reveal 阻塞 | ✅ 已修 | L987-1007 `createWindows` 里做 prewarm（off-screen showInactive→hide） |
| **BUG-8**：teardown race（尾部音频丢失） | ❓ 未确认 | 没看到 sidebar 端 stopVoiceCapture 加 50ms 等待，但这是次要 bug，不影响触发 |
| **ISSUE-12**：mode 切换不通知 sidebar | ✅ 已修 | L838-843 切换时若 `_pttPressed` 为 true 先 `onPttUp()` |

**结论**：除 BUG-8（次要、不影响 hold 触发）外，所有结构性 bug 都已经按 review 落地。

---

## 2. Hold 模式仍卡死 — 当前现象

**用户报告**（2026-04-27）：
- toggle 模式：完全工作，已上生产
- hold 模式：按下 → 控制台打 `[voice] PTT pressed → mic start sent` → 之后**完全静默**，没有 keyup log，没有任何后续事件，UI 卡住，必须强退应用

**关键差异**：toggle 走 globalShortcut（Electron 内置），hold 走 uiohook-napi（libuiohook 低级钩子）。同一台机器上，toggle 通、hold 死。说明问题**在 uiohook 一侧**，不在 voice 管线下游（onPttDown 之后的 IPC、getUserMedia、sherpa 解码都没问题，因为 toggle 模式跑通了同一条下游）。

---

## 3. Hold 模式 onPttDown 之后的执行链（重新梳理）

```
[uiohook 触发 keydown(O)，ctrl+shift 都按下]
    ↓
keydown handler 执行（L587-614）
    ├─ VOICE_DEBUG 检查（cheap）
    ├─ _holdActive() → true
    ├─ spec match → 命中
    ├─ _pttPressed === false → 设 true，调 onPttDown()
    │     ↓
    │   onPttDown()
    │     ├─ voice.isReady() → true
    │     ├─ showCharBubble('🎙️ 听着呢...', { duration: 30000 })
    │     │     ├─ charWin.webContents.send('show-quip', payload)   ★ async IPC
    │     │     └─ logBubble(...)
    │     │           ├─ _state.bubble_log.push({...})
    │     │           └─ saveStateDebounced()                        ★ 设 500ms 定时器
    │     ├─ launchWin.webContents.send('voice-active', true)        ★ async IPC
    │     ├─ sideWin.webContents.send('voice:start')                 ★ async IPC
    │     ├─ console.log('[voice] PTT pressed → mic start sent')     ← 用户看到的最后一行
    │     └─ setTimeout(_pttMaxDurationTimer, 30000)                 ★ 设 30s 定时器
    │
    └─ handler return → 控制权回到 uiohook
    
[预期发生 — 但用户报告未发生]
    ↓
[O 自动连发 keydown 多次] → handler: _pttPressed=true 早期 return（auto-repeat）
[mousemove/wheel] → _pttModifierWatchdog: 全部 modifier 仍按下，return
[用户松开 Ctrl/Shift/O] → keyup handler
    ↓
keyup handler（L616-640）
    ├─ VOICE_DEBUG 日志
    ├─ _pttHadKeyUpSinceDown = true
    ├─ _pttPressed === true ✓
    ├─ _holdActive() → true ✓
    ├─ releasingMain/Ctrl/Shift/Alt/Meta 至少一个 true → onPttUp()
    └─ console.log('[voice] PTT released → mic stop sent...')        ← 应该出现，但用户没看到

[t=500ms 后的另一个事件]
    saveStateDebounced 的 setTimeout 触发 → fs.writeFileSync(state.json)   ★ 同步阻塞 50-200ms
```

★ 标记的几个点是可疑的"放大镜"：

| 点 | 为什么可疑 |
|---|---|
| 三个 `webContents.send` 连发 | webContents.send 是异步的（fire-and-forget），不阻塞主线程。但触发了三个渲染进程的工作（character / launcher / sidebar），他们各自跑 JS 处理。不影响 main，但启动三路 IPC 后续可能"反吐"消息回 main |
| `saveStateDebounced` 设了 500ms 定时器 | 500ms 后 fs.writeFileSync 同步阻塞 50-200ms。 **如果用户按住超过 500ms（一定的）**，状态写盘的瞬间 main 被阻塞，**期间到达的 uiohook 事件被 OS 钩子超时取消的概率提高**。这可能是元凶 |
| 30s `_pttMaxDurationTimer` | 不是问题，正常的兜底 |

---

## 4. 根因假设排序（基于以上链分析）

### 🔴 假设 A：saveStateDebounced 同步写盘阻塞主线程，期间 uiohook 钩子被 OS 超时取消

**证据**：
- showCharBubble → logBubble → saveStateDebounced 设 500ms 定时器
- 用户按住热键 > 500ms 时，定时器触发 `fs.writeFileSync(state.json, ...)` 同步阻塞
- state.json 体积可能很大（conversation + bubble_log + archived_conversations + facts），在普通硬盘上写入 50-200ms 不奇怪
- libuiohook 的 WH_KEYBOARD_LL 钩子默认 ~300ms 超时（Windows 注册表 `HKLM\Control Panel\Desktop\LowLevelHooksTimeout`），单次不一定超，但**多次连续阻塞会累积**
- `if (_pttToggleAccel || _pttPressed) { ... }` 期间还有大量 IPC 消息回流（character / launcher / sidebar 各自的渲染处理），main 持续繁忙
- toggle 模式不触发这个 bug 是因为：toggle 一次按下只触发 ONE 次 onPttDown（300ms 去抖），其后 main 立即闲下来。500ms 后写盘时 main 闲，写盘不阻塞任何待处理事件

**验证方法**：临时把 `saveStateDebounced` 在 onPttDown 触发的 logBubble 调用里 **改成 fs.writeFile（异步）**，再测 hold 模式是否还卡。

### 🟡 假设 B：onPttDown 期间三个 webContents.send 触发的渲染进程"反吐"卡死 main

**证据**：
- character.html 收到 show-quip 后 setTimeout 隐藏 bubble
- launcher.html 收到 voice-active 后 toggle CSS 类 + halo 加速动画
- sidebar.html 收到 voice:start 后启动 mic capture（getUserMedia）
- 这些没回 main 的同步调用，但**渲染进程的 GPU 处理可能让 OS 整体压力上升**，间接影响 main 的钩子响应

可能性较低，因为 toggle 模式做的是同样的事，但 toggle 通。

### 🟢 假设 C：libuiohook 在用户机器上确实被某个安全软件 / 输入法干扰

**证据**：
- 之前的 log 显示按住 V 时明明 spec=O，所有 keyup 都正常出现
- 但当 spec=O、用户按 O 时，onPttDown 触发后所有事件消失
- 区别在于 onPttDown 是否被触发。**onPttDown 内部某个动作触发了第三方钩子**？比如 webContents.send 某种程度 "通知" Windows 输入法，输入法重置了 keyboard hook 链

这是环境问题，不是代码问题，但需要排除。

### 🔴 假设 D：_pttPressed=true 之后某条早期 return 把 keyup 的处理跳过

回看 keyup handler（L616-640）：

```js
uIOhook.on('keyup', (e) => {
  if (VOICE_DEBUG()) console.log(...)
  _pttHadKeyUpSinceDown = true
  if (!_pttPressed) return                     // ← 这条不会绊倒，因为 pressed=true
  if (!_holdActive()) { _pttPressed = false; onPttUp(); return }   // ← 这条也不会
  ...
})
```

**这里我要质疑一下**：如果整个 keyup handler 没有执行（包括 VOICE_DEBUG log 都没打），就说明事件根本没传到 Node。**不是 handler 内部 return 的问题**。

所以假设 D **被排除** —— keyup 根本没到 Node，问题在更底层。

---

## 5. 最有可能的根因（合并）

**主嫌疑**：假设 A —— `saveStateDebounced` 同步写盘期间 uiohook 钩子被 Windows 摘掉。

**次嫌疑**：假设 C —— 用户机器有第三方钩子干扰。

两个都可能，需要做 A/B 测试验证。

如果是假设 A，**修复非常简单**：

```js
// 把 saveStateDebounced 改成异步写盘
function saveStateDebounced() {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    fs.writeFile(stateFile(), JSON.stringify(_state, null, 2), 'utf8', (e) => {
      if (e) console.error('[state] save failed:', e.message)
    })
  }, 500)
}
```

写入失败的几率极低，且即便失败下次还会被覆盖。这条改动**几乎没风险**，可以直接上。

---

## 6. 加强诊断（在不修复的前提下先收集证据）

如果不想立刻改 saveStateDebounced，可以先加诊断：

### 诊断 D1 — 把每个 uiohook 事件无条件 log 出来

在 `_installUiohookListenersOnce()` 里，把每个 handler 的第一行从 `if (VOICE_DEBUG())` 改成 `if (true)`（或加一个新的 `_state.preferences.voice_diag` 开关）。这样 hold 模式卡住时，能直接看到事件流是否中断。

### 诊断 D2 — 加一个 watchdog setInterval

每秒记录一次"过去 1 秒收到了多少 uiohook 事件"。如果 _pttPressed=true 但连续 3 秒事件数=0，主动 console.warn 并强制 onPttUp。

```js
// 伪代码
let _uiohookEventCount = 0
let _lastPttEventTime = 0

function _trackUiohookEvent() {
  _uiohookEventCount++
  _lastPttEventTime = Date.now()
}

// 在每个 uIOhook.on(...) 的开头调用 _trackUiohookEvent()

setInterval(() => {
  if (_pttPressed && Date.now() - _lastPttEventTime > 3000) {
    console.warn('[voice] uiohook 静默 > 3s while pressed — forcing release as safety')
    _pttPressed = false
    onPttUp()
  }
  _uiohookEventCount = 0
}, 1000)
```

这样即便 hook 真被摘了，3 秒后用户也能从卡死状态恢复。

### 诊断 D3 — 在 onPttDown 末尾加 `console.log('[voice] onPttDown returned')` 一行

这能区分：
- 是 onPttDown 自己卡了（中间某条阻塞）→ 不会有 returned log
- 还是 onPttDown 跑完了但之后没事件 → 会有 returned log

如果有 returned log 但之后没事件，问题铁定在 uiohook 侧。

---

## 7. 给下游的 prompt 模板（修复 hold 模式）

```
银狼桌宠 voice 系统的 hold 模式仍然卡死。审查报告 docs/voice-code-review-v2.md
分析最可能根因是 saveStateDebounced 同步 fs.writeFileSync 阻塞主线程，期间
libuiohook 的 WH_KEYBOARD_LL 钩子被 Windows 取消。请按以下两步走：

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

第 1 步 — 修主嫌疑（几乎零风险）

文件：main.js L216
改动：把 saveStateDebounced 的 fs.writeFileSync 改成 fs.writeFile（异步）：

  function saveStateDebounced() {
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      fs.writeFile(stateFile(), JSON.stringify(_state, null, 2), 'utf8', (e) => {
        if (e) console.error('[state] save failed:', e.message)
      })
    }, 500)
  }

注意 app.on('before-quit') 里的 fs.writeFileSync(stateFile(), ...) 保持同步，
因为关机时必须立刻落盘。其他地方都改异步。

验收：hold 模式按住热键 1.5s 松开，应该看到 'PTT released → mic stop sent...'
log 出现，且 sidebar 弹出 user msg。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

第 2 步 — 加 watchdog 兜底（即使根因猜错也能救场）

文件：main.js _installUiohookListenersOnce 之后

改动：加 setInterval 监测 uiohook 静默：

  let _lastUiohookEventTime = 0
  // 在 uIOhook.on('keydown'/'keyup'/'mousemove'/...) 每个 handler 的第一行加：
  //   _lastUiohookEventTime = Date.now()
  
  setInterval(() => {
    if (!_pttPressed) return
    const since = Date.now() - _lastUiohookEventTime
    if (since > 3000) {
      console.warn('[voice] uiohook 静默', since, 'ms while pressed — 安全释放')
      _pttPressed = false
      onPttUp()
    }
  }, 1000)

验收：故意拔掉所有键盘连接，hold 模式按住后再放开（模拟 hook 失效），
3 秒后应自动 onPttUp，sidebar 不会卡 30 秒。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

第 3 步（可选）— 加无条件 log 帮诊断

文件：main.js _installUiohookListenersOnce

改动：在 keydown / keyup handler 第一行（VOICE_DEBUG 之外）加无条件 log：

  uIOhook.on('keydown', (e) => {
    console.log('[voice] uiohook keydown kc=', e.keycode)
    ...
  })

如果第 1 步修完仍然 hold 模式卡住，下次出问题时就能看 log 判断
事件是不是真到了 Node。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

完整验收测试：

[1] toggle 模式继续工作（不能因为这次改动倒退）
[2] ★ hold 模式按住热键 2 秒说"测试" → 松手 → user msg = "测试"
[3] hold 模式连续 5 轮独立测试
[4] hold 模式下用 30 秒长录音 → 仍正常完成
[5] hold 模式下故意按住超过 30s（max duration 兜底测试）→ 30s 强制结束
[6] hold→toggle→hold 切换 3 次
[7] 任何时候 hold 模式卡住 → 3s 内自动恢复（watchdog 兜底）

哪条不过就回头看 docs/voice-code-review-v2.md §4 / §5。
```

---

## 8. 总结

- **结构性 bug 全修了**（v1.1 报告里的 BUG-0/1/2/3/7、ISSUE-12 都已落地）
- **toggle 模式工作正常**，已上生产
- **hold 模式残余的卡死最可能的根因是 saveStateDebounced 同步写盘**，让 libuiohook 的 LL 钩子超时被 OS 取消
- **修复极简单**：把 fs.writeFileSync 改 fs.writeFile（异步）
- **建议同时加 watchdog 兜底**：3 秒静默自动释放，避免任何环境问题再次让用户卡 30 秒

---

*Last updated: 2026-04-27*
*Previous version: docs/voice-code-review.md (v1.1)*
