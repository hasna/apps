# Neubrutalism Style

The contemporary evolution of brutalism. Neubrutalism keeps the raw, structural honesty of brutalism but introduces bold fill colors and flat offset shadows — making it loud, memorable, and surprisingly friendly compared to pure brutalism.

## Core Principles

1. **2–4px solid black borders on everything** — Every interactive element, every card, every input, every button gets a solid black border. This is the non-negotiable foundation.
2. **Flat offset box-shadow** — `box-shadow: 4px 4px 0 #000` (or `6px 6px 0 #000` for larger components). The shadow has NO blur radius. It is flat, hard, and offset diagonally. This creates the illusion of physical depth without gradients.
3. **Bold fill colors, not pastels** — Yellow `#FACC15`, coral `#F87171`, lime `#A3E635`, sky `#38BDF8`, orange `#FB923C`. These are saturated, assertive fills — not muted, not pastel, not corporate.
4. **No or minimal border-radius** — `border-radius: 0` is the default. `4px` is an acceptable concession for readability. `8px+` defeats the aesthetic.
5. **Intentionally loud** — This style should feel like a poster, not an app. If it seems too quiet, add a thicker border or a bolder color.

## Typography

- **Headings**: Space Grotesk, DM Sans, or any clean sans at `font-weight: 800` (Black). Large sizes: 48–80px for hero headings.
- **Body**: Same family at `font-weight: 400` or `500`. 16–18px, `line-height: 1.6`.
- **UI labels**: Medium (500) weight, slightly uppercase for section labels with `0.05em` tracking.
- **Never**: Serif fonts, light weights below 400, decorative or script fonts. Neubrutalism is blunt.

## Color System

**Bold fills are the signature. Every card/button should be a flat block of saturated color with a black border.**

- **Fill palette** (choose 3–4 max): Yellow `#FACC15`, Coral/Red `#F87171`, Lime `#A3E635`, Sky `#38BDF8`, Violet `#C084FC`, Orange `#FB923C`, Mint `#6EE7B7`.
- **Borders and shadow**: Always `#000000` or very dark (`#0F0F0F`). Never colored borders.
- **Background**: White `#FFFFFF` or off-white `#FAFAF9`. The bold fills on top create all the color.
- **Text**: `#000000` on colored backgrounds, `#000000` on white. High contrast is part of the aesthetic.
- **Do not use more than 4 fill colors** in a single design — it becomes chaos, not confident loudness.

## Spacing

- **Generous but structured** — Components need room to let the border and shadow breathe. Card padding: 20–28px.
- **8px base unit** — Standard grid applies. Section vertical padding: 64–80px.
- **Gap between cards**: 24–32px — the shadows need space to not visually collide.
- **Components feel heavy** — This is intentional. Dense, physical, weighty elements signal importance.

## Components

- **Button**: Bold fill color + `border: 3px solid #000` + `box-shadow: 4px 4px 0 #000`. On hover: `transform: translate(-2px, -2px)` + `box-shadow: 6px 6px 0 #000`. On click: `transform: translate(4px, 4px)` + `box-shadow: 0 0 0 #000` (shadow collapses — pressed into surface).
- **Card**: Same border and shadow treatment. Fill with one of the bold palette colors. White text or black text depending on fill luminance.
- **Input**: `border: 2px solid #000`, `border-radius: 0`, `box-shadow: 3px 3px 0 #000`. Focus: shadow color becomes the accent color.
- **Badge/Tag**: Small pill (but 0 radius), bold fill, black border, black text.

## Anti-Patterns

1. `box-shadow` with blur radius — this collapses into regular modern design
2. Any `border-radius` above 4px
3. Subtle or soft shadows — the shadow must be visible and hard
4. Pastel colors — soft sage, dusty rose, or muted teal do not work here; they need the brutalist treatment to land
5. Thin borders (1px) — too delicate for this style
6. Smooth transitions on hover — neubrutalism moves but snaps, not eases
7. Transparent or ghost buttons without the border+shadow treatment
8. White or gray fills — everything should be a bold color statement

## DO / DON'T

| DO | DON'T |
|----|-------|
| `border: 3px solid #000` + `box-shadow: 5px 5px 0 #000` | `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` |
| Yellow `#FACC15` fill on a card | Muted beige or pastel yellow |
| `border-radius: 0` | `border-radius: 12px` |
| Hover: shift transform + extend shadow | Hover: lighten the background color |
| Space Grotesk `font-weight: 800` heading | Thin light-weight heading "for contrast" |
| 3–4 bold fill colors max | 8 different fill colors across components |
