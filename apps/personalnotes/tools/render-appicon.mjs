// Rasterize the PersonalNotes brand SVGs into the macOS AppIcon iconset + evidence
// renders. Pixel-exact via headless Chromium (the same Playwright harness as
// tools/shoot.mjs) — no separate SVG rasterizer dependency.
//
//   node tools/render-appicon.mjs
//
// Outputs (checked into the tree; scripts/build_personalnotes.sh assembles the
// .icns from the iconset with `iconutil` when building on macOS):
//   assets/brand/AppIcon.iconset/icon_{16,32,128,256,512}x*{,@2x}.png
//   assets/brand/renders/icon-{16,32,64,128,256,512,1024}.png   (evidence)
//   assets/brand/renders/menubar-{idle,rec}.png                 (36px preview on grey)
//
// Playwright is not a dependency of this repo; point PLAYWRIGHT_MODULE at an
// existing install if `import('playwright')` fails (see tools/shoot.mjs).
const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { chromium } = playwrightModule.default ?? playwrightModule
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdirSync, readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const brand = resolve(root, 'assets/brand')
const iconsetDir = resolve(brand, 'AppIcon.iconset')
const rendersDir = resolve(brand, 'renders')
mkdirSync(iconsetDir, { recursive: true })
mkdirSync(rendersDir, { recursive: true })

// Inline the SVG as a data URL — a bare file:// <img> is blocked from the
// synthetic about:blank page, a data URL is not.
const dataURL = (file) =>
  'data:image/svg+xml;base64,' + readFileSync(resolve(brand, file)).toString('base64')
const iconSVG = dataURL('personalnotes-icon.svg')

const browser = await chromium.launch()

/** Render an SVG at an exact pixel size on a transparent (or given) background. */
async function renderPNG(svgURL, size, out, { background = 'transparent' } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${background};}img{display:block;}</style>` +
    `<img src="${svgURL}" width="${size}" height="${size}">`,
    { waitUntil: 'networkidle' },
  )
  await page.screenshot({ path: out, omitBackground: background === 'transparent' })
  await page.close()
  console.log('render', out.replace(root + '/', ''), `${size}x${size}`)
}

// 1. The canonical macOS iconset (icon_<pt>x<pt>[@2x].png).
const ICONSET = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
]
for (const [name, px] of ICONSET) await renderPNG(iconSVG, px, resolve(iconsetDir, name))

// 2. Evidence renders for docs/brand-visual-system.md review.
for (const px of [16, 32, 64, 128, 256, 512, 1024]) {
  await renderPNG(iconSVG, px, resolve(rendersDir, `icon-${px}.png`))
}
// Menu-bar template glyphs previewed at 2x on a neutral menu-bar grey.
for (const [svg, name] of [['personalnotes-menubar.svg', 'menubar-idle'], ['personalnotes-menubar-rec.svg', 'menubar-rec']]) {
  await renderPNG(dataURL(svg), 36, resolve(rendersDir, `${name}.png`), { background: '#ECECEC' })
}

await browser.close()
console.log('done: iconset at', iconsetDir.replace(root + '/', ''))
