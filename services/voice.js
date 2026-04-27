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

let sherpa = null
try {
  sherpa = require('sherpa-onnx-node')
} catch (e) {
  console.warn('[voice] sherpa-onnx-node 加载失败，语音输入禁用:', e.message)
}

let recognizer = null
let modelReady = false
let initAttempted = false
let lastError = null

function modelDir() {
  return path.join(__dirname, '..', 'assets', 'models', 'sense-voice')
}

function modelFilesPresent() {
  const dir = modelDir()
  return fs.existsSync(path.join(dir, 'model.int8.onnx')) &&
         fs.existsSync(path.join(dir, 'tokens.txt'))
}

function initRecognizer() {
  if (initAttempted) return modelReady
  initAttempted = true

  if (!sherpa) {
    lastError = 'sherpa-onnx-node 未安装'
    return false
  }

  const dir = modelDir()
  const modelPath    = path.join(dir, 'model.int8.onnx')
  const tokensPath   = path.join(dir, 'tokens.txt')
  const hotwordsPath = path.join(dir, 'hotwords.txt')

  if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
    lastError = '模型文件缺失：' + modelPath
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
        console.error('[voice] 模型初始化失败 (回退后仍失败):', e2)
        return false
      }
    }
    lastError = e.message
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
function isModelPresent() { return modelFilesPresent() }

module.exports = { initRecognizer, transcribe, isReady, getLastError, isModelPresent }
