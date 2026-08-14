# Glassmorphism Style

Frosted glass, layered depth, and translucency. Glassmorphism creates the illusion of physical glass panels floating over a vivid background.

## Core Principles

1. **Backdrop blur is the core mechanism** — `backdrop-filter: blur(12px)` to `blur(20px)`. Without it, you just have a transparent box, not glass.
2. **Low-opacity background, not transparent** — Glass panels use `background: rgba(255, 255, 255, 0.10)` to `rgba(255, 255, 255, 0.20)`. Too low loses readability; too high loses the glass effect.
3. **Subtle border completes the illusion** — `border: 1px solid rgba(255, 255, 255, 0.20)` on all glass surfaces. This catches the "light" and defines the panel edge.
4. **The background behind glass must be vivid** — Glass over a white background is invisible. The background must be a vibrant gradient, a colorful image, or a rich blurred illustration.
5. **Layered depth through stacking** — Multiple glass panels at different blur/opacity levels create a parallax-like depth hierarchy.

## Typography

- **Colors**: White or near-white (`#F0F4FF`, `rgba(255,255,255,0.95)`) for headings on glass.
- **Body text**: `rgba(255,255,255,0.75)–0.85` for readable secondary text.
- **Weight**: Light (300) or Regular (400) — glass panels feel ethereal; heavy type fights that.
- **Family**: Inter, DM Sans, or any clean humanist sans. The background is busy enough.
- **Avoid**: Dark text on glass panels — it kills the luminous quality.

## Color System

- **Background**: A vivid gradient is mandatory. Examples: `linear-gradient(135deg, #667eea, #764ba2)`, or `linear-gradient(120deg, #f093fb, #f5576c)`, or a photo/illustration.
- **Glass panels**: `background: rgba(255, 255, 255, 0.12)` — tweak per layer; deeper panels can go to 0.18.
- **Accent (for CTAs and active states)**: A saturated color that contrasts with the gradient — use sparingly since the background already provides color.
- **Dark glass variant**: `background: rgba(0, 0, 0, 0.20)` for dark-theme builds; border becomes `rgba(255,255,255,0.10)`.

## Spacing

- **Inside glass cards**: 24–32px padding. Glass panels need room — cramped content breaks the illusion.
- **Between glass cards**: 16–24px gap. They should feel like separate floating panes, not a tight grid.
- **Section padding**: 80–120px — the vivid background should always bleed around glass panels.
- **Max card width**: 400–480px for modals/cards; full-width OK for nav bars.

## Components

- **Glass Card**: `backdrop-filter: blur(16px)`, `background: rgba(255,255,255,0.12)`, `border: 1px solid rgba(255,255,255,0.20)`, `border-radius: 16px`, `box-shadow: 0 8px 32px rgba(0,0,0,0.2)`.
- **Glass Nav**: Fixed top bar, `backdrop-filter: blur(12px)`, slightly higher opacity (`0.15–0.20`), thin bottom border.
- **Glass Modal**: Centered, same glass treatment, stronger shadow to lift it from the background.
- **Glass Button**: Same glass background on hover, border brightens to `rgba(255,255,255,0.40)`.

## Anti-Patterns

1. Opaque backgrounds on "glass" cards — defeats the entire technique
2. Dark harsh borders (`1px solid #333`) — kills the soft glass feel
3. No vivid background behind the glass — glass over white is just a white box
4. `blur(2px)` — too weak to register as frosted glass
5. Too many layers at identical opacity — collapses the depth hierarchy
6. High-contrast dark text on light glass over a colorful bg — illegible and wrong tone
7. Using glassmorphism on every element — reserve it for elevated surfaces (cards, modals, nav)

## DO / DON'T

| DO | DON'T |
|----|-------|
| Vibrant purple-to-pink gradient as base | White or gray background behind glass |
| `backdrop-filter: blur(16px)` | `backdrop-filter: blur(2px)` |
| `rgba(255,255,255,0.15)` glass bg | `rgba(255,255,255,0.85)` (opaque) |
| White text at 0.9 opacity on glass | `color: #333` on a glass panel |
| Thin white-ish border on glass edges | `border: 2px solid #000` |
| Stack 2–3 layers with different blur intensities | One glass layer at identical opacity for everything |
