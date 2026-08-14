# Neumorphic Style

Soft, extruded surfaces that appear to emerge from or push into the background. Neumorphism creates a tactile, almost physical interface using dual shadows on same-color surfaces.

## Core Principles

1. **Background color equals component color** — The entire neumorphic effect depends on the component and its background being the same color. If they differ, the illusion collapses. Background `#E0E5EC`; every component also starts at `#E0E5EC`.
2. **Dual box-shadow: light upper-left + dark lower-right** — The formula: `box-shadow: -6px -6px 12px rgba(255,255,255,0.8), 6px 6px 12px rgba(0,0,0,0.15)`. Light comes from the top-left; the shadow falls to the bottom-right. This simulates a directional light source over a soft clay surface.
3. **Monochromatic palette** — Vary only lightness, never hue. A single hue (or neutral gray) across all surfaces. The moment you introduce a second hue for a component background, it breaks the continuity.
4. **Tactile and physical feel** — Every element should feel like it can be pressed. Buttons are convex (raised) in default state, concave (inset) when active/pressed. This is the core interaction metaphor.
5. **Subtle color differences only** — The entire palette might span only 10–15% of lightness. The shadows carry all the differentiation.

## Typography

- **Family**: Clean humanist sans — Inter, Nunito, or DM Sans. The softness of neumorphism pairs poorly with harsh or geometric type.
- **Color**: Medium contrast — `#4A5568` or `#2D3748` on a light gray surface. Not `#000000` — too harsh. Not `#888` — too low contrast (accessibility warning below).
- **Weight**: Regular (400) or Medium (500) for body. Semibold (600) for labels. Never Bold (700) — it fights the softness.
- **Size**: Standard — 15–16px body, 13–14px labels, 22–28px headings.

## Color System

**Entire UI is one hue + lightness variations.**

- **Gray example**: Background `#E0E5EC`, component `#E0E5EC`, light shadow `rgba(255,255,255,0.8)`, dark shadow `rgba(163,177,198,0.6)`.
- **Blue-gray example**: Background `#DDE1E7` with blue tint, same component color, same shadow system.
- **Warm gray example**: Background `#EAE6E0`, light shadow `rgba(255,255,255,0.9)`, dark shadow `rgba(166,157,145,0.5)`.
- **Dark neumorphism**: Background `#1E2028`, component same, light shadow `rgba(40,44,55,0.8)`, dark shadow `rgba(0,0,0,0.5)`. Very moody.
- **Accent colors**: Used ONLY for active/selected states — a small colored element (progress bar fill, toggle active state, icon on a pressed button). One accent, used minimally.

## Spacing

- **Generous padding** — Components need room for the shadow to breathe. Button: 14–16px vertical, 24–32px horizontal. Card: 24–32px internal padding.
- **Shadow offset** — Scale with component size. Small button: `4px 4px 8px` offset. Large card: `8px 8px 20px` offset.
- **Spacing between components**: 24–32px minimum. Shadows from adjacent elements can visually collide if spaced too tightly.
- **8px base unit** — Standard grid applies despite the soft aesthetic.

## Components

- **Raised button (default)**: Same bg as parent, dual outset shadows. On hover: shadows intensify slightly.
- **Pressed button (active)**: Inset shadows — `box-shadow: inset -4px -4px 8px rgba(255,255,255,0.8), inset 4px 4px 8px rgba(0,0,0,0.15)`. The element appears to push INTO the surface.
- **Input field**: Inset shadow (always "pressed in") — `box-shadow: inset 4px 4px 8px rgba(0,0,0,0.1), inset -4px -4px 8px rgba(255,255,255,0.8)`. Indicates a "hole" in the surface.
- **Toggle switch**: Track is inset; thumb is raised (outset). Accent color on active state.
- **Slider/knob**: The archetypal neumorphic component — circular knob with outset shadow, track is inset.
- **Cards**: Outset shadows, rounded corners (`border-radius: 16–20px`), no border.

## Accessibility Warning

Neumorphism has a known accessibility problem: the low-contrast nature of same-hue components makes it difficult for users with low vision or in bright environments to distinguish UI elements. **Mitigate this by:**
- Ensuring all text meets WCAG AA (4.5:1 minimum)
- Not relying only on shadow depth to communicate state — add color or icon changes for active/disabled states
- Testing in bright light conditions

## Anti-Patterns

1. High-contrast colors on component backgrounds — destroys the monochromatic illusion
2. Mixing neumorphic components with flat or outlined elements — the effect only works when the entire UI commits
3. Harsh solid borders on neumorphic elements — borders betray the soft, borderless surface metaphor
4. One-directional shadow (standard drop shadow) — must be dual (light + dark) for the effect to read
5. `border-radius: 0` — neumorphism is inherently soft; sharp corners feel wrong
6. Too-dark surfaces — the shadow differential must be perceivable; very dark backgrounds compress the range

## DO / DON'T

| DO | DON'T |
|----|-------|
| Component bg matches parent bg exactly | Different fill color on component |
| Dual shadows: light top-left + dark bottom-right | Single `box-shadow` drop shadow |
| Inset shadow for pressed/input states | Outset shadow on input fields |
| `border-radius: 16px` on cards | `border-radius: 0` |
| One accent color for active states only | Multicolor components |
| Test contrast — warn users if WCAG AA fails | Ignore accessibility issues in favor of aesthetics |
