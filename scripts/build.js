// Programmatic build runner for SilverWolfPet.
//
// Why Node instead of CLI flags: passing regex anchors (`^`) via shell breaks on Windows
// because cmd.exe treats `^` as an escape character and silently strips it. That stripped
// `^/dist` to `/dist`, which then matched nested `node_modules/<pkg>/dist/...` as a substring
// and removed real runtime files (notably html-to-docx/dist/html-to-docx.umd.js, leading to
// `Cannot find module` at app launch). Using JS RegExp objects bypasses the shell entirely.

const packager = require('@electron/packager').default || require('@electron/packager').packager
const path = require('path')

async function main() {
  const root = path.resolve(__dirname, '..')

  // Each ignore is a real RegExp anchored at the start of the relative path
  // (electron-packager passes paths like `/main.js` or `/node_modules/foo/bar.js`).
  // 模型 (~234MB) 现在打进发行包，让小白用户解压即用。诊断兜底见
  // services/voice.js 的 stage tagging。
  // docs/ 是白名单制：用户向文档（使用说明书 / 快速开始 / 第三方协议）入包，
  // 开发者向文档（spec / code-review / 测试报告 / persona 同步源）排除。
  // 这样发行包内 docs/ 子目录就是终端用户能直接打开看的内容，
  // 没有半成品 / 内部规格 / review 笔记之类容易让用户困惑的东西。
  const ignore = [
    /^\/dist(\/|$)/,
    /^\/scripts(\/|$)/,
    /^\/logs(\/|$)/,
    /^\/release-assets(\/|$)/,
    /^\/build\.bat$/,
    /^\/\.claude(\/|$)/,
    /^\/node_modules\/electron(\/|$)/,
    /^\/node_modules\/@electron(\/|$)/,
    /^\/assets\/launcher_raw\.png$/,
    /^\/assets\/sw_side\.png$/,
    /^\/assets\/sw_sprite\.png$/,
    /^\/assets\/sw_sprite_flip\.png$/,
    // 开发者向 docs（不入发行包）：
    /^\/docs\/voice-input-spec\.md$/,
    /^\/docs\/voice-code-review.*\.md$/,
    /^\/docs\/voice-input-accuracy-test\.md$/,
    /^\/docs\/silver-wolf-skill-distilled\.md$/,
    /^\/docs\/knowledge-base-design\.md$/,
  ]

  const result = await packager({
    dir: root,
    name: 'SilverWolfPet',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'dist'),
    overwrite: true,
    icon: path.join(root, 'assets', 'icon.ico'),
    electronVersion: '28.3.3',
    // Disable prune. Pruning relies on `galactus` walking package.json deps; with the
    // PowerShell/Python toolchain we keep here it's been unreliable. Manually ignoring
    // the only large dev dep (electron itself) is simpler and predictable.
    prune: false,
    ignore,
  })

  // -- Post-packager: stage user-facing 一键配置 files into dist root --
  // The ignore list above keeps release-assets/ out of the asar; we now pull the
  // .bat scripts and bundled VC++ runtime back in at the dist root so a small-PC
  // user just unzips and double-clicks. vc_redist may be absent on dev/CI machines
  // (it's gitignored), so we warn-not-fail to keep build smoke tests green.
  const fs = require('fs')
  const distRoot = result[0]
  const releaseSrc = path.join(root, 'release-assets')

  // 拷 .bat 到 dist 根
  for (const fname of ['配置环境.bat', '启动银狼.bat']) {
    const src = path.join(releaseSrc, fname)
    if (!fs.existsSync(src)) {
      console.warn('[build] WARN: release-assets/' + fname + ' 缺失，跳过拷贝')
      continue
    }
    fs.copyFileSync(src, path.join(distRoot, fname))
  }

  // 拷 vc_redist 到 dist/redist/
  const redistSrc = path.join(releaseSrc, 'vc_redist.x64.exe')
  if (fs.existsSync(redistSrc)) {
    const redistDst = path.join(distRoot, 'redist')
    fs.mkdirSync(redistDst, { recursive: true })
    fs.copyFileSync(redistSrc, path.join(redistDst, 'vc_redist.x64.exe'))
    console.log('[build] 已拷入 vc_redist.x64.exe')
  } else {
    console.warn('[build] WARN: release-assets/vc_redist.x64.exe 缺失')
    console.warn('[build]       发行包将不带 VC++ 运行库，小白用户可能装完没法用。')
    console.warn('[build]       去 https://aka.ms/vs/17/release/vc_redist.x64.exe 下载放进去。')
  }

  // 写终端用户 README（必须 \r\n + UTF-8 BOM 兼容 Windows 记事本）
  const pkgVer = require(path.join(root, 'package.json')).version
  const readmeBom = '﻿'
  const readmeBody = [
    '█ 第一次用？翻到「30 秒看完就上手」从头读一遍。',
    '',
    '银狼桌宠 v' + pkgVer + ' — 安装说明',
    '═══════════════════════════════════════',
    '',
    '【首次使用 3 步】',
    '',
    '步骤 1 ─ 解压',
    '  解压本 zip 到任意位置（推荐 D 盘根目录）',
    '  ⚠ 不要放 C:\\Program Files（需要管理员权限）',
    '',
    '步骤 2 ─ 配置环境（仅首次）',
    '  双击 ① 配置环境.bat',
    '  会自动安装语音功能所需的 VC++ 运行库（约 30 秒）',
    '',
    '步骤 3 ─ 启动',
    '  双击 ② 启动银狼.bat',
    '  ',
    '  首次启动遇到蓝色窗口（Windows SmartScreen）：',
    '    a. 点击 "更多信息"',
    '    b. 点击 "仍要运行"',
    '  下次启动就不会再问。',
    '',
    '  启动后弹出的设置窗里粘贴 Anthropic API Key。',
    '  没有 Key？去 console.anthropic.com 注册账号。',
    '',
    '═══════════════════════════════════════',
    '【常见问题】',
    '',
    '✘ 语音 PTT 用不了 / 气泡显示"PTT 暂时不能用"',
    '  → 检查 %APPDATA%\\silver-wolf-pet\\logs\\voice-init.log',
    '  → 详细排查见 resources\\app\\docs\\使用说明书.md §8.14',
    '',
    '✘ 启动报错 / 黑屏',
    '  → 重新跑一次 ① 配置环境.bat',
    '  → 关闭杀软或加白名单 (尤其 360 / 火绒)',
    '',
    '✘ 报红色 ERROR: Request Not Allowed',
    '  → 大陆 IP 被 Anthropic 风控了，挂代理（系统级 / TUN 模式）',
    '  → 详细排查见 resources\\app\\docs\\使用说明书.md §8.15',
    '',
    '═══════════════════════════════════════',
    '详细教程：解压目录\\resources\\app\\docs\\使用说明书.md',
    '         （从 §3.0「30 秒看完就上手」开始读，专为新手写）',
    '反馈渠道：[暂无 — 直接联系作者]',
    '',
  ].join('\r\n')

  fs.writeFileSync(path.join(distRoot, 'README - 必读.txt'),
                   readmeBom + readmeBody, 'utf8')
  console.log('[build] 已写入 README - 必读.txt')

  console.log('Wrote new app to:', result.join(', '))
}

main().catch(err => {
  console.error('[build] failed:', err)
  process.exit(1)
})
