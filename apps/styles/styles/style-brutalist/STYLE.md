# Brutalist Style

Raw, confrontational, structurally honest. Brutalism rejects the veneer of polish in favor of exposing function. It is not accidental ugliness — it is deliberate refusal of convention.

## Core Principles

1. **Contrast is king** — Black on white, white on black. No half-measures. If text is hard to read, make it bigger, not lighter.
2. **Monospace everywhere** — Code-like fonts signal authenticity and structural honesty. Courier New and IBM Plex Mono are the canon.
3. **Borders as structure** — 3–4px solid black borders define every element. Borders are not decoration; they are the skeleton.
4. **Structural honesty** — The UI should look like it knows it is software. No fake materials, no depth illusions, no "friendly" affordances.
5. **Broken-grid is allowed** — Overlapping elements, offset layouts, and irregular spacing are expressive tools, not mistakes.

## Typography

- **Primary**: `Courier New`, `IBM Plex Mono`, `Fira Mono`, or `monospace`. Non-negotiable.
- **Headings**: Oversized. 48–96px is normal. `font-weight: 700` or 900. All-caps optional but effective.
- **Body**: 16–18px monospace. 1.6 line-height. Wide measure is fine (80ch+).
- **Labels/UI**: Same monospace. Small-caps or uppercase with `letter-spacing: 0.1em`.
- **No serifs. No humanist sans. Monospace only.**

## Color System

- **Primary palette**: Black (`#000000`) + White (`#FFFFFF`). These cover 80% of the design.
- **ONE brutal accent**: Choose one — `#FF0000` (red), `#FFE600` (yellow), `#39FF14` (lime), `#FF6B00` (orange). Use for hover states, highlighted text, or a single CTA.
- **No gradients. No tints. No rgba transparency tricks.**
- **If you use a background color**, it should be a flat, full-saturation block. Never muted.

## Spacing

- **Irregular is intentional** — Section padding can be 80px then 20px. Discomfort is a design choice.
- **Base unit**: Still 8px for internal component spacing, but sections break the rule.
- **Overlapping**: Elements may overlap by 20–40px for visual tension.
- **Generous internal padding** for text blocks: 24–40px. Elements should feel like they have room to breathe even if the layout does not.

## Components

- **Cards**: `border: 3px solid #000`. No border-radius. Offset `box-shadow: 4px 4px 0 #000` (solid color shadow, not blurred).
- **Buttons**: `border: 3px solid #000`. Flat fill (accent or white). On hover: invert or shift the offset shadow.
- **Inputs**: `border: 3px solid #000`. Full-width preferred. No floating labels, no rounded corners.
- **Nav**: Top bar with thick bottom border, or a sidebar with a thick right border. No subtle hairlines.

## Anti-Patterns

1. Any `border-radius` above 0px (2px max as a concession)
2. `box-shadow` with blur — solid offset only
3. Gradients on any surface
4. Soft neutral palette — gray-on-gray is the enemy
5. Humanist sans-serif fonts (Helvetica, Inter, etc.)
6. Hover animations with easing — snap changes only
7. "Nice" accent colors (muted blue, sage green, dusty rose)
8. Icons replacing text labels

## DO / DON'T

| DO | DON'T |
|----|-------|
| `border: 3px solid #000` everywhere | `border: 1px solid #E5E7EB` |
| `box-shadow: 5px 5px 0 #000` | `box-shadow: 0 4px 16px rgba(0,0,0,0.1)` |
| 96px uppercase heading | Tasteful 32px heading |
| Full-saturation red for one CTA | Muted coral as "accent" |
| Mono font for everything | Inter body with mono code blocks |
| Overlap elements for tension | Safe, grid-locked layout |
