// SenseVoice-Small offline ASR for the PTT (push-to-talk) flow.
//
// The recognizer is created once on first init and reused across requests.
// The model file is ~234MB; loading it on demand each time would add multi-second
// latency to every PTT release, so we hold it in memory for the app's lifetime.
//
// If the model files are missing we silently fail-open: isReady() returns false and
// callers degrade gracefully (PTT hotkey is not registered, friendly bubble shown).

const path = require('path')
const fs = require('fs')

// model.int8.onnx is ~234MB. If a partial download or a Git-LFS pointer file slips
// in (LFS pointers are <1KB), treat it as corrupt instead of usable — the sherpa
// constructor would otherwise throw a confusing "invalid protobuf" error.
const MODEL_MIN_BYTES = 200_000_000

// Stage-tagged failure detail. lastError is a human string for legacy callers;
// lastErrorDetail is the structured form used by main.js to write voice-init.log
// and to pick the right bubble copy. Stages:
//   engine-missing     — sherpa-onnx-node not installed at all (MODULE_NOT_FOUND)
//   engine-load-failed — package present but native .node failed to load (often
//                        missing VC++ runtime on Windows, or wrong CPU arch)
//   model-missing      — model.int8.onnx / tokens.txt absent
//   model-corrupt      — model.int8.onnx exists but size below threshold
//                        (LFS pointer, partial download, antivirus quarantine)
//   ctor-failed        — OfflineRecognizer constructor threw at runtime
let lastError = null
let lastErrorDetail = null

function _diagnoseRequireFailure(e) {
  const msg = (e && e.message) || String(e)
  if (e && e.code === 'MODULE_NOT_FOUND') {
    return {
      stage: 'engine-missing',
      message: msg,
      hint: 'sherpa-onnx-node 未安装。在项目目录跑 `npm install` 重新拉依赖。',
    }
  }
  // Package's manifest may resolve fine while its native .node fails to load.
  // Probe the platform-specific subpackages so we can tell the user which arch
  // they're missing (sherpa ships separate npm packages per CPU arch).
  const probes = []
  for (const pkg of ['sherpa-onnx-win-x64', 'sherpa-onnx-win-ia32']) {
    try { require.resolve(pkg); probes.push(pkg + '=installed') }
    catch { probes.push(pkg + '=missing') }
  }
  const bothMissing = probes.every(p => p.endsWith('=missing'))
  const hint = bothMissing
    ? '原生子包没装上 (' + probes.join(', ') + ')，重新跑 `npm install`。'
    : '原生模块加载失败 (' + probes.join(', ') + ')，多半缺 Visual C++ Redistributable 2019/2022。' +
      ' 装一下 https://aka.ms/vs/17/release/vc_redist.x64.exe 然后重启应用。'
  return { stage: 'engine-load-failed', message: msg, hint }
}

let sherpa = null
try {
  sherpa = require('sherpa-onnx-node')
} catch (e) {
  lastErrorDetail = _diagnoseRequireFailure(e)
  lastError = 'sherpa-onnx-node 加载失败: ' + lastErrorDetail.message
  console.warn('[voice]', lastError)
}

let recognizer = null
let modelReady = false
let initAttempted = false

function modelDir() {
  return path.join(__dirname, '..', 'assets', 'models', 'sense-voice')
}

function modelFilesPresent() {
  const dir = modelDir()
  return fs.existsSync(path.join(dir, 'model.int8.onnx')) &&
         fs.existsSync(path.join(dir, 'tokens.txt'))
}

// Distinguishes "missing" from "present-but-corrupted" so the user sees the right
// remedy. Returns { ok, reason, sizeBytes } — sizeBytes is logged so the user can
// confirm whether a re-download actually changed anything.
function modelHealth() {
  const modelPath = path.join(modelDir(), 'model.int8.onnx')
  if (!fs.existsSync(modelPath)) return { ok: false, reason: 'missing', sizeBytes: 0 }
  let size = 0
  try { size = fs.statSync(modelPath).size }
  catch (e) { return { ok: false, reason: 'stat-failed:' + e.message, sizeBytes: 0 } }
  if (size < MODEL_MIN_BYTES) return { ok: false, reason: 'corrupt-or-partial', sizeBytes: size }
  return { ok: true, reason: 'ok', sizeBytes: size }
}
function isModelHealthy() { return modelHealth().ok }

function initRecognizer() {
  if (initAttempted) return modelReady
  initAttempted = true

  if (!sherpa) {
    // lastError / lastErrorDetail already populated at top-level require time.
    return false
  }

  const dir = modelDir()
  const modelPath    = path.join(dir, 'model.int8.onnx')
  const tokensPath   = path.join(dir, 'tokens.txt')
  const hotwordsPath = path.join(dir, 'hotwords.txt')

  if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
    lastError = '模型文件缺失：' + modelPath
    lastErrorDetail = {
      stage: 'model-missing',
      message: lastError,
      hint: '把 model.int8.onnx 和 tokens.txt 放到 assets/models/sense-voice/，下载说明见 docs/voice-input-spec.md §8.1。',
    }
    console.warn('[voice]', lastError)
    return false
  }

  const health = modelHealth()
  if (!health.ok) {
    lastError = '模型文件异常: size=' + health.sizeBytes + 'B 低于阈值 ' + MODEL_MIN_BYTES + 'B (' + health.reason + ')'
    lastErrorDetail = {
      stage: 'model-corrupt',
      message: lastError,
      hint: 'model.int8.onnx 体积异常（应 ≈234MB）。可能是下载未完成、Git LFS 占位文件、或被杀软隔离。删掉重新下载。',
    }
    console.warn('[voice]', lastError)
    return false
  }

  // hotwords.txt is a plain UTF-8 list (one term per line, # for comments) that
  // biases the recognizer toward project-specific proper nouns: Hoyo IP terms,
  // tech jargon, app names. Score 1.5 sits in the middle of sherpa's recommended
  // 0.5-3.0 range — high enough to pull "星核猎手" over "心核猎手" without
  // overriding the acoustics on words the user actually said.
  // hotwordsFile/hotwordsScore are TOP-LEVEL ctor args (not inside modelConfig).
  const ctorArgs = {
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
  }
  let hotwordsRequested = false
  if (fs.existsSync(hotwordsPath)) {
    ctorArgs.hotwordsFile = hotwordsPath
    ctorArgs.hotwordsScore = 1.5
    hotwordsRequested = true
  }

  try {
    recognizer = new sherpa.OfflineRecognizer(ctorArgs)
    modelReady = true
    if (hotwordsRequested) console.log('[voice] hotwords 已启用:', hotwordsPath)
    console.log('[voice] SenseVoice 模型加载完成')
    return true
  } catch (e) {
    // sherpa-onnx may not support hotwords on every model/version. Retry once
    // without them so the user still gets a working recognizer.
    if (hotwordsRequested) {
      console.warn('[voice] hotwords 在当前 sherpa 版本/模型上不支持，回退无 hotwords:', e.message)
      delete ctorArgs.hotwordsFile
      delete ctorArgs.hotwordsScore
      try {
        recognizer = new sherpa.OfflineRecognizer(ctorArgs)
        modelReady = true
        console.log('[voice] SenseVoice 模型加载完成 (无 hotwords)')
        return true
      } catch (e2) {
        lastError = e2.message
        lastErrorDetail = {
          stage: 'ctor-failed',
          message: e2.message,
          hint: 'OfflineRecognizer 构造抛错（hotwords 回退后仍失败），可能是 sherpa-onnx 版本与模型不匹配，或 onnxruntime 原生依赖问题。',
        }
        console.error('[voice] 模型初始化失败 (回退后仍失败):', e2)
        return false
      }
    }
    lastError = e.message
    lastErrorDetail = {
      stage: 'ctor-failed',
      message: e.message,
      hint: 'OfflineRecognizer 构造抛错，可能是模型损坏或 onnxruntime 原生依赖问题。',
    }
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
  // SenseVoice 输出含 <|zh|><|NEUTRAL|><|Speech|> 这类 meta tag，剥掉再返回
  return (r && r.text ? r.text : '').replace(/<\|[^|]*\|>/g, '').trim()
}

function isReady() { return modelReady }
function getLastError() { return lastError }
function getLastErrorDetail() { return lastErrorDetail }
function isModelPresent() { return modelFilesPresent() }

module.exports = {
  initRecognizer, transcribe, isReady,
  getLastError, getLastErrorDetail,
  isModelPresent, isModelHealthy, modelHealth,
}
