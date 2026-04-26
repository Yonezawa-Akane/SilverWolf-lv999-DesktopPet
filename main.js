const { app, BrowserWindow, ipcMain, screen, shell, Menu, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, exec } = require('child_process')

// -- Single-instance lock --
// Without this, double-clicking the .exe (or the desktop shortcut) again spawns a fresh
// Silver Wolf each time — the screen ends up filled with sprites and every window competes
// for state.json. Second instance signals the first to surface, then exits via `return`
// (CommonJS top-level return, supported by Node's module wrapper).
if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

let charWin, sideWin, launchWin
const PS = path.join(__dirname, 'scripts', 'get_windows.ps1')
const CHAR_W = 84, CHAR_H = 115            // sprite pixel size — used for visual centering math
const CHAR_WIN_W = 240, CHAR_WIN_H = 140   // window box: room for sprite at left + bubble at right
const LAUNCH_W = 120, LAUNCH_H = 120
const HELPER_W = 220, HELPER_H = 410
const POMODORO_W = 240, POMODORO_H = 180
let helperWin = null
let pomodoroWin = null
let _quickInsightShortcut = null
let launcherPosFile = null
let launcherPosSaveTimer = null

// Quick-Insight helper-pick → character bubble: mode → SW-flavored "got it" line.
const MODE_TRIGGER_TEXTS = {
  explain:   'Aha，看一眼...',
  translate: '翻译中...',
  debug:     'Debug 模式启动',
  ocr:       '扫文字中...',
  summarize: '摘要中...'
}

// Window-alive guard: `sideWin && sideWin.isVisible()` is not enough — during shutdown the JS
// reference is still truthy but the native object is destroyed, and any method call throws.
const alive = (w) => w && !w.isDestroyed()

// -- Display safety --
// Saved window positions go stale across hardware changes (lid close on a docked laptop,
// monitor unplugged, opening a saved profile on a smaller screen). Without these helpers a
// launcher position that was at x=2400 on a 4K external becomes invisible on a 1366-wide
// laptop screen, and the user can't right-click the (off-screen) launcher to fix it.

// True if a `(x, y, w, h)` rect is fully inside any current display's work area.
function isRectFullyVisible(x, y, w, h) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  for (const d of screen.getAllDisplays()) {
    const wa = d.workArea
    if (x >= wa.x && y >= wa.y &&
        x + w <= wa.x + wa.width &&
        y + h <= wa.y + wa.height) {
      return true
    }
  }
  return false
}

// Extended-desktop bounding box across all displays — used by drag clamps so the user can
// freely move a window between monitors without getting stuck at the primary's edge.
function getDesktopBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of screen.getAllDisplays()) {
    const wa = d.workArea
    if (wa.x < minX) minX = wa.x
    if (wa.y < minY) minY = wa.y
    if (wa.x + wa.width > maxX) maxX = wa.x + wa.width
    if (wa.y + wa.height > maxY) maxY = wa.y + wa.height
  }
  return { minX, minY, maxX, maxY }
}

// Clamp (x, y) so the window stays inside the extended-desktop bounding box on every axis.
// Doesn't catch the rare L-shaped multi-monitor gap, but covers the 99% case.
function clampToDesktop(x, y, w, h) {
  const b = getDesktopBounds()
  return {
    x: Math.round(Math.max(b.minX, Math.min(b.maxX - w, x))),
    y: Math.round(Math.max(b.minY, Math.min(b.maxY - h, y)))
  }
}

// Pick a safe spawn position: use the saved coords if still visible, otherwise fall back
// to the primary display's bottom-right corner with a small inset.
function safeOrFallback(savedX, savedY, w, h) {
  if (isRectFullyVisible(savedX, savedY, w, h)) {
    return { x: savedX, y: savedY }
  }
  const p = screen.getPrimaryDisplay().workArea
  return { x: p.x + p.width - w - 20, y: p.y + p.height - h - 20 }
}

// Runtime: when the display config changes, re-validate every window we know about.
// Stranded windows snap to a safe position. Only triggers a setPosition if needed so we
// don't shake static windows around on every spurious metrics change.
function rescueStrandedWindows() {
  const checkAndFix = (w) => {
    if (!alive(w)) return
    const b = w.getBounds()
    if (isRectFullyVisible(b.x, b.y, b.width, b.height)) return
    const safe = safeOrFallback(b.x, b.y, b.width, b.height)
    try { w.setPosition(safe.x, safe.y) } catch {}
  }
  checkAndFix(launchWin)
  checkAndFix(charWin)
  checkAndFix(sideWin)
  checkAndFix(helperWin)
  checkAndFix(pomodoroWin)
}

// -- UI scale --
// Per-window zoom factor controlled from the settings panel. We apply via
// webContents.setZoomFactor on every alive window so text + bubbles + menus all scale
// together. Range 0.5–2.0 is clamped; the UI exposes 4 presets (0.9 / 1.0 / 1.15 / 1.3).
function applyUiScale(scale) {
  const s = Math.max(0.5, Math.min(2.0, Number(scale) || 1.0))
  for (const w of [sideWin, charWin, launchWin, helperWin, pomodoroWin]) {
    if (alive(w)) {
      try { w.webContents.setZoomFactor(s) } catch {}
    }
  }
  return s
}

// On every window's first content load, apply the persisted ui_scale. setZoomFactor before
// did-finish-load can race the renderer init and silently no-op, so we hook the event.
function hookUiScaleOnLoad(win) {
  if (!alive(win)) return
  win.webContents.on('did-finish-load', () => {
    const s = (_state && _state.preferences && _state.preferences.ui_scale) || 1.0
    try { win.webContents.setZoomFactor(s) } catch {}
  })
}

// -- Persistent state (conversation history, preferences, learned paths, routines, facts).
// Lives at userData/state.json. Shape is stable-for-forward-compat: loadState shallow-merges
// the loaded file on top of DEFAULT_STATE so new fields added in future releases appear on
// first load without wiping anything.
const stateFile = () => path.join(app.getPath('userData'), 'state.json')

const DEFAULT_STATE = {
  version: 1,
  conversation: [],
  preferences: {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    archive_retention_days: 180,    // archived_conversations entries older than this are purged on quit
    proactive_greeting_hours: 8,    // <= 0 disables; otherwise sidebar greets if last_active older than this
    quick_insight_shortcut: 'CommandOrControl+Shift+\\',  // global hotkey for screenshot helper
    ui_scale: 1.0                   // webContents.setZoomFactor applied to every window; 0.9 / 1.0 / 1.15 / 1.3 from settings
  },
  learned_apps: {},
  routines: {},
  facts: {},
  daily_summaries: [],
  archived_conversations: [],     // [{ archived_at: ISO, messages: [...] }, ...]
  last_active: null,              // ISO timestamp; updated by renderer on each sendMsg
  user_tasks: [],                 // [{ id, text, tag, created_at, completed_at }] — no auto-purge
  pomodoro: null,                 // null OR { running, phase, label, started_at, duration_seconds, break_seconds }
  pomodoro_completed_total: 0,    // lifetime tally of completed work sessions
  pomodoro_today_date: null,      // ISO date "YYYY-MM-DD"; resets pomodoro_today_count when day changes
  pomodoro_today_count: 0,
  bubble_log: [],                 // [{ timestamp, text, source, mood }, ...] — capped at 200
  shortcut_first_run_done: false  // true once first-run desktop-shortcut prompt has been answered
}

let _state = null
let _saveTimer = null

function loadState() {
  try {
    const f = stateFile()
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'))
      _state = {
        ...DEFAULT_STATE,
        ...parsed,
        preferences: { ...DEFAULT_STATE.preferences, ...(parsed.preferences || {}) }
      }
    } else {
      _state = JSON.parse(JSON.stringify(DEFAULT_STATE))
    }
  } catch (e) {
    console.error('[state] load failed:', e.message)
    _state = JSON.parse(JSON.stringify(DEFAULT_STATE))
  }
}

function saveStateDebounced() {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify(_state, null, 2), 'utf8')
    } catch (e) {
      console.error('[state] save failed:', e.message)
    }
  }, 500)
}

// Persist a bubble shown to the user (for diagnostic / future timeline UI). Cap 200.
function logBubble(text, source, mood) {
  if (!_state.bubble_log) _state.bubble_log = []
  _state.bubble_log.push({
    timestamp: new Date().toISOString(),
    text: String(text || '').slice(0, 200),
    source: source || 'unknown',
    mood: mood || 'default'
  })
  if (_state.bubble_log.length > 200) {
    _state.bubble_log = _state.bubble_log.slice(-200)
  }
  saveStateDebounced()
}

// Push a bubble to the character window AND log it. Single canonical entrypoint
// for any main-side bubble — set-quip handler / helper-pick / future events all go through this.
function showCharBubble(text, opts) {
  if (!alive(charWin) || !text) return
  const o = opts || {}
  charWin.webContents.send('show-quip', {
    text: String(text),
    duration: o.duration || 2500,
    mood: o.mood || 'default'
  })
  logBubble(text, o.source || 'system', o.mood || 'default')
}

// On shutdown: move current `conversation` into `archived_conversations` with a timestamp,
// then drop archive entries older than preferences.archive_retention_days. Mutates state.
function archiveAndPurge(state) {
  if (!state) return
  const conv = Array.isArray(state.conversation) ? state.conversation : []
  const archives = Array.isArray(state.archived_conversations) ? state.archived_conversations : []
  const now = Date.now()

  if (conv.length > 0) {
    archives.push({
      archived_at: new Date(now).toISOString(),
      messages: conv
    })
  }

  const retentionDays = (state.preferences && Number.isFinite(state.preferences.archive_retention_days))
    ? state.preferences.archive_retention_days
    : 180
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const purged = archives.filter(a => {
    const t = a && a.archived_at ? new Date(a.archived_at).getTime() : NaN
    return Number.isFinite(t) && t >= cutoff
  })

  state.archived_conversations = purged
  state.conversation = []
  console.log(`[archive] saved 1 session (${conv.length} msgs); ${archives.length - purged.length} purged; ${purged.length} kept`)
}

// -- Pomodoro: main-process timer is the source of truth so it survives sidebar hide/show.
// Renderer only displays remaining_seconds + listens for phase-transition events.
let _pomodoroTimer = null

function _todayDateStr() {
  return new Date().toISOString().slice(0, 10)
}

// Bumps both the lifetime tally and the per-day counter; resets per-day when the
// current date string differs from the stored one (handles overnight crossings).
function bumpPomodoroTodayCount() {
  const today = _todayDateStr()
  if (_state.pomodoro_today_date !== today) {
    _state.pomodoro_today_date = today
    _state.pomodoro_today_count = 1
  } else {
    _state.pomodoro_today_count = (_state.pomodoro_today_count || 0) + 1
  }
  _state.pomodoro_completed_total = (_state.pomodoro_completed_total || 0) + 1
}

function _todayCountOrZero() {
  return (_state.pomodoro_today_date === _todayDateStr()) ? (_state.pomodoro_today_count || 0) : 0
}

function broadcastPomodoroEvent(event, p, remaining) {
  const payload = {
    event,
    running: !!p.running,
    phase: p.phase,
    label: p.label || '',
    remaining_seconds: remaining,
    duration_seconds: p.duration_seconds,
    break_seconds: p.break_seconds,
    completed_today: _todayCountOrZero(),
    completed_total: _state.pomodoro_completed_total || 0
  }
  if (alive(sideWin)) sideWin.webContents.send('pomodoro-tick', payload)
  if (alive(pomodoroWin)) pomodoroWin.webContents.send('pomodoro-tick', payload)
}

function pomodoroTick() {
  if (!_state || !_state.pomodoro || !_state.pomodoro.running) return
  const p = _state.pomodoro
  const phaseDur = p.phase === 'work' ? p.duration_seconds : p.break_seconds
  const startedAtMs = new Date(p.started_at).getTime()
  const elapsed = (Date.now() - startedAtMs) / 1000
  const remaining = Math.max(0, Math.floor(phaseDur - elapsed))

  if (elapsed >= phaseDur) {
    if (p.phase === 'work') {
      p.phase = 'break'
      p.started_at = new Date().toISOString()
      bumpPomodoroTodayCount()
      saveStateDebounced()
      broadcastPomodoroEvent('work_done', p, 0)
      try {
        const { Notification } = require('electron')
        new Notification({ title: '番茄钟·工作结束', body: '休息 ' + (p.break_seconds / 60) + ' 分钟' }).show()
      } catch {}
      return
    } else if (p.phase === 'break') {
      p.phase = 'done'
      p.running = false
      saveStateDebounced()
      broadcastPomodoroEvent('break_done', p, 0)
      stopPomodoroTimer()
      hidePomodoroPanel()
      try {
        const { Notification } = require('electron')
        new Notification({ title: '番茄钟·完成', body: '今日已完成 ' + _todayCountOrZero() + ' 个' }).show()
      } catch {}
      return
    }
  }
  broadcastPomodoroEvent('tick', p, remaining)
}

function startPomodoroTimer() {
  stopPomodoroTimer()
  pomodoroTick()
  _pomodoroTimer = setInterval(pomodoroTick, 1000)
}

function stopPomodoroTimer() {
  if (_pomodoroTimer) { clearInterval(_pomodoroTimer); _pomodoroTimer = null }
}

function showPomodoroPanel() {
  if (!alive(pomodoroWin)) return
  // Re-anchor each show so display config changes (DPI, monitor swap) don't strand the panel
  try {
    const d = screen.getPrimaryDisplay()
    const x = d.workAreaSize.width - POMODORO_W - 20
    const y = (d.workArea && d.workArea.y != null ? d.workArea.y : 0) + 40
    pomodoroWin.setPosition(Math.round(x), Math.round(y))
  } catch {}
  pomodoroWin.showInactive()
}

function hidePomodoroPanel() {
  if (alive(pomodoroWin) && pomodoroWin.isVisible()) pomodoroWin.hide()
}

// Whitelist for renderer-supplied strings passed to PowerShell.
// Strips ` $ ( ) ; & | < > " ' and control chars; keeps CJK / ASCII letters / digits / common punct.
function safeStr(s, max = 200) {
  if (s == null) return ''
  return String(s).replace(/[`$()<>;&|"'\x00-\x1f\x7f]/g, '').slice(0, max)
}

// Run a PowerShell script by writing it to a UTF-8 BOM .ps1 file and invoking it via -File.
// Args are passed positionally to the script's param() block; strings must already be safeStr'd.
function runPsScript(scriptText, argsArray = [], opts = {}) {
  const timeout = opts.timeout || 5000
  const tmp = path.join(os.tmpdir(), `sw_ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ps1`)
  try {
    fs.writeFileSync(tmp, '﻿' + scriptText, 'utf8')
    const argStr = argsArray.map(a => {
      if (typeof a === 'number' && Number.isFinite(a)) return String(Math.round(a))
      return `"${String(a)}"`
    }).join(' ')
    return execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}" ${argStr}`,
      { timeout, windowsHide: true }
    )
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

function createWindows() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const SW = 240

  const SIDE_H = 520
  const SIDE_W_DEFAULT = 280
  sideWin = new BrowserWindow({
    width: SIDE_W_DEFAULT, height: SIDE_H,
    x: width - SIDE_W_DEFAULT - 16,
    y: height - SIDE_H - 16,
    frame: false, transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 220, maxWidth: 600,
    minHeight: 300, maxHeight: height - 40,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  sideWin.loadFile('renderer/sidebar.html')
  sideWin.setAlwaysOnTop(true, 'floating')

  charWin = new BrowserWindow({
    width: CHAR_WIN_W, height: CHAR_WIN_H,
    x: Math.floor((width - SW) / 2), y: height - CHAR_WIN_H,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  charWin.loadFile('renderer/character.html')
  charWin.setAlwaysOnTop(true, 'screen-saver')

  // -- Launcher (floating summon icon) --
  // Position resolution: load saved coords → validate against current displays → fall back
  // to primary bottom-right if invalid. The validation matters when the user opens the app
  // on a different machine or after disconnecting an external monitor.
  launcherPosFile = path.join(app.getPath('userData'), 'launcher_pos.json')
  let lx = width - LAUNCH_W - 20, ly = height - LAUNCH_H - 20
  try {
    const saved = JSON.parse(fs.readFileSync(launcherPosFile, 'utf8'))
    const safe = safeOrFallback(saved.x, saved.y, LAUNCH_W, LAUNCH_H)
    lx = safe.x; ly = safe.y
  } catch {}
  launchWin = new BrowserWindow({
    width: LAUNCH_W, height: LAUNCH_H,
    x: lx, y: ly,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  launchWin.loadFile('renderer/launcher.html')
  launchWin.setAlwaysOnTop(true, 'screen-saver')

  // Sync sidebar visibility into launcher icon
  sideWin.on('show', () => { if (alive(launchWin)) launchWin.webContents.send('sidebar-state', true) })
  sideWin.on('hide', () => { if (alive(launchWin)) launchWin.webContents.send('sidebar-state', false) })
  // Closing sideWin from the OS taskbar (right-click → Close window) must quit the whole app —
  // charWin / launchWin have skipTaskbar:true so they keep the process alive invisibly otherwise.
  sideWin.on('close', () => { if (!app.isQuitting) app.quit() })

  // -- Quick-Insight helper (popup floating panel triggered by global shortcut) --
  helperWin = new BrowserWindow({
    width: HELPER_W, height: HELPER_H,
    show: false,
    frame: false, transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  helperWin.loadFile('renderer/helper.html')
  helperWin.setAlwaysOnTop(true, 'screen-saver')
  helperWin.on('blur', () => { if (alive(helperWin) && helperWin.isVisible()) helperWin.hide() })

  // -- Pomodoro overlay (top-right floating countdown panel; visible only while running) --
  pomodoroWin = new BrowserWindow({
    width: POMODORO_W, height: POMODORO_H,
    show: false,
    frame: false, transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  pomodoroWin.loadFile('renderer/pomodoro.html')
  pomodoroWin.setAlwaysOnTop(true, 'screen-saver')

  // Apply persisted ui_scale to every window once its content finishes loading.
  for (const w of [sideWin, charWin, launchWin, helperWin, pomodoroWin]) hookUiScaleOnLoad(w)
}

app.whenReady().then(() => {
  loadState()
  createWindows()

  const accel = (_state && _state.preferences && _state.preferences.quick_insight_shortcut) || 'CommandOrControl+Shift+\\'
  _quickInsightShortcut = accel
  try {
    const ok = globalShortcut.register(accel, triggerQuickInsight)
    if (!ok) console.error('[shortcut] 注册失败：可能被其他应用占用', accel)
    else console.log('[shortcut] 已注册', accel)
  } catch (e) {
    console.error('[shortcut] 注册异常', e.message)
  }

  // Resume pomodoro across restart. If the elapsed time has already eaten the entire
  // work+break cycle, mark the session done silently — no point firing a stale notif.
  if (_state.pomodoro && _state.pomodoro.running) {
    const p = _state.pomodoro
    const startedAtMs = new Date(p.started_at).getTime()
    const elapsedNow = (Date.now() - startedAtMs) / 1000
    if (p.phase === 'work' && elapsedNow >= (p.duration_seconds || 0) + (p.break_seconds || 0)) {
      _state.pomodoro = null
      saveStateDebounced()
    } else {
      startPomodoroTimer()
      showPomodoroPanel()
    }
  }

  // First-run desktop-shortcut prompt — delayed so the launcher/sidebar are visible
  // first (gives the dialog visual context instead of slamming up on a blank screen).
  setTimeout(() => maybePromptDesktopShortcut(), 1500)

  // Display safety: when monitors are added/removed/resized at runtime (lid close, dock,
  // screen resolution change), rescue any window stranded off-screen. Debounced because
  // display-metrics-changed can fire several times in quick succession.
  let _rescueTimer = null
  const scheduleRescue = () => {
    if (_rescueTimer) clearTimeout(_rescueTimer)
    _rescueTimer = setTimeout(() => { _rescueTimer = null; rescueStrandedWindows() }, 400)
  }
  screen.on('display-removed',         scheduleRescue)
  screen.on('display-added',           scheduleRescue)
  screen.on('display-metrics-changed', scheduleRescue)
})
app.on('before-quit', () => {
  app.isQuitting = true
  globalShortcut.unregisterAll()
  // Archive current conversation to long-term storage with timestamp + retention purge.
  // Then flush state.json synchronously before windows die.
  try { archiveAndPurge(_state) } catch (e) { console.error('[archive] failed:', e.message) }
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null }
  try { fs.writeFileSync(stateFile(), JSON.stringify(_state, null, 2), 'utf8') } catch (e) {
    console.error('[state] final flush failed:', e.message)
  }
})
app.on('window-all-closed', () => app.quit())

// User tried to launch a second instance — the requestSingleInstanceLock above made it
// quit, but here we wake the existing one up: surface sidebar + character so they can
// see Silver Wolf is already running.
app.on('second-instance', () => {
  if (alive(sideWin)) {
    if (sideWin.isMinimized()) sideWin.restore()
    sideWin.show()
    sideWin.focus()
  }
  if (alive(charWin) && !charWin.isVisible()) charWin.show()
  if (alive(launchWin) && !launchWin.isVisible()) launchWin.show()
})

// -- Quick-Insight: capture screen + show helper near cursor --
async function triggerQuickInsight() {
  if (!alive(helperWin)) return
  if (helperWin.isVisible()) {
    // Second press toggles closed
    helperWin.hide()
    return
  }
  try {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay()
    const wa = display.workAreaSize
    const bo = display.bounds

    const { desktopCapturer } = require('electron')
    const src = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    if (!src || !src[0]) return
    const thumb = src[0].thumbnail
    const size = thumb.getSize()
    const meta = {
      dataUrl: thumb.toDataURL(),
      imgW: size.width,
      imgH: size.height,
      screenW: wa.width,
      screenH: wa.height,
      scale: display.scaleFactor || 1
    }

    let hx = cursor.x + 16
    let hy = cursor.y + 16
    if (hx + HELPER_W > bo.x + wa.width)  hx = cursor.x - HELPER_W - 16
    if (hy + HELPER_H > bo.y + wa.height) hy = cursor.y - HELPER_H - 16
    if (hx < bo.x) hx = bo.x + 8
    if (hy < bo.y) hy = bo.y + 8

    helperWin.setPosition(Math.round(hx), Math.round(hy))
    helperWin.show()
    helperWin.focus()
    helperWin.webContents.send('helper-init', meta)
  } catch (e) {
    console.error('[quick-insight]', e.message)
  }
}

ipcMain.on('helper-cancel', () => {
  if (alive(helperWin) && helperWin.isVisible()) helperWin.hide()
})

ipcMain.on('helper-pick', (e, payload) => {
  if (alive(helperWin)) helperWin.hide()
  if (!alive(sideWin)) return
  sideWin.show()
  sideWin.focus()
  sideWin.webContents.send('quick-insight', payload)
  // Immediate bubble feedback — user sees SW "got it" before sidebar finishes the API call
  const mode = payload && payload.mode
  const text = MODE_TRIGGER_TEXTS[mode] || '处理中...'
  showCharBubble(text, {
    source: 'helper-' + (mode || 'unknown'),
    mood: 'processing',
    duration: 2200
  })
})

// -- Pomodoro IPC --
ipcMain.handle('pomodoro-start', (e, opts) => {
  const minutes = Number.isFinite(opts && opts.minutes) ? opts.minutes : 25
  const breakMinutes = Number.isFinite(opts && opts.break_minutes) ? opts.break_minutes : 5
  const label = (opts && opts.label) ? String(opts.label).slice(0, 80) : ''
  _state.pomodoro = {
    running: true,
    phase: 'work',
    label,
    started_at: new Date().toISOString(),
    duration_seconds: Math.max(60, Math.round(minutes * 60)),
    break_seconds: Math.max(0, Math.round(breakMinutes * 60))
  }
  saveStateDebounced()
  startPomodoroTimer()
  showPomodoroPanel()
  return { ok: true, minutes, break_minutes: breakMinutes, label }
})

ipcMain.handle('pomodoro-status', () => {
  if (!_state.pomodoro || !_state.pomodoro.running) {
    return {
      running: false,
      completed_today: _todayCountOrZero(),
      completed_total: _state.pomodoro_completed_total || 0
    }
  }
  const p = _state.pomodoro
  const phaseDur = p.phase === 'work' ? p.duration_seconds : p.break_seconds
  const elapsed = (Date.now() - new Date(p.started_at).getTime()) / 1000
  const remaining = Math.max(0, Math.floor(phaseDur - elapsed))
  return {
    running: true,
    phase: p.phase,
    label: p.label,
    remaining_seconds: remaining,
    duration_seconds: p.duration_seconds,
    break_seconds: p.break_seconds,
    completed_today: _todayCountOrZero(),
    completed_total: _state.pomodoro_completed_total || 0
  }
})

ipcMain.handle('pomodoro-cancel', () => {
  stopPomodoroTimer()
  const wasRunning = !!(_state.pomodoro && _state.pomodoro.running)
  _state.pomodoro = null
  saveStateDebounced()
  if (alive(sideWin)) sideWin.webContents.send('pomodoro-tick', { event: 'cancel', running: false })
  if (alive(pomodoroWin)) pomodoroWin.webContents.send('pomodoro-tick', { event: 'cancel', running: false })
  hidePomodoroPanel()
  return { ok: true, was_running: wasRunning }
})

// Triggered by the floating panel's STOP button — same logic as pomodoro-cancel,
// just no return value (renderer doesn't await).
ipcMain.on('pomodoro-panel-cancel', () => {
  stopPomodoroTimer()
  _state.pomodoro = null
  saveStateDebounced()
  if (alive(sideWin)) sideWin.webContents.send('pomodoro-tick', { event: 'cancel', running: false })
  if (alive(pomodoroWin)) pomodoroWin.webContents.send('pomodoro-tick', { event: 'cancel', running: false })
  hidePomodoroPanel()
})

// -- Desktop shortcut (Windows .lnk to SilverWolfPet.exe) --
// Two access points: launcher right-click menu (one-tap toggle) and settings panel
// (visible state + toggle). Disabled in dev mode because process.execPath there points
// at node_modules\electron\dist\electron.exe — a shortcut to that won't launch our app.
const SHORTCUT_NAME = '银狼桌宠.lnk'
let _desktopFolder = null

function getDesktopFolder() {
  if (_desktopFolder) return _desktopFolder
  // Resolve via PowerShell so OneDrive-redirected Desktop is honored. Falls back to
  // %USERPROFILE%\Desktop if PS is unavailable.
  try {
    const out = execSync(
      `powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`,
      { timeout: 2500, windowsHide: true }
    ).toString().trim()
    if (out) _desktopFolder = out
  } catch {}
  if (!_desktopFolder) {
    _desktopFolder = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop')
  }
  return _desktopFolder
}

function getShortcutPath() {
  return path.join(getDesktopFolder(), SHORTCUT_NAME)
}

function shortcutStatus() {
  const lnk = getShortcutPath()
  return {
    supported: app.isPackaged,
    devMode: !app.isPackaged,
    exists: (() => { try { return fs.existsSync(lnk) } catch { return false } })(),
    path: lnk
  }
}

function createDesktopShortcut() {
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式下不可用 — 需要先 npm run build 打包成 .exe' }
  }
  const exe = process.execPath
  const wd = path.dirname(exe)
  // Use single-quoted PS strings; double-up any embedded ' to escape.
  const escape = s => String(s).replace(/'/g, "''")
  const script = `$Wsh = New-Object -ComObject WScript.Shell
$Sc = $Wsh.CreateShortcut('${escape(getShortcutPath())}')
$Sc.TargetPath = '${escape(exe)}'
$Sc.WorkingDirectory = '${escape(wd)}'
$Sc.IconLocation = '${escape(exe)},0'
$Sc.Description = 'Silver Wolf Pet'
$Sc.Save()
Write-Output 'OK'`
  try {
    const out = runPsScript(script, [], { timeout: 5000 }).toString().trim()
    if (out.endsWith('OK')) {
      showCharBubble('桌面图标安排了～', { source: 'shortcut', mood: 'smug', duration: 2500 })
      return { ok: true, path: getShortcutPath() }
    }
    return { ok: false, error: out }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

function removeDesktopShortcut() {
  const lnk = getShortcutPath()
  try {
    if (fs.existsSync(lnk)) {
      fs.unlinkSync(lnk)
      showCharBubble('快捷方式撤了，桌面清爽了～', { source: 'shortcut', mood: 'default', duration: 2400 })
      return { ok: true, removed: true }
    }
    return { ok: true, removed: false }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

// First-run prompt: asks the user once whether to drop a shortcut on the desktop.
// Skipped in dev mode (no real .exe to point at) and skipped if a shortcut already exists.
// Either answer flips shortcut_first_run_done so we never re-ask.
async function maybePromptDesktopShortcut() {
  if (!app.isPackaged) return
  if (_state.shortcut_first_run_done) return
  if (shortcutStatus().exists) {
    _state.shortcut_first_run_done = true
    saveStateDebounced()
    return
  }
  try {
    const { dialog } = require('electron')
    const parent = alive(sideWin) ? sideWin : (alive(charWin) ? charWin : undefined)
    const r = await dialog.showMessageBox(parent, {
      type: 'question',
      buttons: ['好，放一个', '不用'],
      defaultId: 0,
      cancelId: 1,
      title: '银狼桌宠',
      message: '要不要在桌面放个快捷方式？',
      detail: '方便下次直接双击启动。可以随时在 Launcher 右键菜单 / 设置面板里改。'
    })
    if (r.response === 0) createDesktopShortcut()
  } catch (e) {
    console.error('[shortcut first-run]', e.message)
  } finally {
    _state.shortcut_first_run_done = true
    saveStateDebounced()
  }
}

ipcMain.handle('shortcut-status', () => shortcutStatus())
ipcMain.handle('shortcut-create', () => createDesktopShortcut())
ipcMain.handle('shortcut-remove', () => removeDesktopShortcut())

// UI scale: persist + apply to all windows. Renderer fetches current via state-get.
ipcMain.handle('set-ui-scale', (e, scale) => {
  const s = applyUiScale(scale)
  if (!_state.preferences) _state.preferences = {}
  _state.preferences.ui_scale = s
  saveStateDebounced()
  return { ok: true, scale: s }
})

// -- File conversion --
// Drag-drop a file onto the sidebar → main process picks the right converter and writes
// the output to the same directory. Bubble feedback flows through showCharBubble.
const converter = require('./services/converter')

// Built once on demand. htmlToPdf opens a hidden BrowserWindow, loads the HTML, and uses
// printToPDF; pdfToImage opens services/pdf-render.html with nodeIntegration so PDF.js can
// render each page to a canvas dataURL, then writes one image per page.
function buildConverterCtx() {
  return {
    htmlToPdf: async (html, outPath) => {
      // Write the HTML to a temp file then loadFile() — significantly more reliable than
      // loadURL('data:text/html...') which can hit ERR_FAILED on long/CJK content.
      const tmpHtml = path.join(os.tmpdir(), `sw_h2p_${Date.now()}_${Math.random().toString(36).slice(2,6)}.html`)
      fs.writeFileSync(tmpHtml, html, 'utf8')
      const w = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true }
      })
      try {
        await w.loadFile(tmpHtml)
        const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
        fs.writeFileSync(outPath, buf)
      } finally {
        try { w.destroy() } catch {}
        try { fs.unlinkSync(tmpHtml) } catch {}
      }
    },
    pdfToImage: async (srcPath, outPath, fmt) => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: true,
          sandbox: false
        }
      })
      try {
        await w.loadFile('services/pdf-render.html')
        const argsJson = JSON.stringify(srcPath) + ', ' + JSON.stringify(fmt)
        const result = await w.webContents.executeJavaScript(`window.renderPdf(${argsJson})`)
        if (!result || result.__error) {
          throw new Error('PDF 渲染失败：' + (result && result.__error || '未知错误'))
        }
        const ext = fmt === 'jpeg' ? 'jpg' : fmt

        // Single-page → write directly to the planned outPath.
        if (result.length === 1) {
          const buf = Buffer.from(result[0].split(',')[1], 'base64')
          fs.writeFileSync(outPath, buf)
          return  // converter falls through to default outPath handling
        }

        // Multi-page → wrap into a folder so output doesn't litter the source directory.
        // Folder name = source basename + suffix; collisions get _1, _2, ...
        const srcDir = path.dirname(srcPath)
        const srcBase = path.basename(srcPath, path.extname(srcPath))
        let folder = path.join(srcDir, `${srcBase}_pages`)
        let i = 1
        while (fs.existsSync(folder)) {
          folder = path.join(srcDir, `${srcBase}_pages_${i}`)
          i++
        }
        fs.mkdirSync(folder, { recursive: true })

        // Page filename width is padded so lexicographic sort matches page order
        // (page_1.png ... page_99.png is fine; page_100.png with 1-pad is page_1/page_10/page_100 — wrong).
        const pad = String(result.length).length
        for (let p = 0; p < result.length; p++) {
          const buf = Buffer.from(result[p].split(',')[1], 'base64')
          const name = `page_${String(p + 1).padStart(pad, '0')}.${ext}`
          fs.writeFileSync(path.join(folder, name), buf)
        }
        return { outPath: folder, count: result.length, isFolder: true }
      } finally {
        try { w.destroy() } catch {}
      }
    }
  }
}

ipcMain.handle('convert-targets', (e, srcPath) => {
  try { return converter.listTargets(srcPath) } catch { return [] }
})

ipcMain.handle('convert-file', async (e, payload) => {
  const srcPath = payload && payload.srcPath
  const target = payload && payload.target
  if (!srcPath || !fs.existsSync(srcPath)) {
    showCharBubble('源文件不见了，是闪现到平行宇宙了？', { source: 'converter', mood: 'pout', duration: 3000 })
    return { ok: false, error: '源文件不存在' }
  }
  try {
    const ctx = buildConverterCtx()
    const result = await converter.convert(srcPath, target, ctx)
    if (result.ok) {
      const name = path.basename(result.outPath)
      const text = result.isFolder
        ? `拆了 ${result.count} 页，丢进 ${name}/ 文件夹了～`
        : `搞定，${name} 扔回原目录了～`
      showCharBubble(text, { source: 'converter', mood: 'smug', duration: 3500 })
    } else {
      showCharBubble(`这转换搞不动：${result.error}`, { source: 'converter', mood: 'pout', duration: 3200 })
    }
    return result
  } catch (err) {
    const msg = (err && err.message || String(err)).slice(0, 80)
    showCharBubble(`Bug！${msg}`, { source: 'converter', mood: 'glitch', duration: 3500 })
    return { ok: false, error: err.message || String(err) }
  }
})

// -- Controls --
ipcMain.on('close', () => app.quit())
ipcMain.on('toggle-sidebar', () => {
  if (!alive(sideWin)) return
  sideWin.isVisible() ? sideWin.hide() : sideWin.show()
})
ipcMain.on('char-move', (e, { x, y }) => {
  if (!alive(charWin)) return
  charWin.setPosition(Math.round(x), Math.round(y))
})
ipcMain.on('move-sidebar', (e, { x, y }) => {
  if (!alive(sideWin)) return
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const b = sideWin.getBounds()
  const cx = Math.max(0, Math.min(width  - b.width,  x))
  const cy = Math.max(0, Math.min(height - b.height, y))
  sideWin.setPosition(Math.round(cx), Math.round(cy))
})
ipcMain.handle('get-sidebar-pos', () => {
  if (!alive(sideWin)) return { x: 0, y: 0 }
  const b = sideWin.getBounds()
  return { x: b.x, y: b.y }
})

// -- Launcher (floating summon icon) IPC --
ipcMain.on('launcher-move', (e, { x, y }) => {
  if (!alive(launchWin)) return
  // Clamp against the extended desktop bounding box so multi-monitor users can drag the
  // launcher to a secondary display. Primary-only clamp would snap them back at the seam.
  const { x: rx, y: ry } = clampToDesktop(x, y, LAUNCH_W, LAUNCH_H)
  launchWin.setPosition(rx, ry)
  if (launcherPosSaveTimer) clearTimeout(launcherPosSaveTimer)
  launcherPosSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(launcherPosFile, JSON.stringify({ x: rx, y: ry })) } catch {}
  }, 500)
})
ipcMain.handle('launcher-pos', () => {
  if (!alive(launchWin)) return { x: 0, y: 0, width: 0, height: 0 }
  return launchWin.getBounds()
})
ipcMain.on('launcher-context', () => {
  if (!alive(launchWin)) return
  const sc = shortcutStatus()
  const scLabel = !sc.supported
    ? '桌面快捷方式（打包后可用）'
    : (sc.exists ? '✓ 移除桌面快捷方式' : '+ 创建桌面快捷方式')
  Menu.buildFromTemplate([
    { label: '设置', click: () => {
        if (!alive(sideWin)) return
        sideWin.show(); sideWin.webContents.send('open-settings')
    } },
    { label: '显示/隐藏桌宠', click: () => {
        if (!alive(charWin)) return
        charWin.isVisible() ? charWin.hide() : charWin.show()
    } },
    { label: '重置 Launcher 位置', click: () => {
        if (!alive(launchWin)) return
        const d = screen.getPrimaryDisplay().workAreaSize
        launchWin.setPosition(d.width - LAUNCH_W - 20, d.height - LAUNCH_H - 20)
    } },
    {
      label: scLabel,
      enabled: sc.supported,
      click: () => { sc.exists ? removeDesktopShortcut() : createDesktopShortcut() }
    },
    { type: 'separator' },
    { label: 'Exit Silver Wolf', click: () => app.quit() },
  ]).popup({ window: launchWin })
})
ipcMain.handle('sidebar-visible', () => alive(sideWin) && sideWin.isVisible())

// -- Persistent state IPC --
ipcMain.handle('state-get', () => _state)
ipcMain.on('state-patch', (e, partial) => {
  if (!partial || typeof partial !== 'object') return
  for (const k of Object.keys(partial)) {
    if (k === 'preferences' && partial.preferences && typeof partial.preferences === 'object') {
      _state.preferences = { ..._state.preferences, ...partial.preferences }
    } else {
      _state[k] = partial[k]
    }
  }
  saveStateDebounced()
})
ipcMain.on('state-clear-conversation', () => {
  _state.conversation = []
  saveStateDebounced()
})

// Sidebar → character speech bubble (agentic set_quip tool, helper-pick, pomodoro events).
// payload: { text, duration?, mood?, source? }. Logs to bubble_log via showCharBubble.
ipcMain.on('set-quip', (e, payload) => {
  const text = payload && payload.text
  if (!text || !alive(charWin)) return
  showCharBubble(text, {
    duration: (payload && payload.duration) || 2000,
    mood: (payload && payload.mood) || 'default',
    source: (payload && payload.source) || 'quip-tool'
  })
})

// -- Right-click context menu on character --
ipcMain.on('context-menu', () => {
  if (!alive(charWin)) return
  Menu.buildFromTemplate([
    { label: 'Exit Silver Wolf', click: () => app.quit() },
    { label: 'Toggle Sidebar',   click: () => {
        if (!alive(sideWin)) return
        sideWin.isVisible() ? sideWin.hide() : sideWin.show()
    } },
    { type: 'separator' },
    { label: 'DevTools (Char)', click: () => { if (alive(charWin)) charWin.webContents.openDevTools({ mode:'detach' }) } },
    { label: 'DevTools (Side)', click: () => { if (alive(sideWin)) sideWin.webContents.openDevTools({ mode:'detach' }) } },
  ]).popup({ window: charWin })
})

// -- Screen / cursor / windows --
ipcMain.handle('get-screen',  () => {
  const d = screen.getPrimaryDisplay()
  const sideVisible = !app.isQuitting && alive(sideWin) && sideWin.isVisible()
  const sideW = sideVisible ? sideWin.getBounds().width + 20 : 0
  return { w: d.workAreaSize.width, h: d.workAreaSize.height, SIDE_W: sideW, scale: d.scaleFactor || 1 }
})
ipcMain.handle('get-cursor',  () => screen.getCursorScreenPoint())
ipcMain.handle('get-windows', () => {
  try {
    const out = execSync(`powershell -ExecutionPolicy Bypass -File "${PS}"`,
      { timeout: 2500, windowsHide: true }).toString().trim()
    if (!out) return []
    return out.split('|').map(s => {
      const [l,t,r,b] = s.split(',').map(Number)
      return { l,t,r,b }
    }).filter(rc => !isNaN(rc.l))
  } catch { return [] }
})

// -- Screenshot (desktopCapturer) --
// Returns { dataUrl, imgW, imgH, screenW, screenH, scale } so renderer can map image-pixel
// coords (what the vision model sees) onto screen DIP coords (what fly_and_click needs).
ipcMain.handle('screenshot', async () => {
  try {
    const { desktopCapturer } = require('electron')
    const d = screen.getPrimaryDisplay()
    const src = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    if (!src || !src[0]) return null
    const thumb = src[0].thumbnail
    const size = thumb.getSize()
    return {
      dataUrl: thumb.toDataURL(),
      imgW: size.width,
      imgH: size.height,
      screenW: d.workAreaSize.width,
      screenH: d.workAreaSize.height,
      scale: d.scaleFactor || 1
    }
  } catch (e) {
    console.error('[screenshot]', e.message)
    return null
  }
})

// -- Window focus --
ipcMain.handle('win-focus', (e, title) => {
  const kw = safeStr(title, 120)
  const script = `param([string]$Keyword)
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public class WF{
  [DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
  [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  public static bool Focus(string kw){
    bool ok=false;
    EnumWindows(new EnumWindowsProc((h,p)=>{
      if(!IsWindowVisible(h))return true;
      var sb=new StringBuilder(256);GetWindowText(h,sb,256);
      if(sb.ToString().ToLower().Contains(kw.ToLower())){ShowWindow(h,9);SetForegroundWindow(h);ok=true;return false;}
      return true;
    }),IntPtr.Zero);return ok;
  }
}
"@
[WF]::Focus($Keyword) | Out-Null`
  try { runPsScript(script, [kw], { timeout: 3000 }); return true }
  catch { return false }
})

// -- Send keys to focused window --
ipcMain.handle('send-keys', (e, text) => {
  // SendKeys-level escape (+ ^ % ~ ( ) { } [ ]) must happen first; strip only what breaks the
  // shell-quoted arg boundary. { } ( ) stay — they're needed for SendKeys' own escape form.
  const safe = String(text || '')
    .replace(/[+^%~(){}[\]]/g, '{$&}')
    .replace(/["'`$<>;&|\x00-\x1f\x7f]/g, '')
    .slice(0, 500)
  const script = `param([string]$Text)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Text)`
  try { runPsScript(script, [safe], { timeout: 3000 }); return true }
  catch { return false }
})

// -- Mouse click at screen coords --
ipcMain.handle('mouse-click', (e, x, y) => {
  const script = `param([int]$X,[int]$Y)
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MC{
  [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint c,int e);
}
"@
[MC]::SetCursorPos($X,$Y)
Start-Sleep -Milliseconds 80
[MC]::mouse_event(2,0,0,0,0)
[MC]::mouse_event(4,0,0,0,0)`
  try { runPsScript(script, [x, y], { timeout: 3000 }); return true }
  catch { return false }
})


// Double-click at screen coords (for fly-and-open)
ipcMain.handle('double-click', (e, { x, y }) => {
  const script = `param([int]$X,[int]$Y)
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MC2{
  [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint c,int e);
}
"@
[MC2]::SetCursorPos($X,$Y)
Start-Sleep -Milliseconds 120
[MC2]::mouse_event(2,0,0,0,0)
[MC2]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 120
[MC2]::mouse_event(2,0,0,0,0)
[MC2]::mouse_event(4,0,0,0,0)`
  try {
    runPsScript(script, [x, y], { timeout: 3000 })
    return true
  } catch { return false }
})

// Sidebar found icon coords -> relay to character window
ipcMain.on('request-fly-click', (e, { screenX, screenY, label }) => {
  if (!alive(charWin)) return
  // Place character just above the target icon
  const d = screen.getPrimaryDisplay().workAreaSize
  const winX = Math.max(0, Math.min(d.width  - CHAR_WIN_W, Math.round(screenX - CHAR_W / 2)))
  const winY = Math.max(0, Math.min(d.height - CHAR_WIN_H, Math.round(screenY - CHAR_H - 10)))
  charWin.webContents.send('fly-to-click', { winX, winY, screenX, screenY, label })
})


// Reveal auto-hidden taskbar (move cursor to bottom edge)
ipcMain.handle('reveal-taskbar', async () => {
  const d = screen.getPrimaryDisplay()
  const cx = Math.floor(d.bounds.width / 2)
  const cy = d.bounds.height - 1
  const script = `param([int]$Cx,[int]$Cy)
Add-Type @"
using System;using System.Runtime.InteropServices;
public class TC{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);}
"@
[TC]::SetCursorPos($Cx,$Cy)
Start-Sleep -Milliseconds 450`
  try {
    runPsScript(script, [cx, cy], { timeout: 2500 })
    return true
  } catch { return false }
})

// Smart double-click: reveal taskbar first if target is near bottom
ipcMain.handle('smart-double-click', async (e, { x, y }) => {
  const d = screen.getPrimaryDisplay()
  const nearTaskbar = y > d.workAreaSize.height - 60
  const cx = Math.round(x), cy = Math.round(y)
  const halfW = Math.floor(d.bounds.width / 2)
  const H = d.bounds.height
  const script = nearTaskbar
    ? `param([int]$X,[int]$Y,[int]$HalfW,[int]$H)
Add-Type @"
using System;using System.Runtime.InteropServices;
public class SDC{
  [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint c,int e);
}
"@
[SDC]::SetCursorPos($HalfW, $H - 1)
Start-Sleep -Milliseconds 450
[SDC]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
[SDC]::mouse_event(2,0,0,0,0)
[SDC]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 110
[SDC]::mouse_event(2,0,0,0,0)
[SDC]::mouse_event(4,0,0,0,0)`
    : `param([int]$X,[int]$Y,[int]$HalfW,[int]$H)
Add-Type @"
using System;using System.Runtime.InteropServices;
public class SDC{
  [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint c,int e);
}
"@
[SDC]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 120
[SDC]::mouse_event(2,0,0,0,0)
[SDC]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 110
[SDC]::mouse_event(2,0,0,0,0)
[SDC]::mouse_event(4,0,0,0,0)`
  try {
    runPsScript(script, [cx, cy, halfW, H], { timeout: 4000 })
    return true
  } catch { return false }
})

// Open folder by path
ipcMain.on('open-folder', (e, folderPath) => {
  exec(`explorer "${folderPath}"`, err => { if(err) exec(`start "" "${folderPath}"`) })
})

// Open the bundled user manual. In packaged mode the .md sits next to SilverWolfPet.exe
// (build.bat copies it post-package); in dev mode it lives in the project root. Either way
// shell.openPath hands off to the user's default markdown handler (Typora, VS Code, notepad).
ipcMain.on('open-manual', () => {
  const candidates = [
    path.join(path.dirname(process.execPath), '使用说明书.md'),
    path.join(__dirname, 'docs', '使用说明书.md')
  ]
  const found = candidates.find(p => { try { return fs.existsSync(p) } catch { return false } })
  if (found) {
    shell.openPath(found).catch(err => console.error('[open-manual]', err.message))
  } else {
    console.error('[open-manual] file not found in any candidate path')
  }
})


// Launch any app: gather Start Menu + Desktop(.lnk) candidates, then pick by priority:
//   StartMenu-exact → Desktop-exact → Desktop-contains → StartMenu-contains.
// Desktop contains wins over StartMenu contains because user-curated shortcuts are less noisy
// (fixes "P4V" → "P4V Release Notes" type misfires). Desktop path resolved via Shell API so
// OneDrive-redirected Desktop ("$env:OneDrive\Desktop" or localized "\桌面") is covered.
ipcMain.handle('launch-by-name', (e, name) => {
  const safeName = safeStr(name, 80).replace(/'/g, "''")
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Name = '${safeName}'
$NameN = ($Name -replace '\\s','')

# Bilingual alias table: Chinese app names whose shortcuts / StartApps entries are stored
# purely in English with no Chinese metadata. Kept short, only for high-traffic names.
$aliases = @{
  '微信' = 'WeChat'
  '钉钉' = 'DingTalk'
  '腾讯会议' = 'VooV'
  '百度网盘' = 'BaiduNetdisk'
  '夸克' = 'Quark'
  '抖音' = 'Douyin'
  '哔哩哔哩' = 'bilibili'
  'b站' = 'bilibili'
  '剪映' = 'JianyingPro'
  '网易云音乐' = 'CloudMusic'
  '网易云' = 'CloudMusic'
  '迅雷' = 'Thunder'
  'qq音乐' = 'QQMusic'
  '原神' = 'Genshin Impact'
  '崩坏星穹铁道' = 'Star Rail'
  '搜狗输入法' = 'Sogou'
}

# Build needles: primary + alias lookup (case-insensitive on Chinese/English key).
$needlesN = @($NameN)
foreach ($k in $aliases.Keys) {
  if (($k -replace '\\s','').ToLower() -eq $NameN.ToLower()) {
    $needlesN += ($aliases[$k] -replace '\\s','')
  }
}
# Reverse direction: if user typed English, also try the Chinese equivalent
foreach ($k in $aliases.Keys) {
  if (($aliases[$k] -replace '\\s','').ToLower() -eq $NameN.ToLower()) {
    $needlesN += ($k -replace '\\s','')
  }
}

function Test-AnyNeedle {
  param([string]$hayN, [string[]]$needlesN)
  foreach ($n in $needlesN) { if ($hayN -like "*$n*") { return $true } }
  return $false
}

# Collect Start Menu candidates
$startApps = @(Get-StartApps | Where-Object { Test-AnyNeedle ($_.Name -replace '\\s','') $needlesN } |
  ForEach-Object { [pscustomobject]@{
    Kind='startmenu'; DisplayName=$_.Name; NameN=($_.Name -replace '\\s',''); AppId=$_.AppId; Lnk=$null
  } })

# Collect Desktop .lnk candidates. Use Shell API so OneDrive redirection is respected,
# plus check OneDrive Desktop explicitly (both English and localized "桌面" folder).
$desktopPaths = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
)
if (\${env:OneDrive}) {
  foreach ($sub in @('Desktop','桌面')) {
    $candidate = Join-Path \${env:OneDrive} $sub
    if (Test-Path $candidate) { $desktopPaths += $candidate }
  }
}
$desktopPaths = @($desktopPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)

$desktopHits = @()
foreach ($p in $desktopPaths) {
  $desktopHits += Get-ChildItem -Path $p -Filter "*.lnk" -File -ErrorAction SilentlyContinue |
    Where-Object { Test-AnyNeedle ($_.BaseName -replace '\\s','') $needlesN } |
    ForEach-Object { [pscustomobject]@{
      Kind='desktop'; DisplayName=$_.BaseName; NameN=($_.BaseName -replace '\\s',''); AppId=$null; Lnk=$_.FullName
    } }
}

# Priority ladder
$found = $null
foreach ($c in $startApps)  { if ($c.NameN -eq $NameN) { $found = $c; break } }
if (-not $found) { foreach ($c in $desktopHits) { if ($c.NameN -eq $NameN) { $found = $c; break } } }
if (-not $found -and $desktopHits.Count -gt 0) {
  $prefer = $desktopHits | Where-Object { $_.NameN.ToLower().StartsWith($NameN.ToLower()) } | Select-Object -First 1
  $found = if ($prefer) { $prefer } else { $desktopHits[0] }
}
if (-not $found -and $startApps.Count -gt 0) {
  $prefer = $startApps | Where-Object { $_.NameN.ToLower().StartsWith($NameN.ToLower()) } | Select-Object -First 1
  $found = if ($prefer) { $prefer } else { $startApps[0] }
}

# Strategy 5: Uninstall registry scan (apps registered via installer but
# with no Start Menu / Desktop entry — Discord in some builds, some portable
# installs with Uninstall stubs, etc.).
if (-not $found) {
  $uninstallKeys = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  )
  $regHits = @()
  foreach ($kp in $uninstallKeys) {
    if (-not (Test-Path $kp)) { continue }
    Get-ChildItem $kp -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $e = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        if (-not $e -or -not $e.DisplayName) { return }
        # Filter out system noise: require either DisplayIcon or InstallLocation.
        # System updates and runtime redistributables usually have neither.
        if (-not $e.DisplayIcon -and -not $e.InstallLocation) { return }
        $nameN = ($e.DisplayName -replace '\\s','')
        if (Test-AnyNeedle $nameN $needlesN) {
          $regHits += [pscustomobject]@{
            Kind = 'registry'
            DisplayName = $e.DisplayName
            NameN = $nameN
            DisplayIcon = $e.DisplayIcon
            InstallLocation = $e.InstallLocation
          }
        }
      } catch {}
    }
  }
  if ($regHits.Count -gt 0) {
    $found = $regHits | Where-Object { $_.NameN -eq $NameN } | Select-Object -First 1
    if (-not $found) { $found = $regHits[0] }
  }
}

if (-not $found) {
  Write-Output ("NOTFOUND (scanned desktop: " + ($desktopPaths -join '; ') + "; scanned registry: HKLM+HKCU Uninstall)")
  exit
}

if ($found.Kind -eq 'startmenu') {
  try {
    $appId = $found.AppId
    # Get-StartApps returns two AppId shapes: UWP/Store apps use PackageFamily!App or GUID,
    # while classic apps return the Start Menu .lnk path. shell:AppsFolder only handles the
    # former — passing a file path causes explorer to silently no-op (Discord symptom).
    if ($appId -match '^[A-Za-z]:[\\\\/]' -or $appId -like '*.lnk') {
      if (Test-Path $appId) {
        $shell = New-Object -ComObject WScript.Shell
        $sc = $shell.CreateShortcut($appId)
        if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) {
          $wd = if ($sc.WorkingDirectory) { $sc.WorkingDirectory } else { Split-Path $sc.TargetPath }
          Start-Process -FilePath $sc.TargetPath -WorkingDirectory $wd -ErrorAction Stop
        } else {
          Invoke-Item $appId
        }
      } else {
        throw ("AppId path does not exist: " + $appId)
      }
    } else {
      Start-Process 'explorer.exe' -ArgumentList ("shell:AppsFolder\\" + $appId) -ErrorAction Stop
    }
    Write-Output ("OK_STARTMENU:" + $found.DisplayName)
  } catch {
    Write-Output ("FAIL_STARTMENU:" + $_.Exception.Message)
  }
} elseif ($found.Kind -eq 'desktop') {
  $shell = New-Object -ComObject WScript.Shell
  try {
    $sc = $shell.CreateShortcut($found.Lnk)
    if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) {
      $wd = if ($sc.WorkingDirectory) { $sc.WorkingDirectory } else { Split-Path $sc.TargetPath }
      Start-Process -FilePath $sc.TargetPath -WorkingDirectory $wd -ErrorAction Stop
    } else {
      Invoke-Item $found.Lnk
    }
    Write-Output ("OK_DESKTOP:" + $found.DisplayName)
  } catch {
    Write-Output ("FAIL_DESKTOP:" + $found.DisplayName + ":" + $_.Exception.Message)
  }
} elseif ($found.Kind -eq 'registry') {
  try {
    $targetExe = $null
    # 1. 优先用 DisplayIcon（常指向主 exe）
    if ($found.DisplayIcon) {
      $icon = $found.DisplayIcon
      # 剥离 ",0" 或 ",1" 之类图标索引后缀
      if ($icon -match '^(.+?),\\d+$') { $icon = $Matches[1] }
      $icon = $icon.Trim('"')
      # 与 InstallLocation 扫描相同的 helper 过滤——避免把 DisplayIcon 指向
      # 卸载器/更新器/修复器的条目误当作主 exe 启动（例如国产安装器常把
      # DisplayIcon 指向 uninst.exe）。失配时 $targetExe 保持 $null，自动
      # 回退到下面的 InstallLocation 扫描分支。
      $iconBase = ''
      try { $iconBase = [System.IO.Path]::GetFileNameWithoutExtension($icon) } catch {}
      $isHelper = $iconBase -match '(?i)^(unins|update|helper|crash|setup|install|uninstall|repair|vc_redist)'
      if ($icon -like '*.exe' -and -not $isHelper -and (Test-Path $icon)) {
        $targetExe = $icon
      }
    }
    # 2. 回退：扫 InstallLocation 选主 exe（排除常见辅助 exe）
    if (-not $targetExe -and $found.InstallLocation -and (Test-Path $found.InstallLocation)) {
      $exeCandidate = Get-ChildItem -Path $found.InstallLocation -Filter "*.exe" -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.BaseName -notmatch '(?i)^(unins|update|helper|crash|setup|install|uninstall|repair|vc_redist)' -and
          $_.Length -gt 100KB
        } |
        Sort-Object -Property Length -Descending |
        Select-Object -First 1
      if ($exeCandidate) { $targetExe = $exeCandidate.FullName }
    }
    if ($targetExe) {
      $wd = Split-Path $targetExe
      Start-Process -FilePath $targetExe -WorkingDirectory $wd -ErrorAction Stop
      Write-Output ("OK_REGISTRY:" + $found.DisplayName)
    } else {
      Write-Output ("FAIL_REGISTRY:" + $found.DisplayName + ":no launchable exe (DisplayIcon=" + $found.DisplayIcon + " InstallLocation=" + $found.InstallLocation + ")")
    }
  } catch {
    Write-Output ("FAIL_REGISTRY:" + $found.DisplayName + ":" + $_.Exception.Message)
  }
}`
  try {
    const out = runPsScript(script, [], { timeout: 6000 }).toString().trim()
    console.log('[launch-by-name]', JSON.stringify(name), '→', JSON.stringify(out))
    const firstLine = out.split(/\r?\n/)[0]
    if (firstLine.startsWith('OK_STARTMENU:') || firstLine.startsWith('OK_DESKTOP:') || firstLine.startsWith('OK_REGISTRY:')) {
      const colonIdx = firstLine.indexOf(':')
      return { found: true, name: firstLine.slice(colonIdx + 1), via: firstLine.slice(0, colonIdx) }
    }
    return { found: false, detail: out }
  } catch (err) {
    console.error('[launch-by-name] error:', err.message)
    return { found: false, error: err.message }
  }
})

// Fallback: open Windows Search and paste the name via clipboard (CJK-safe — SendKeys itself
// can't type CJK). Clipboard needs STA; if SetText throws here the catch swallows it and Ctrl+V
// will paste whatever was already on the clipboard (tolerated by spec).
ipcMain.handle('open-via-search', (e, name) => {
  const safeName = safeStr(name, 60).replace(/'/g, "''")
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Name = '${safeName}'
Add-Type -AssemblyName System.Windows.Forms
try {
  [System.Windows.Forms.Clipboard]::SetText($Name)
} catch {
  Start-Sleep -Milliseconds 50
}
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys('^{ESC}')
Start-Sleep -Milliseconds 800
$wsh.SendKeys('^v')
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Output "OK_SEARCH"`
  try {
    const out = runPsScript(script, [], { timeout: 6000 }).toString().trim()
    console.log('[open-via-search]', JSON.stringify(name), '→', JSON.stringify(out))
    return true
  } catch (err) {
    console.error('[open-via-search] error:', err.message)
    return false
  }
})

// -- Open app / URL --
ipcMain.on('open-app', (e, id) => {
  const map = {
    chrome:'start chrome', edge:'start msedge', explorer:'explorer',
    calc:'calc', notepad:'notepad', cmd:'start cmd', powershell:'start powershell',
    taskmgr:'taskmgr', vscode:'code .', paint:'mspaint',
    wechat:'start "" "%LOCALAPPDATA%\\Programs\\WeChat\\WeChat.exe"',
    steam:'start steam://', discord:'start discord://',
  }
  exec(map[id.toLowerCase()] || `start ${id}`)
})
ipcMain.on('open-url', (e, url) => {
  shell.openExternal(/^https?:\/\//i.test(url) ? url : 'https://' + url)
})
