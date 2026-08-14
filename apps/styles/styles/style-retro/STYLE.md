# Retro Style

Pixel-perfect, chunky, and proudly lo-fi. Retro design draws from CRT terminals, 8-bit video games, and early personal computers. Constraints are the aesthetic.

## Core Principles

1. **Pixel-perfect rendering** — Design on a visible grid. Elements snap to 8px increments. Subpixel rendering is the enemy.
2. **8-color maximum palette** — The constraint is the point. Pick a palette with historical precedent: CGA (4 colors), EGA (16), Game Boy (4 greens), CRT amber/green on black.
3. **Monospace everywhere** — Press Start 2P, VT323, or Courier New. Every character in the same cell. Variable-width fonts are a modern luxury that retro rejects.
4. **Chunky 2px+ borders** — Hairline borders do not exist in 8-bit. Minimum 2px, preference for 3–4px solid borders. Double-line borders (`double`) are period-accurate.
5. **Dithering patterns are valid texture** — CSS checkerboard backgrounds (`background-size: 2px 2px`) simulate dithered shading and are a legitimate retro technique.

## Typography

- **Primary**: `Press Start 2P` (Google Fonts) — the canonical pixel font. 8px or 16px only (pixel fonts scale on multiples of their base size).
- **Readable alternative**: `VT323` at 18–24px — more legible for body text, still feels terminal.
- **Monospace fallback**: `Courier New`, `Lucida Console`, `monospace`.
- **Sizes**: 8, 16, 24, 32px for Press Start 2P (strict multiples). VT323: 18, 24, 32, 48px.
- **Never**: Variable fonts, anti-aliased display fonts, anything with optical kerning.
- **Line height**: 2.0 for Press Start 2P (it needs vertical breathing room). 1.5 for VT323.

## Color System

**Choose ONE palette and commit. Do not mix palettes.**

- **CRT Green**: Background `#0D0D0D`, text `#33FF33`, accent `#00FF00`. Pure terminal.
- **CRT Amber**: Background `#1A0D00`, text `#FF8C00`, accent `#FFAA00`. Warm terminal.
- **Classic Mac**: Black `#000000`, white `#FFFFFF`, light gray `#AAAAAA`, dark gray `#555555`. Zero color.
- **CGA High Contrast**: Black + Cyan `#00AAAA` + Magenta `#AA00AA` + White. Garish. Correct.
- **Game Boy**: `#0F380F`, `#306230`, `#8BAC0F`, `#9BBC0F`. Four shades of green only.

## Spacing

- **8px grid, hard snap** — All margins, paddings, widths are multiples of 8. No exceptions.
- **Chunky padding** — Buttons: 8px top/bottom, 16px left/right at minimum. Feels physical.
- **Section spacing**: Regular 32–48px vertical. No generous whitespace — retro is tight.
- **Box model**: Use borders to define space, not margins alone.

## Components

- **Bordered boxes**: `border: 3px solid currentColor`. `border-radius: 0`. Double borders for windows: outer 3px + inner 1px with a gap.
- **Buttons**: Flat fill, 3px border, 0 radius. Pressed state: invert colors (bg becomes text color, text becomes bg color). No transitions — instant swap.
- **Blinking cursor**: `animation: blink 1s step-end infinite` on a `|` character. `opacity: 0` / `opacity: 1` only — no fade.
- **Scanline overlay**: `background: repeating-linear-gradient(transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)` over content.
- **Pixelated icons**: `image-rendering: pixelated` on small PNGs, or CSS-drawn with `box-shadow` as pixel art.

## Anti-Patterns

1. Smooth CSS gradients — use flat color blocks only
2. Modern humanist sans (Inter, Roboto) — monospace only
3. Border-radius above 0px — corners are 90 degrees
4. `transition` or `animation` with easing — only instant or step-based transitions
5. Subtle, muted color palettes — retro is high contrast
6. Anything that looks "sleek" or "polished" — that is the wrong direction
7. `box-shadow` with blur — only solid hard shadows or no shadow
8. SVG icons with smooth curves — pixel or block shapes only

## DO / DON'T

| DO | DON'T |
|----|-------|
| `font-family: 'Press Start 2P'` | `font-family: Inter` |
| `#33FF33` on `#0D0D0D` | Soft green on light gray |
| `border: 3px solid #33FF33` | `border: 1px solid #ccc` |
| Instant color-invert on button press | `transition: background 0.2s ease` |
| Scanline overlay on full page | Subtle background texture |
| Blink animation with `steps()` | Fade-in/fade-out animations |
