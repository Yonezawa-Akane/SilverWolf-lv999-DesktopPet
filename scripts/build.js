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
  const ignore = [
    /^\/dist(\/|$)/,
    /^\/scripts(\/|$)/,
    /^\/docs(\/|$)/,
    /^\/build\.bat$/,
    /^\/\.claude(\/|$)/,
    /^\/node_modules\/electron(\/|$)/,
    /^\/node_modules\/@electron(\/|$)/,
    /^\/assets\/launcher_raw\.png$/,
    /^\/assets\/sw_side\.png$/,
    /^\/assets\/sw_sprite\.png$/,
    /^\/assets\/sw_sprite_flip\.png$/,
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

  console.log('Wrote new app to:', result.join(', '))
}

main().catch(err => {
  console.error('[build] failed:', err)
  process.exit(1)
})
