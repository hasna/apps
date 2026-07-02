# Design Rules — macOS 26 "Tahoe" Liquid Glass

Authoritative design spec for PersonalNotes. Covers both surfaces:

- the SwiftUI app (`Sources/OpenNotes/` — removed in the P1 de-bloat; sections
  kept for historical reference), and
- the web UI (`web/`) hosted full-bleed in the borderless WKWebView shell
  (`Sources/PersonalNotesApp/main.swift`).

The product identity is fixed by `README.md` and must be preserved: a narrow
**infinity-purple Liquid-Glass sidebar** beside **ONE continuous white canvas**
(compact header line, note list, rich-text editor) separated only by hairline
dividers — no boxed panels. This spec makes that identity *native to macOS 26*,
it does not replace it. Nothing here may break the functionality contracts in
`docs/ui-contracts.md` (boot/hydrate payload, bridge actions, chat/recording
events, confirmation-gated deletes).

---

## 1. Canonical rules

Each rule: one line, then source.

1. **Liquid Glass lives only in the controls/navigation layer floating above
   content — never in the content layer (lists, editor text, cards).**
   [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
2. **Never stack glass on glass; one glass plane per region, and content
   renders on standard materials beneath it.**
   [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
3. **Use `.regular` glass by default; use `.clear` only over media-rich
   content that tolerates a dimming layer and carries bold, bright foreground.**
   [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/) · [LiquidGlassReference](https://github.com/conorluddy/LiquidGlassReference)
4. **Multiple neighboring glass shapes must share one `GlassEffectContainer`
   (single sampling region, correct blending, morphing via `glassEffectID`).**
   [GlassEffectContainer — Apple docs](https://developer.apple.com/documentation/swiftui/glasseffectcontainer) · [Build a SwiftUI app with the new design — WWDC25](https://developer.apple.com/videos/play/wwdc2025/323/)
5. **Glass is functional, not decorative: it signals depth, floating chrome,
   and context change — tint it only to carry meaning (here: the brand purple
   sidebar), not for ornament.**
   [Create with Swift: Hierarchy, Harmony, Consistency](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/)
6. **Scrollable content must pass under floating chrome with a scroll edge
   effect (`.soft` for pinned headers/sidebars, `.hard` for discrete
   boundaries) — never a hard clip and never an opaque strip.**
   [scrollEdgeEffectStyle(_:for:) — Apple docs](https://developer.apple.com/documentation/SwiftUI/View/scrollEdgeEffectStyle(_:for:)) · [Create with Swift: scroll edge effect](https://www.createwithswift.com/define-the-scroll-edge-effect-style-of-a-scroll-view-for-liquid-glass/)
7. **Corner radii are concentric: a nested element's radius = container radius
   − inset, and macOS 26 toolbar windows round at ~26pt (titlebar-only ~16pt);
   use `.containerConcentric` instead of hard-coding where possible.**
   [Tahoe window corners — mjtsai](https://mjtsai.com/blog/2025/10/16/tahoe-window-corners/) · [lapcatsoftware](https://lapcatsoftware.com/articles/2026/3/1.html) · [LiquidGlassReference](https://github.com/conorluddy/LiquidGlassReference)
8. **A hidden title bar does not remove the traffic lights: reserve a
   top-left keep-out zone (≈78px wide × ≈40px tall, logical px) that contains
   no text or interactive controls and behaves as a window-drag region.**
   [Electron: custom title bar / hiddenInset pattern](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) · [dotnet/maui #33136 (Tahoe buttons grew)](https://github.com/dotnet/maui/issues/33136)
9. **Typography is the system stack (SF Pro via text styles); macOS body is
   13pt, and UI text uses the default SF design — SF Rounded is a deliberate
   brand deviation to be used sparingly, never for whole surfaces.**
   [HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
10. **Honor the user's accent color for interactive states where possible, and
    apply the brand purple through a single token so native and web agree.**
    [HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color)
11. **Dark mode is a first-class palette (semantic tokens, not per-component
    overrides), and window/backing colors must follow the effective appearance.**
    [HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
12. **Reduce Transparency replaces glass with an opaque equivalent; Increase
    Contrast strengthens borders/text; Reduce Motion disables springs, pulses
    and morphs — all three need explicit fallbacks on both surfaces.**
    [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [macOS 26.1 added a system Tinted/Clear glass toggle](https://www.macrumors.com/how-to/ios-26-1-reduce-liquid-glass-effects/) · [Six Colors on 26.1](https://sixcolors.com/post/2025/11/soaping-up-liquid-glass-less-transparency-more-contrast/)
13. **Since 26.1 users can pick "Tinted" glass system-wide (more opacity, more
    contrast): don't hand-tune opacity constants that fight the system; keep
    glass parameters close to defaults so the toggle keeps working.**
    [OSXDaily: Clear vs Tinted in Tahoe](https://osxdaily.com/2025/11/10/how-to-switch-from-clear-or-tinted-appearance-in-macos-tahoe/)
14. **Keyboard focus is always visible: macOS draws a ~3px accent-tinted halo
    around the focused control; custom controls (and all web controls) must
    reproduce it via `:focus-visible`.**
    [HIG: Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection)
15. **Scrollbars are overlay style: invisible until scrolling, thin translucent
    thumb, no permanent track.**
    [HIG: Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views)
16. **Separate regions with hairlines and whitespace, not boxes; the content
    canvas is one continuous surface (this is also the README identity).**
    [HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) · `README.md`
17. **Buttons that float on glass/chrome use `.buttonStyle(.glass)` /
    `.glassProminent`; toolbar grouping uses `ToolbarSpacer(.fixed/.flexible)`.**
    [Build a SwiftUI app with the new design — WWDC25](https://developer.apple.com/videos/play/wwdc2025/323/) · [LiquidGlassReference](https://github.com/conorluddy/LiquidGlassReference)
18. **Edge-to-edge hero/content colors extend under chrome with
    `.backgroundExtensionEffect()` rather than manual negative insets.**
    [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
19. **Micro-interactions are small, fast and physical: ≤200ms ease-out for
    hovers, spring only for spatial changes, and every animation has a
    reduced-motion path.**
    [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
20. **Text on glass must remain legible in both appearances; if contrast can't
    be guaranteed over the refracted background, add a tint or fall back to a
    material.**
    [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

---

## 2. SwiftUI app (`Sources/OpenNotes/`)

The purple-sidebar + white-canvas identity stays. These rules make it real
Liquid Glass instead of a painted gradient.

### 2.1 Window & structure

- **DO** keep `WindowGroup(...).windowStyle(.hiddenTitleBar)`
  (`OpenNotesApp.swift:16`) — but treat the traffic lights as a first-class
  layout constraint (see 2.4).
- **DO** keep the `HStack { SidebarView; canvas }` composition if the custom
  narrow sidebar is retained, but the preferred macOS-26 shape is:

  ```swift
  NavigationSplitView {
      SidebarView(store: store)
          .navigationSplitViewColumnWidth(min: 180, ideal: Theme.sidebarWidth)
  } detail: { ... }
  ```

  because a real sidebar column extends under the title bar, picks up the
  window drag behavior, the 26pt concentric window corner, and scroll edge
  effects for free. If the hand-rolled `HStack` stays, every one of those
  behaviors must be reimplemented manually.
- **DON'T** put glass anywhere in the canvas (note list rows, editor, header
  bar). The canvas is the content layer: `Theme.canvas(_:)` white / window
  background only (Rule 1).

### 2.2 The purple Liquid-Glass sidebar

- **DO** render the infinity-purple gradient as the *background layer* and put
  actual glass on the *chrome floating above it*:

  ```swift
  // ContentView — sidebar region
  SidebarView(store: store)
      .frame(width: Theme.sidebarWidth)
      .background(Theme.sidebarGradient(colorScheme).ignoresSafeArea())
  ```

  and inside `SidebarView`, glass the floating pieces (section chrome,
  selected row, sync pill) — not the whole column, and never row-glass inside
  section-glass (Rule 2):

  ```swift
  @Namespace private var glassNS

  GlassEffectContainer(spacing: 12) {          // Rule 4: one container
      ForEach(...) { row in
          rowLabel
              .glassEffect(
                  .regular.tint(Theme.accent.opacity(selected ? 0.35 : 0)).interactive(),
                  in: .rect(cornerRadius: Theme.cornerSmall)
              )
              .glassEffectID(row.id, in: glassNS) // selection morphs between rows
      }
  }
  ```

- **DO** route every glass call through the existing `Theme.glassSurface`
  helper (`Theme.swift:41`) so the `accessibilityReduceTransparency` fallback
  (`Theme.swift:60-71`) always applies. Today the helper exists but nothing
  calls it — the sidebar is a plain gradient.
- **DO** delete the no-op `.overlay(.ultraThinMaterial.opacity(0.0))`
  (`ContentView.swift:47`); a zero-opacity material is dead code that reads as
  glass but isn't.
- **DON'T** hand-tune `glass.tint(tint.opacity(0.35))` further
  (`Theme.swift:74`): keep tints near defaults so the system 26.1
  Tinted/Clear appearance toggle behaves (Rule 13).
- **DON'T** use `.clear` glass here: the sidebar sits over a flat gradient,
  not media (Rule 3).

### 2.3 Scroll edge effects

- **DO** add to the sidebar scroller (`SidebarView.swift:16`):

  ```swift
  ScrollView { ... }
      .scrollEdgeEffectStyle(.soft, for: .top)
  ```

  so section headers fade under the traffic-light band instead of clipping.
- **DO** add `.scrollEdgeEffectStyle(.hard, for: .top)` to the note list
  (`NoteListView.swift:21`) beneath its pinned search row — a `.hard` edge is
  the correct discrete boundary under a hairline (Rule 6).

### 2.4 Traffic lights & header

- **DO** reserve the keep-out zone: with `.hiddenTitleBar` +
  `.ignoresSafeArea(.container, edges: .top)` (`ContentView.swift:33`), the
  buttons overlay the purple sidebar's top-left. The first sidebar content
  (currently `.padding(.top, 24)` at `SidebarView.swift:25`, i.e. y≈38 with
  the 14pt inner padding) must start **≥ 52pt** from the window top, and no
  interactive control may live in the top-left 78×40pt (Rule 8). Tahoe's
  buttons are larger than Sequoia's — 24pt of headroom is not enough.
- **DO** keep the compact "12 notes · Updated 3m ago" HeaderBar
  (`ContentView.swift:54-86`) — it is the README identity — but its
  new-note button should read as chrome:

  ```swift
  Button { store.createNote() } label: { Image(systemName: "square.and.pencil") }
      .buttonStyle(.glass)          // Rule 17 — floats above the canvas
  ```

  (`.plain` is acceptable only while the header is treated as content.)
- **DON'T** add a big navigation title or a stock toolbar; if a toolbar is
  ever introduced, group items with `ToolbarSpacer(.fixed)` /
  `ToolbarSpacer(.flexible)` rather than `Spacer` hacks.

### 2.5 Color, typography, motion

- **DO** declare one accent: `Theme.accent` is canonical for native; set it
  app-wide once (`ContentView(...).tint(Theme.accent)`) instead of sprinkling
  `Theme.accent` per view (`NoteListView.swift:39,128`). Align its hex with
  the web token (see §3.2) — today native is `#804DE6` and web is `#7C3AED`.
- **DO** use text styles, not fixed sizes, for UI text: `.body` (13pt),
  `.headline`, `.caption2` map to the macOS scale automatically (Rule 9).
  Editor *content* fonts (`MarkdownStyling.swift:14-16`) should derive from
  `NSFont.preferredFont(forTextStyle:)` so they respect user text-size
  settings:

  ```swift
  static let bodyFont  = NSFont.preferredFont(forTextStyle: .body)     // 13pt default; 14 fixed today
  static let titleFont = NSFont.preferredFont(forTextStyle: .title2)   // ~22
  static let headingFont = NSFont.preferredFont(forTextStyle: .title3) // ~17
  ```

- **LIMIT** `design: .rounded`: today every label uses it
  (`ContentView.swift:80`, `SidebarView.swift:213`, `NoteListView.swift:73,93,112`,
  `EditorView.swift:27,61`). Keep rounded at most for the note title and the
  header line (brand voice); list rows, search field, and metadata should be
  default SF so the app reads native (Rule 9).
- **DO** gate springs on Reduce Motion (`SidebarView.swift:196`):

  ```swift
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82)) { ... }
  ```

- **DO** keep hairlines as `Divider().opacity(0.35–0.5)` — correct per
  Rule 16; never replace them with bordered boxes.
- **DO** keep white-on-purple sidebar text, but verify with Increase Contrast:
  counts at `.white.opacity(0.55)` (`SidebarView.swift:219`) are below 4.5:1
  on the lighter gradient stops; bump to ≥0.7 when
  `accessibilityDifferentiateWithoutColor`/increase-contrast is set.

---

## 3. Web UI (`web/`)

The WKWebView shell hides the titlebar and injects `body.native`
(`main.swift:773-796`); the web page **is** the window. It must therefore
reproduce window anatomy itself: traffic-light inset, drag band, scroll edge
fades, overlay scrollbars, focus rings, and the purple-glass sidebar identity.

### 3.1 Token table — foundation

| Token | Value (light) | Value (dark) | Notes |
|---|---|---|---|
| `--font` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif` | same | system stack; add `BlinkMacSystemFont` to current stack (`styles.css:16`) |
| `--mono` | `ui-monospace, "SF Mono", Menlo, monospace` | same | already correct |
| Base size | `13px` / `line-height 1.4` | same | matches macOS body 13pt ([HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)) |

Type scale (mirrors macOS text styles; sizes in px @1x):

| Role | Size/weight | Use |
|---|---|---|
| Large title | 26 / 400 | never in-app (identity: no big titles) |
| Title 1 | 22 / 700 | editor note title (`.editor-title` — today 25/600, bring to 22/700) |
| Title 2 | 17 / 600 | page titles (`.np-title`, `.set-title` — today 21px; 17–21 acceptable, pick one) |
| Headline | 13 / 600 | row titles, card titles |
| Body | 13 / 400 | default UI text |
| Callout | 12 / 400 | metadata lines |
| Caption | 11 / 400–500 | section labels, ages, counts |

Spacing scale — 4px grid only: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40`.
(Existing odd values — 7px paddings, 9px gaps, 11px rows — round to the grid
during touch-ups; do not introduce new off-grid values.)

Radii — concentric (Rule 7): inner = outer − inset.

| Token | Value | Applies to |
|---|---|---|
| `--r-window` | `26px` | `.window` card in browser/screenshot mode only (today 12px, `styles.css:47`); `0` in `body.native` (AppKit rounds the real window) |
| `--r-panel` | `14px` | popovers, context menus, transcript, cards ≥ 12px inset from window edge |
| `--r-control` | `8px` | rows, buttons, inputs, hover pills |
| `--r-pill` | `999px` | composer pill, record pill, toasts |

### 3.2 Palette — infinity purple + white canvas

One brand purple across native and web. Canonical accent: **`#7C3AED`**
(5.7:1 on white — AA). `Theme.accent` (`#804DE6`) and the badge (`#5F55EC`,
`styles.css:88`) must converge on it.

| Token | Light | Dark |
|---|---|---|
| `--accent` | `#7C3AED` | `#9D6BFF` (lifted for dark-canvas contrast) |
| `--bg` (canvas) | `#FFFFFF` | `#1B1D21` |
| `--fg` | `#1A1C1F` | `#E7E8EA` |
| `--grey` | `#8A8F98` | `#8A8F98` |
| `--hair` | `#ECECEC` | `#2C2F35` |
| `--sb-grad-0` | `#5729A3` | `#2E1257` |
| `--sb-grad-1` | `#4D2EB8` | `#381A6B` |
| `--sb-grad-2` | `#85299E` | `#571A66` |
| `--sb-text` | `rgba(255,255,255,.92)` | `rgba(255,255,255,.90)` |
| `--sb-text-dim` | `rgba(255,255,255,.75)`¹ | `rgba(255,255,255,.60)` |
| `--sb-row-active` | `rgba(255,255,255,.22)` | `rgba(255,255,255,.18)` |

¹ The light value was lifted from the original `.62` draft: over the LIGHT
gradient's lower stops (`#4D2EB8`→`#85299E`) white at `.62` computes 3.8–4.3:1
— below the 4.5:1 floor Rules 12/20 require by default (not only under
Increase Contrast, which still bumps it to `.78`). `.75` holds ≥4.5:1 on every
stop. The dark gradient is deep enough that `.60` already passes (5.3–6.4:1).
Dim text inside a glass-selected row additionally promotes to `--sb-text`
(see `.note-row.active .note-age` in `web/styles.css`).
| `--danger` | `#C0392B` | `#FF7B72` |
| `--green` | `#1A7F37` | `#4CC38A` |

Sidebar gradient (matches `Theme.sidebarGradient`):

```css
.sidebar{
  background:linear-gradient(180deg,var(--sb-grad-0),var(--sb-grad-1),var(--sb-grad-2));
  color:var(--sb-text);
  border-right:none; /* the gradient IS the edge; keep a hairline only on the white side if needed */
}
```

Rule: **all** dark-mode styling flows from tokens on `html[data-theme="dark"]`
— the current 90-line per-component override block (`styles.css:749-843`)
is the anti-pattern; new components must not extend it. Add
`<meta name="color-scheme" content="light dark">` to `index.html` and
`color-scheme:light` on `:root` so form controls and overlay scrollbars match.

### 3.3 Glass / vibrancy recipe

Glass belongs to floating chrome only (Rules 1–2): sidebar row selection,
context menus, popovers, the record pill, toasts. Never on the canvas, the
editor, or note cards.

```css
:root{
  --glass-blur: 24px;
  --glass-sat: 170%;
}
/* chrome floating over the purple gradient (sidebar) */
.glass-on-sidebar{
  background: rgba(255,255,255,.14);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,.22);
}
/* chrome floating over the white canvas (menus, popovers, pills) */
.glass-on-canvas{
  background: color-mix(in srgb, var(--bg) 62%, transparent);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,.18),
              0 10px 30px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08);
}
/* Rule 12 — Reduce Transparency fallback (WebKit supports this query) */
@media (prefers-reduced-transparency: reduce){
  .glass-on-sidebar{ background: rgba(255,255,255,.24); backdrop-filter:none; -webkit-backdrop-filter:none; }
  .glass-on-canvas{ background: var(--bg); backdrop-filter:none; -webkit-backdrop-filter:none; }
}
@media (prefers-contrast: more){
  .glass-on-canvas{ box-shadow: inset 0 0 0 1px var(--fg); }
}
```

### 3.4 Traffic-light inset & drag band (native mode)

The shell hides the titlebar and overlays a 60px `WindowDragStrip`
(`main.swift:847-852`). CSS contract:

```css
:root{ --native-inset: 0px; --traffic-w: 78px; --traffic-h: 40px; }
body.native{ --native-inset: 38px; }   /* today 30px (styles.css:63) — too tight for Tahoe buttons */
```

- Keep-out: in `body.native`, no text or interactive control inside the
  top-left `var(--traffic-w) × var(--traffic-h)` box (Rule 8).
- Everything in the top band except controls flagged `data-no-drag` is a drag
  region (the shell's `dragExclusions` channel already implements this —
  `main.swift:699-716`); any new header control **must** set `data-no-drag`.
- Never double-count the inset (documented bug pattern at `styles.css:66-69`):
  only `.content-header`, `.sidebar-top`, `.set-top`, `.compact-inner` own it.

### 3.5 Focus rings

macOS-style ring on every focusable (Rule 14) — replaces today's
`outline:none` with nothing:

```css
:focus-visible{
  outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
  outline-offset: 1px;
}
.editor-title:focus-visible, .editor-body:focus-visible{ outline:none; } /* text canvas: caret is the focus */
.qn-composer:focus-within{ /* keep the existing ring on the pill, tokenized */
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}
```

### 3.6 Scrollbars

Overlay style (Rule 15): thumb invisible at rest, appears while scrolling or
hovering the scroller. The single shared block (`styles.css:104-180`) is the
right shape; change it to rest-transparent:

```css
.scroller::-webkit-scrollbar{ width:8px; }
.scroller::-webkit-scrollbar-thumb{ background:transparent; border-radius:4px; }
.scroller:hover::-webkit-scrollbar-thumb,
.scroller.scrolling::-webkit-scrollbar-thumb{ background:rgba(120,124,132,.35); }
/* sidebar variant over purple: rgba(255,255,255,.35) */
```

### 3.7 Toolbar / header, context menu, popover recipes

**Header (`.content-header`)** — stays hairline-free and content-colored; when
scrolled content passes beneath it, apply a scroll-edge fade instead of a
border:

```css
.content-header{ position:relative; z-index:5; }
.content-header::after{      /* soft scroll edge (Rule 6) */
  content:""; position:absolute; inset:auto 0 -16px 0; height:16px;
  background:linear-gradient(to bottom, var(--bg), transparent);
  opacity:0; transition:opacity .15s;
  pointer-events:none;
}
.content.scrolled .content-header::after{ opacity:1; }
```

**Context menu (`.ctx-menu`)** — glass chrome (Rule 1), concentric radii:

```css
.ctx-menu{
  border-radius: var(--r-panel);          /* 14px */
  padding: 5px;                            /* item radius = 14 − 5 ≈ 9 → --r-control */
  border: 0.5px solid rgba(0,0,0,.10);
  /* + .glass-on-canvas recipe */
}
.ctx-item{ border-radius: var(--r-control); }
.ctx-item:hover{ background: var(--accent); color:#fff; }  /* macOS menus highlight with accent */
```

**Popovers / transcript / approval cards** — `--r-panel`, hairline border,
`.glass-on-canvas` only if they float; inline cards in the flow stay flat
(content layer).

**Motion** — every animation gets a reduced-motion path (Rule 19):

```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{ animation-duration:.01ms!important; transition-duration:.01ms!important; }
  .qn-rec, .rec-pill-dot{ animation:none!important; }
}
```

**Hairlines** — retina hairlines allowed: `border-top:0.5px solid var(--hair)`
(WebKit renders true half-pixel strokes); keep dividers, never boxes, on the
canvas (Rule 16).

### 3.8 Shell (`Sources/PersonalNotesApp/main.swift`)

- `window.backgroundColor` must follow the effective appearance
  (`.windowBackgroundColor`), not fixed `.white` (`main.swift:781`) — dark
  mode currently gets a white backing flash (Rule 11).
- Keep `.fullSizeContentView + titlebarAppearsTransparent + titleVisibility
  = .hidden` (`main.swift:773-779`) — correct hidden-titlebar anatomy.
- If the drag-strip height changes, `--native-inset`, the 60px strip
  (`main.swift:847`), and `.content-header` height must change together —
  they are one contract.

---

## 4. Current violations (ranked)

Adversarial pass over the code as of 2026-07-02. Severity: ★★★ identity/accessibility
break, ★★ native-feel break, ★ polish.

### SwiftUI (`Sources/OpenNotes/`)

1. ★★★ **No Liquid Glass anywhere.** `Theme.glassSurface` (`Theme.swift:41`)
   is never called; the sidebar is a flat gradient and
   `ContentView.swift:47` applies `.ultraThinMaterial.opacity(0.0)` — a
   no-op. The README's core claim ("Liquid Glass on the sidebar,
   `.glassEffect`, interactive") is not implemented. Fix per §2.2.
2. ★★★ **Traffic-light keep-out not reserved.** `.hiddenTitleBar`
   (`OpenNotesApp.swift:16`) + `.ignoresSafeArea(.top)`
   (`ContentView.swift:33`) put the buttons over the sidebar, whose content
   starts at y≈38 (`SidebarView.swift:25` `.padding(.top, 24)` + row padding)
   — under the ≥40pt Tahoe button band; "LIBRARY" can collide and scrolled
   rows slide beneath the buttons with no edge effect. Needs ≥52pt top inset
   + `.scrollEdgeEffectStyle(.soft, for: .top)`.
3. ★★ **No scroll edge effects at all** — `SidebarView.swift:16`,
   `NoteListView.swift:21`: content hard-clips at the top instead of fading
   under chrome (Rule 6).
4. ★★ **Reduce Motion ignored** — unconditional spring at
   `SidebarView.swift:196` (Rule 12).
5. ★★ **Accent fragmentation** — `Theme.swift:7` `#804DE6` vs web `#7C3AED`
   (`web/styles.css:3`) vs badge `#5F55EC` (`web/styles.css:88`); no
   app-level `.tint`, per-view `Theme.accent` at `NoteListView.swift:39,128`
   (Rule 10).
6. ★★ **Fixed content fonts** — `MarkdownStyling.swift:14-16` hard-codes
   14/22/17pt instead of `NSFont.preferredFont(forTextStyle:)` (Rule 9).
7. ★ **SF Rounded everywhere** — all UI labels use `design: .rounded`
   (`ContentView.swift:80`, `SidebarView.swift:213`,
   `NoteListView.swift:73,93,112`, `EditorView.swift:27,61`); keep it only
   for title/header brand moments (Rule 9).
8. ★ **Low-contrast sidebar counts** — `.white.opacity(0.55)`
   (`SidebarView.swift:219`) under 4.5:1 on the magenta gradient stop; no
   Increase Contrast response (Rule 12).
9. ★ **Header new-note button is `.plain`** (`ContentView.swift:77`) — should
   be `.buttonStyle(.glass)` once the header is treated as chrome (Rule 17).
10. ★ **Min-size drift** — `ContentView.swift:32` (900×600) vs shell
    `main.swift:782` (920×640): one constant, two owners.

### Web (`web/` + shell)

1. ★★★ **Sidebar identity mismatch** — the web sidebar is flat grey
   (`--sidebar:#F7F7F8`, `styles.css:10`, applied `styles.css:77-83`), not
   the README's purple Liquid-Glass sidebar; zero `backdrop-filter` anywhere
   in `styles.css`. The two surfaces currently ship different products.
2. ★★★ **No visible keyboard focus** — `outline:none` with no
   `:focus-visible` replacement on `.nav-search input` (`styles.css:202`),
   `.editor-title` (`styles.css:303`), `.editor-body` (`styles.css:308`),
   `.qn-input` (`styles.css:437`), `.chat-input` (`styles.css:568`),
   `.label-create-input` (`styles.css:606`); buttons (`styles.css:34`) have
   no focus style at all — WCAG 2.4.7 failure (Rule 14).
3. ★★ **No `prefers-reduced-motion` handling** — `qnRecPulse`
   (`styles.css:473`), `recDot` (`styles.css:656`), scale transforms
   (`styles.css:447,458`) run unconditionally (Rules 12/19).
4. ★★ **No `prefers-reduced-transparency` / `prefers-contrast` paths** —
   required once glass recipes land (§3.3), absent today (Rule 12).
5. ★★ **Shell window backing hard-coded white** — `main.swift:781`
   `window.backgroundColor = .white` regardless of appearance; dark mode
   resize/launch flashes white (Rule 11).
6. ★★ **Native inset too small** — `--native-inset:30px`
   (`styles.css:63`) under-clears Tahoe's larger traffic lights; no explicit
   left keep-out width is defined anywhere (Rule 8; spec: 38px band +
   78×40 keep-out).
7. ★★ **Dark mode via per-component override list** — `styles.css:749-843`
   re-colors ~40 selectors with fresh hex values instead of retargeting
   tokens; hover/active greys are hard-coded in light mode too
   (`#EFEFF1` at `styles.css:186,198,213`, `#E9E9EC` at `styles.css:213`)
   (Rule 11).
8. ★ **Radii neither concentric nor Tahoe-scaled** — window card 12px
   (`styles.css:47`) vs Tahoe's 26pt; rows 7px, menus 10px, cards 10–12px
   with no inner=outer−inset relationship (Rule 7).
9. ★ **Scrollbar thumb always visible** — `styles.css:163-166` rests at 30%
   opacity instead of overlay-on-scroll (Rule 15).
10. ★ **Context menu is flat** — `.ctx-menu` (`styles.css:697-702`) opaque,
    10px radius, no vibrancy; macOS 26 menus are glass chrome (Rule 1,
    §3.7).
11. ★ **No `<meta name="color-scheme">`** in `web/index.html` head and no
    `color-scheme:light` on `:root` (`styles.css:2`) — UA controls and
    overlay scrollbars can mismatch the theme (Rule 11).
12. ★ **Third brand purple on the badge** — `#5F55EC`
    (`styles.css:88,414`) vs `--accent` (Rule 10).

---

### Change discipline

- Design changes must not alter DOM ids/classes consumed by
  `docs/ui-contracts.md` flows (`window.PersonalNotes.*`, `hasna:*` events,
  drag exclusions, recording pill states).
- Any change to the native inset touches three places at once:
  `styles.css --native-inset`, `main.swift` drag-strip height, and the
  `.content-header` height (see §3.8).
- Verify every visual change in all four modes: light/dark ×
  transparency-on/Reduce-Transparency, plus Reduce Motion and Increase
  Contrast spot checks (Rule 12).
