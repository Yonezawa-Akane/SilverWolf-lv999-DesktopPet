// File-format converter: pure JS, runs in main process. Handlers are routed by
// `${srcExt}->${targetExt}`. Handlers that need Electron-only capabilities
// (BrowserWindow.printToPDF, hidden window for PDF.js render) accept a `ctx`
// object with `htmlToPdf(html, outPath)` and `pdfToImage(src, outPath, fmt)`
// callbacks injected from main.js.

const path = require('path')
const fs = require('fs')

const Jimp = require('jimp')
const { PDFDocument, degrees } = require('pdf-lib')
const mammoth = require('mammoth')
const TurndownService = require('turndown')
const htmlToDocx = require('html-to-docx')
const pdfParse = require('pdf-parse')
const XLSX = require('xlsx')

// `marked` v18 is pure ESM — load it lazily via dynamic import and cache the result.
// Calling getMarked() returns the same `parse` function on subsequent calls.
let _markedPromise = null
function getMarked() {
  if (!_markedPromise) {
    _markedPromise = import('marked').then(m => m.marked)
  }
  return _markedPromise
}

async function pdfExtractText(srcPath) {
  // pdf-parse v1: callable on a Buffer; returns { text, numpages, info, ... }
  const r = await pdfParse(fs.readFileSync(srcPath))
  return (r && r.text) || ''
}

// -- Image handlers (jimp) --
// jimp picks output format from extension; we set MIME explicitly to avoid surprises.
const JIMP_MIME = {
  png:  Jimp.MIME_PNG,
  jpg:  Jimp.MIME_JPEG,
  jpeg: Jimp.MIME_JPEG,
  bmp:  Jimp.MIME_BMP,
}

function imgConvert(targetExt) {
  return async (src, out) => {
    const img = await Jimp.read(src)
    const mime = JIMP_MIME[targetExt]
    if (mime) {
      await img.writeAsync(out)
    } else {
      // jimp 0.22 doesn't ship native webp encoding; fall back via extension-driven write.
      // For webp output we go PNG → write under .webp name (jimp will refuse). Use raw buffer.
      throw new Error(`不支持目标格式 .${targetExt}（图片）`)
    }
  }
}

async function imgToPdf(src, out) {
  const ext = path.extname(src).slice(1).toLowerCase()
  const pdf = await PDFDocument.create()
  let bytes, embed
  if (ext === 'png') {
    bytes = fs.readFileSync(src)
    embed = await pdf.embedPng(bytes)
  } else if (ext === 'jpg' || ext === 'jpeg') {
    bytes = fs.readFileSync(src)
    embed = await pdf.embedJpg(bytes)
  } else {
    // BMP / WebP / others → re-encode to PNG via jimp first
    const img = await Jimp.read(src)
    bytes = await img.getBufferAsync(Jimp.MIME_PNG)
    embed = await pdf.embedPng(bytes)
  }
  const page = pdf.addPage([embed.width, embed.height])
  page.drawImage(embed, { x: 0, y: 0, width: embed.width, height: embed.height })
  fs.writeFileSync(out, await pdf.save())
}

// -- Document handlers --

async function docxToHtml(src, out) {
  const r = await mammoth.convertToHtml({ path: src })
  fs.writeFileSync(out, wrapHtml(r.value), 'utf8')
}

async function docxToMd(src, out) {
  const r = await mammoth.convertToHtml({ path: src })
  const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(r.value)
  fs.writeFileSync(out, md, 'utf8')
}

async function docxToTxt(src, out) {
  const r = await mammoth.extractRawText({ path: src })
  fs.writeFileSync(out, r.value, 'utf8')
}

async function docxToPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  const r = await mammoth.convertToHtml({ path: src })
  await ctx.htmlToPdf(wrapHtml(r.value), out)
}

async function mdToHtml(src, out) {
  const marked = await getMarked()
  const html = marked(fs.readFileSync(src, 'utf8'))
  fs.writeFileSync(out, wrapHtml(html), 'utf8')
}

async function mdToPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  const marked = await getMarked()
  const html = marked(fs.readFileSync(src, 'utf8'))
  await ctx.htmlToPdf(wrapHtml(html), out)
}

async function mdToDocx(src, out) {
  const marked = await getMarked()
  const html = marked(fs.readFileSync(src, 'utf8'))
  const buf = await htmlToDocx(wrapHtml(html))
  fs.writeFileSync(out, buf)
}

function mdToTxt(src, out) {
  const md = fs.readFileSync(src, 'utf8')
  // Strip the most common Markdown noise; not exhaustive but readable.
  const txt = md
    .replace(/```[\s\S]*?```/g, m => m.replace(/```[a-zA-Z0-9]*\n?|```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .trim()
  fs.writeFileSync(out, txt, 'utf8')
}

async function htmlPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  await ctx.htmlToPdf(fs.readFileSync(src, 'utf8'), out)
}

async function htmlDocx(src, out) {
  const buf = await htmlToDocx(fs.readFileSync(src, 'utf8'))
  fs.writeFileSync(out, buf)
}

function htmlToMdFn(src, out) {
  const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    .turndown(fs.readFileSync(src, 'utf8'))
  fs.writeFileSync(out, md, 'utf8')
}

function htmlToTxt(src, out) {
  const t = fs.readFileSync(src, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  fs.writeFileSync(out, t, 'utf8')
}

async function txtToPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  const txt = fs.readFileSync(src, 'utf8')
  const html = wrapHtml(`<pre style="font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;font-size:12pt;line-height:1.5;">${escapeHtml(txt)}</pre>`)
  await ctx.htmlToPdf(html, out)
}

async function txtToDocx(src, out) {
  const txt = fs.readFileSync(src, 'utf8')
  const html = `<pre>${escapeHtml(txt)}</pre>`
  const buf = await htmlToDocx(html)
  fs.writeFileSync(out, buf)
}

function txtToHtml(src, out) {
  const txt = fs.readFileSync(src, 'utf8')
  fs.writeFileSync(out, wrapHtml(`<pre>${escapeHtml(txt)}</pre>`), 'utf8')
}

function txtToMd(src, out) {
  // Plain text is valid Markdown; copy verbatim. (User may prefer fenced code block — keep simple.)
  fs.copyFileSync(src, out)
}

// -- PDF handlers --

async function pdfToTxt(src, out) {
  const text = await pdfExtractText(src)
  fs.writeFileSync(out, text, 'utf8')
}

async function pdfToDocx(src, out) {
  const text = await pdfExtractText(src)
  // Paragraph reconstruction from blank-line splits — pdf-parse only gives flat text,
  // so layout is lost. Acceptable for body-text PDFs; tables/figures won't survive.
  const html = text
    .split(/\n\s*\n/)
    .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('')
  const buf = await htmlToDocx(html || '<p></p>')
  fs.writeFileSync(out, buf)
}

function pdfToImg(fmt) {
  return async (src, out, ctx) => {
    if (!ctx || !ctx.pdfToImage) throw new Error('PDF→图片需要主进程注入 pdfToImage 能力')
    return await ctx.pdfToImage(src, out, fmt)
  }
}

// Split a PDF into one PDF per page, written into <basename>_split/ folder
// (collisions get _split_1, _split_2, ...). Single-page PDFs are rejected — no point splitting.
async function pdfSplit(src) {
  const srcDoc = await PDFDocument.load(fs.readFileSync(src))
  const numPages = srcDoc.getPageCount()
  if (numPages <= 1) throw new Error('单页 PDF 无需拆分')

  const srcDir = path.dirname(src)
  const srcBase = path.basename(src, path.extname(src))
  let folder = path.join(srcDir, `${srcBase}_split`)
  let i = 1
  while (fs.existsSync(folder)) {
    folder = path.join(srcDir, `${srcBase}_split_${i}`)
    i++
  }
  fs.mkdirSync(folder, { recursive: true })

  const pad = String(numPages).length
  for (let p = 0; p < numPages; p++) {
    const newDoc = await PDFDocument.create()
    const [copied] = await newDoc.copyPages(srcDoc, [p])
    newDoc.addPage(copied)
    const buf = await newDoc.save()
    const name = `page_${String(p + 1).padStart(pad, '0')}.pdf`
    fs.writeFileSync(path.join(folder, name), buf)
  }
  return { outPath: folder, count: numPages, isFolder: true }
}

// Rotate every page 90° clockwise. Adds to existing rotation (so two rotates → 180°).
async function pdfRotate90(src) {
  const doc = await PDFDocument.load(fs.readFileSync(src))
  for (const page of doc.getPages()) {
    const cur = page.getRotation().angle || 0
    page.setRotation(degrees((cur + 90) % 360))
  }
  // Compute final output path (planned `<base>.rotate90` is wrong since output is a PDF)
  const dir = path.dirname(src)
  const base = path.basename(src, path.extname(src))
  let outPath = path.join(dir, `${base}_rotated.pdf`)
  let i = 1
  while (fs.existsSync(outPath)) {
    outPath = path.join(dir, `${base}_rotated_${i}.pdf`)
    i++
  }
  fs.writeFileSync(outPath, await doc.save())
  return { outPath }
}

// -- Spreadsheet handlers (SheetJS / xlsx) --

function _readWorkbook(src) {
  // For xlsx/xls/ods/etc., readFile autodetects; for CSV we pass type:'string' explicitly.
  const ext = path.extname(src).slice(1).toLowerCase()
  if (ext === 'csv') {
    return XLSX.read(fs.readFileSync(src, 'utf8'), { type: 'string' })
  }
  return XLSX.readFile(src)
}

function _workbookToHtml(wb) {
  // Multi-sheet → concatenate with a sheet header before each table.
  const parts = []
  for (const name of wb.SheetNames) {
    const sheetHtml = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '' })
    parts.push(`<h2>${escapeHtml(name)}</h2>${sheetHtml}`)
  }
  return parts.join('\n')
}

async function xlsxToHtml(src, out) {
  const wb = _readWorkbook(src)
  fs.writeFileSync(out, wrapHtml(_workbookToHtml(wb)), 'utf8')
}

async function xlsxToCsv(src, out) {
  const wb = _readWorkbook(src)
  // CSV is single-sheet — emit the FIRST sheet only. Workbooks with multiple sheets get truncated;
  // we tell the user via an inline comment header so the loss is visible.
  const first = wb.Sheets[wb.SheetNames[0]]
  const csv = XLSX.utils.sheet_to_csv(first)
  const note = wb.SheetNames.length > 1
    ? `# 注意：原文件有 ${wb.SheetNames.length} 个 sheet，CSV 仅导出第一个 (${wb.SheetNames[0]})\n`
    : ''
  fs.writeFileSync(out, note + csv, 'utf8')
}

async function xlsxToPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  const wb = _readWorkbook(src)
  await ctx.htmlToPdf(wrapHtml(_workbookToHtml(wb)), out)
}

async function csvToXlsx(src, out) {
  const wb = _readWorkbook(src)
  XLSX.writeFile(wb, out)
}

async function csvToHtml(src, out) {
  const wb = _readWorkbook(src)
  fs.writeFileSync(out, wrapHtml(_workbookToHtml(wb)), 'utf8')
}

async function csvToPdf(src, out, ctx) {
  if (!ctx || !ctx.htmlToPdf) throw new Error('需要 htmlToPdf 能力')
  const wb = _readWorkbook(src)
  await ctx.htmlToPdf(wrapHtml(_workbookToHtml(wb)), out)
}

async function csvToTxt(src, out) {
  // CSV is already plain text; this is just a copy with .txt rename.
  fs.copyFileSync(src, out)
}

// -- Routing table --
const HANDLERS = {
  // 图片互转 (jpeg targets canonicalized to .jpg; source .jpeg is normalized in normExt)
  'png->jpg':   imgConvert('jpeg'),
  'png->bmp':   imgConvert('bmp'),
  'jpg->png':   imgConvert('png'),
  'jpg->bmp':   imgConvert('bmp'),
  'bmp->png':   imgConvert('png'),
  'bmp->jpg':   imgConvert('jpeg'),
  // WebP: jimp 0.22 lacks a built-in webp encoder — we only support webp → other formats.
  'webp->png':  imgConvert('png'),
  'webp->jpg':  imgConvert('jpeg'),
  'webp->bmp':  imgConvert('bmp'),

  // 图片 → PDF
  'png->pdf':  imgToPdf,
  'jpg->pdf':  imgToPdf,
  'bmp->pdf':  imgToPdf,
  'webp->pdf': imgToPdf,

  // 文档系
  'docx->html': docxToHtml,
  'docx->md':   docxToMd,
  'docx->txt':  docxToTxt,
  'docx->pdf':  docxToPdf,
  'md->html':   mdToHtml,
  'md->docx':   mdToDocx,
  'md->pdf':    mdToPdf,
  'md->txt':    mdToTxt,
  'html->md':   htmlToMdFn,
  'html->docx': htmlDocx,
  'html->pdf':  htmlPdf,
  'html->txt':  htmlToTxt,
  'htm->md':    htmlToMdFn,
  'htm->docx':  htmlDocx,
  'htm->pdf':   htmlPdf,
  'htm->txt':   htmlToTxt,
  'txt->pdf':   txtToPdf,
  'txt->docx':  txtToDocx,
  'txt->html':  txtToHtml,
  'txt->md':    txtToMd,

  // PDF
  'pdf->txt':      pdfToTxt,
  'pdf->docx':     pdfToDocx,
  'pdf->png':      pdfToImg('png'),
  'pdf->jpg':      pdfToImg('jpeg'),
  'pdf->split':    pdfSplit,
  'pdf->rotate90': pdfRotate90,

  // 表格
  'xlsx->pdf':  xlsxToPdf,
  'xlsx->html': xlsxToHtml,
  'xlsx->csv':  xlsxToCsv,
  'xls->pdf':   xlsxToPdf,
  'xls->html':  xlsxToHtml,
  'xls->csv':   xlsxToCsv,
  'csv->xlsx':  csvToXlsx,
  'csv->html':  csvToHtml,
  'csv->pdf':   csvToPdf,
  'csv->txt':   csvToTxt,
}

// -- Public API --

function normExt(srcPath) {
  let ext = path.extname(srcPath).slice(1).toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'  // canonicalize
  return ext
}

function uniqueOutPath(srcPath, target) {
  const dir = path.dirname(srcPath)
  const base = path.basename(srcPath, path.extname(srcPath))
  let candidate = path.join(dir, `${base}.${target}`)
  let i = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${i}.${target}`)
    i++
  }
  return candidate
}

function listTargets(srcPath) {
  if (!srcPath) return []
  const ext = normExt(srcPath)
  const targets = new Set()
  for (const k of Object.keys(HANDLERS)) {
    const [s] = k.split('->')
    const sNorm = s === 'jpeg' ? 'jpg' : s
    if (sNorm === ext) targets.add(k.split('->')[1])
  }
  return [...targets]
}

async function convert(srcPath, target, ctx) {
  ctx = ctx || {}
  if (!srcPath || !fs.existsSync(srcPath)) {
    return { ok: false, error: '源文件不存在' }
  }
  if (!target) return { ok: false, error: '未指定目标格式' }
  const ext = normExt(srcPath)
  const tgt = String(target).toLowerCase()
  // Try direct, then jpeg→jpg fallback for safety
  let key = `${ext}->${tgt}`
  let handler = HANDLERS[key]
  if (!handler && ext === 'jpg') handler = HANDLERS[`jpeg->${tgt}`]
  if (!handler) return { ok: false, error: `不支持 .${ext} → .${tgt}` }
  const out = uniqueOutPath(srcPath, tgt)
  try {
    const r = await handler(srcPath, out, ctx)
    // Handler may return an object { outPath, count, isFolder } to override the planned out
    // (used by pdfToImage when it wraps multi-page output in a subfolder). Otherwise we
    // expect the handler to have written to `out`.
    if (r && typeof r === 'object' && !Array.isArray(r) && r.outPath) {
      return { ok: true, ...r }
    }
    if (!fs.existsSync(out)) {
      return { ok: false, error: '转换器没有生成输出文件' }
    }
    return { ok: true, outPath: out }
  } catch (err) {
    // Clean up partial output on failure
    try { if (fs.existsSync(out)) fs.unlinkSync(out) } catch {}
    return { ok: false, error: err.message || String(err) }
  }
}

// -- Helpers --

function wrapHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:"Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222;padding:24px;max-width:800px;margin:0 auto;}
h1,h2,h3,h4{margin:1em 0 .4em;}
p{margin:.5em 0;}
pre,code{font-family:Consolas,"Courier New",monospace;background:#f5f5f7;padding:2px 4px;border-radius:3px;}
pre{padding:10px;overflow-x:auto;white-space:pre-wrap;}
table{border-collapse:collapse;}
th,td{border:1px solid #ccc;padding:4px 8px;}
img{max-width:100%;}
</style></head><body>${body}</body></html>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

module.exports = { convert, listTargets }
