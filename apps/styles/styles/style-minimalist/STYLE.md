# Minimalist Style

A design philosophy rooted in reduction. Every element earns its place or gets cut.

## Core Principles

1. **Whitespace is structure** — Negative space does the layout work. Crowding is a failure of design, not a sign of thoroughness.
2. **One accent, full stop** — Pick one non-neutral color and use it sparingly for the single most important interactive element per view.
3. **Typography carries the weight** — Without decoration, type must communicate hierarchy, mood, and rhythm entirely on its own.
4. **Ruthless removal** — If removing an element doesn't break comprehension, remove it. Default to less.
5. **Grid discipline** — All spacing derives from an 8px base unit. Nothing floats freely.

## Typography

- **Families**: Geist, Inter, or system-ui. No decorative fonts.
- **Scale**: 12 / 14 / 16 / 20 / 24 / 32 / 48px. Skip steps for contrast.
- **Weights**: Regular (400) for body, Medium (500) for UI labels, Semibold (600) for headings only.
- **Tracking**: Slightly loose (`0.01em`) on body. `0.05–0.1em` on uppercase labels. Never tight on body text.
- **Line height**: 1.5 body, 1.2 headings. No tighter.

## Color System

- **Background**: True white (`#FFFFFF`) or near-white (`#FAFAFA`).
- **Text**: `#111111` for primary, `#6B7280` for secondary, `#9CA3AF` for disabled/placeholder.
- **Neutrals**: A 5-step gray scale (`#F3F4F6` → `#E5E7EB` → `#D1D5DB` → `#9CA3AF` → `#6B7280`).
- **Accent**: ONE color. Use it for primary CTA, active states, and focus rings only. Suggested: `#2563EB` (blue) or `#18181B` (near-black for ultra-minimal).
- **No gradients. No multi-color schemes.**

## Spacing

Base unit: **8px**. All margins, paddings, and gaps must be multiples: 4, 8, 16, 24, 32, 48, 64, 96px.

Section padding: minimum 64px vertical. Component internal padding: 16–24px.

## Components

- **Borders**: 1px solid, neutral-200 (`#E5E7EB`). Never thicker.
- **Radius**: 4px or 0px. Not 8px, not 12px.
- **Shadows**: None, or a single `0 1px 3px rgba(0,0,0,0.08)`. No layered shadows.
- **Buttons**: Flat filled (accent bg + white text) or ghost (1px border + accent text). No gradients, no glows.
- **Icons**: 16px or 20px, stroke-based, 1.5px stroke weight.

## Anti-Patterns

1. Using more than one accent color
2. Adding decorative dividers between every section
3. Gradient backgrounds or gradient text
4. Card shadows heavier than `0 2px 8px rgba(0,0,0,0.1)`
5. Mixing font families (even for "contrast")
6. Rounded corners above 6px
7. Colored backgrounds on sections (stick to white/off-white)
8. Icon + label + badge + tooltip all at once — pick the minimum

## DO / DON'T

| DO | DON'T |
|----|-------|
| Use a 64px gap between page sections | Stack sections 24px apart |
| One CTA per screen region | Three buttons competing for attention |
| `font-weight: 400` for body copy | Bold everything to add "emphasis" |
| Let a single line of text stand alone | Add a subtitle to every heading |
| `border: 1px solid #E5E7EB` on cards | `box-shadow: 0 8px 32px rgba(0,0,0,0.2)` |
| Remove the icon if the label is clear | Add icons "for visual interest" |
