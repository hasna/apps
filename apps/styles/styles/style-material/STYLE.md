# Material Design 3 (Material You) Style

Google's design system at its third iteration. Material You moves beyond static themes toward dynamic, user-adaptive color with a principled system of tonal roles, elevation, and motion.

## Core Principles

1. **Material You color system with 5 tonal roles** — Primary, Secondary, Tertiary, Error, and Neutral. Each role has a base color, a container color, and an on-color (for text/icons atop them). Derive all UI color from these roles — never use ad-hoc hex values.
2. **Elevation via surface tint, not shadow** — In M3, elevated surfaces get a tint of the primary color applied to the surface. Use `box-shadow` for elevation level but add a matching `background-color` tint. Shadow alone is M2; tinted surface is M3.
3. **Motion follows standard easing curves** — M3 defines Emphasized (`cubic-bezier(0.2, 0, 0, 1.0)`), Standard (`cubic-bezier(0.2, 0, 0, 1.0)` entering, `cubic-bezier(0.3, 0, 1, 1)` exiting), and Decelerate curves. Never use `ease` or `linear` generically.
4. **Accessible contrast ratios are designed in** — On-Primary over Primary must meet 4.5:1. All text/icon combinations follow the role hierarchy to ensure this automatically when the palette is generated correctly.
5. **Components follow the spec exactly** — M3 components have defined heights, padding, states (enabled, hovered, focused, pressed, dragged, disabled), and interaction states. Deviate only with strong reason.

## Typography

- **Family**: Roboto or Google Sans (for Google products). For third-party use, any clean sans-serif at the right scale.
- **M3 Type Scale**:
  - Display: Large 57px, Medium 45px, Small 36px — for hero moments only
  - Headline: Large 32px, Medium 28px, Small 24px — page/section titles
  - Title: Large 22px, Medium 16px (medium weight), Small 14px (medium weight) — card headers, list items
  - Body: Large 16px, Medium 14px, Small 12px — prose content
  - Label: Large 14px (medium), Medium 12px (medium), Small 11px (medium) — buttons, tabs, chips
- **Do not invent intermediate sizes** — use the defined scale tokens.

## Color System

**Generate a palette using Material Theme Builder or the M3 color tool, then map to these roles:**

- **Primary**: Main brand color. Used for key components: FAB, selected state, primary button fill.
- **On Primary**: Text/icons on primary-colored surfaces.
- **Primary Container**: A lighter/softer version for container backgrounds (chips, badge bg).
- **On Primary Container**: Text/icons inside primary containers.
- **Secondary / Tertiary**: Supporting accent roles. Secondary for less prominent UI; Tertiary for contrasting accents (e.g., a color-coded label in a different hue).
- **Surface tones**: Surface → Surface Variant → Surface Container → Surface Container High — used in sequence for elevation levels 0–4.
- **Error**: `#B3261E` (base M3 error red). Never repurpose for non-error states.

## Spacing

- **4px base unit** (not 8px — M3 uses finer granularity).
- Standard component heights: Button 40px, FAB 56px, Extended FAB 56px, List item 56px (one-line) / 72px (two-line), AppBar 64px.
- Internal padding: Use spec-defined values. Button: 24px horizontal. List item: 16px horizontal.

## Components

- **Filled Button**: Primary bg, On-Primary text, 20px radius (full pill), 40px height.
- **Outlined Button**: Transparent bg, Outline color border, Primary text, same radius.
- **Text Button**: No bg, no border, Primary text.
- **Cards**: Elevated (Surface + shadow level 1 + tint), Filled (Surface Variant bg), Outlined (Surface bg + outline border). `border-radius: 12px`.
- **FAB**: `border-radius: 16px` (regular) or `28px` (large). Primary Container bg, On Primary Container icon.
- **Chips**: `border-radius: 8px`, height 32px. Assist / Filter / Input / Suggestion variants.

## Anti-Patterns

1. Custom shadows that bypass the elevation tint model — breaks the surface depth system
2. Arbitrary colors outside the tonal palette — destroys the adaptive color promise
3. Non-standard border-radius on standard components — M3 uses defined shape tokens
4. Mixing M2 and M3 components (e.g., M2 flat buttons with M3 cards)
5. Using error colors for non-error UI (e.g., red delete buttons that aren't errors)
6. `ease` timing on motion — use M3 standard easing curves
7. Typography sizes not from the type scale

## DO / DON'T

| DO | DON'T |
|----|-------|
| Add primary tint to elevated surface bg | Use shadow alone for elevation |
| Use Primary Container for chips/badges | Use Primary for all colored elements |
| `border-radius: 20px` (full) on buttons | `border-radius: 4px` on M3 buttons |
| Motion with Emphasized easing curve | `transition: all 0.3s ease` |
| 4px base unit for spacing | 8px base unit (that's M2) |
| Generate palette with M3 Theme Builder | Pick hex colors manually |
