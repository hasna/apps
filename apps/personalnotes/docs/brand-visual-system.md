# PersonalNotes — App Icon & Menu-Bar Visual System

The visual system for the PersonalNotes app icon and the macOS menu-bar surface:
the mark, its colors, the icon grid, the menu-bar template rules, and the code
that consumes each asset. As of the P4 design pass the assets are **wired into
the build**: `scripts/build_personalnotes.sh` assembles `AppIcon.icns` from the
checked-in iconset and bundles the menu-bar template glyphs, and the shell's
status item renders them (see the code map at the end).

## Source of truth

The only brand convention is the app's own *infinity-purple* system, defined as
design tokens in `web/styles.css` (`docs/design-rules-macos26.md` §3.2). The
mark is derived from the glyph shipped in the web UI's About badge: a note-card
outline with a `#B7B2F6` text panel and a white **person** silhouette on an
accent badge.

So the mark means **"personal notes"** = *a note card + a person*. The app icon
and menu-bar glyph formalize that existing idea; they do not invent a new one.

## Color tokens

All values are cross-referenced to the design tokens that define them so the
brand stays in sync with the product (one accent across native and web —
design Rule 10).

| Token              | Hex       | Defined in |
|--------------------|-----------|------------|
| Deep violet        | `#5729A3` | `web/styles.css` `--sb-grad-0` (light) |
| Indigo             | `#4D2EB8` | `web/styles.css` `--sb-grad-1` (light) |
| Magenta            | `#85299E` | `web/styles.css` `--sb-grad-2` (light) |
| Accent / badge disc| `#7C3AED` | `web/styles.css` `--accent` = `main.swift` `BrandColor.accent` (light) |
| Text panel         | `#B7B2F6` | web About `.badge-glyph` panel fill |

The icon body uses the **light** sidebar gradient (deep violet → indigo →
magenta) on a top-left→bottom-right diagonal. Dark-mode tokens are intentionally
*not* baked into the icon — an app icon is a fixed asset, and the light gradient
is the brand's primary face.

## The mark (anatomy)

Master: [`assets/brand/personalnotes-icon.svg`](../assets/brand/personalnotes-icon.svg)
(1024×1024). Renders: `assets/brand/renders/icon-*.png`.

1. **Squircle body** — 832×832 inside a 96px margin on the 1024 grid; `rx ≈ 186`
   (≈22.4% of the side, the macOS "continuous corner" approximation). Fill is the
   infinity-purple diagonal gradient with a faint top white sheen (≤16% alpha) so
   it reads as a physical macOS icon.
2. **Note card** — white, rounded, rotated −4° for warmth, centered in the safe
   area. Three `#B7B2F6` text-line panels (full, full, two-thirds) reuse the web
   badge's panel fill.
3. **Person badge** — a `#7C3AED` (`--accent`) disc with a 16px white ring and a
   white person silhouette, overlapping the card's bottom-right. This is the
   "Personal" half of "Personal Notes."

### App-icon grid & clearspace

- Author and export on the **1024×1024** master. Generate the standard macOS
  set: 16, 32, 64, 128, 256, 512, 1024 (each also at `@2x`).
- Keep the 96px (≈9.4%) transparent margin — macOS rounds and shadows the
  squircle itself; do not add your own outer shadow to the asset.
- Minimum legible size is 16px: at that size the card + badge still resolve as
  two shapes (verify against `renders/icon-16.png`). No text inside the mark.

## Menu bar

The status item lives in `Sources/PersonalNotesApp/main.swift` (`showStatusItem`)
and is created **lazily, only while recording** — idle outside recording, the
status item is hidden entirely.

The glyphs are **template images** so macOS auto-tints them for light/dark menu
bars and accent settings:

- Masters:
  [`assets/brand/personalnotes-menubar.svg`](../assets/brand/personalnotes-menubar.svg)
  (idle card) and
  [`assets/brand/personalnotes-menubar-rec.svg`](../assets/brand/personalnotes-menubar-rec.svg)
  (recording: same card + filled dot). Both are authored **black-on-transparent**
  on an 18×18pt grid with a ~1pt optical inset.
- Loaded by `loadStatusGlyph` with `isTemplate = true`; because template images
  are tinted by the system, brand purple is **not** baked into the glyph.
- State mapping in `refreshStatusTitle` (tint via `button.contentTintColor`):
  - **Recording** — dotted glyph, `NSColor.systemRed`, title `REC`.
  - **Paused** — dot-less glyph, secondary-label tint, title `REC`.
  - **Transcribing / stopping** — dot-less glyph, `BrandColor.accent`,
    title `TRANS` / `STOP`.
  - When the glyphs are not bundled (bare `swift run` outside the .app), the
    legacy text-only titles (`● REC`, `❚❚ REC`, …) remain as the fallback.

## How this maps to code (wired)

| Asset | Consumed by |
|-------|-------------|
| `personalnotes-icon.svg` → `assets/brand/AppIcon.iconset/` → `AppIcon.icns` | `tools/render-appicon.mjs` rasterizes the checked-in iconset; `scripts/build_personalnotes.sh` assembles the `.icns` with `iconutil` at build time (graceful skip off-macOS) and sets `CFBundleIconFile` only when the icns exists. |
| `personalnotes-menubar*.svg` | Bundled to `Resources/brand/` by `scripts/build_personalnotes.sh`; `showStatusItem`/`refreshStatusTitle` in `Sources/PersonalNotesApp/main.swift` render them as template images. |

## Evidence

Rasterized pixel-exact from the SVG masters with headless Chromium
(`tools/render-appicon.mjs`, the same Playwright harness as `tools/shoot.mjs`):

- `assets/brand/AppIcon.iconset/icon_{16..512}x*{,@2x}.png` — the canonical
  macOS iconset consumed by the build.
- `assets/brand/renders/icon-{16,32,64,128,256,512,1024}.png` — the size ramp.
- `assets/brand/renders/menubar-idle.png`, `menubar-rec.png` — glyph previews.

Re-run with `node tools/render-appicon.mjs` whenever an SVG master changes —
the SVGs remain the single source of truth.
