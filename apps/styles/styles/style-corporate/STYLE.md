# Corporate Style

Trustworthy, structured, and professionally inoffensive. Corporate design optimizes for institutional confidence — users must feel that they are in safe, competent hands.

## Core Principles

1. **Trust through consistency** — Every interaction should feel predictable. No surprises. No delight moments. Reliability is the feature.
2. **Blue signals authority** — Navy and blue-gray are the default primary palette. They communicate stability, intelligence, and professionalism across cultures.
3. **Strict visual hierarchy** — Clear H1 → H2 → H3 → body progression. Users should never wonder what to read next.
4. **WCAG AA as a floor** — 4.5:1 for normal text, 3:1 for large text. This is a legal and ethical requirement, not optional.
5. **Professional means conservative** — Every bold visual choice is a risk. Default to the safer option.

## Typography

- **Family**: Inter, system-ui, or Segoe UI. Never a display or decorative font.
- **Headings**: 24 / 28 / 32 / 40px. Semibold (600) maximum. Never heavy/black weight.
- **Body**: 15–16px, Regular (400), `#374151` (not pure black — too harsh for long reads).
- **Labels**: 13–14px, Medium (500), uppercase with `0.05em` tracking for section labels.
- **Never**: Script fonts, display serifs, or anything that reads as "playful."

## Color System

- **Primary**: Navy `#1E3A5F` or corporate blue `#1D4ED8`. Used for primary buttons, active nav, links.
- **Background**: `#FFFFFF` primary, `#F8FAFC` for alternate section backgrounds.
- **Neutral**: Gray scale — `#F1F5F9`, `#E2E8F0`, `#94A3B8`, `#475569`, `#1E293B`.
- **Status colors**: Success `#16A34A`, Warning `#D97706`, Error `#DC2626`. Use only for status indicators — never decoratively.
- **Accent (optional)**: A single lighter blue (`#3B82F6`) for hover states or highlights. No second accent.

## Spacing

- **8px base unit**. Section vertical padding: 64–96px. Never cramped.
- **Content max-width**: 1200px container. Text columns: 720px max for readability.
- **Table cells**: 12px vertical, 16px horizontal minimum. Tables are common in corporate UIs — treat them well.
- **Form spacing**: 24px between fields. Label above input always (never placeholder-as-label).

## Components

- **Cards**: `border-radius: 8px`, `box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)`. Subtle, not decorative.
- **Primary Button**: Blue fill, white text, 8px radius, 40–44px height (touch-friendly).
- **Secondary Button**: White bg, blue border (1.5px), blue text.
- **Tables**: Alternating row shading (`#F8FAFC`), sticky headers on scroll, clear sort indicators.
- **Nav**: Top bar with logo left, nav center/right. Active state is blue underline or blue text, not a box.

## Anti-Patterns

1. Bright or saturated accent colors (orange, purple, lime)
2. Full-page hero gradients
3. Experimental or asymmetric layouts
4. Playful micro-animations
5. Rounded corners above 12px
6. Colored section backgrounds beyond off-white
7. Display or decorative fonts for any UI text
8. Visual risks that prioritize expression over legibility

## DO / DON'T

| DO | DON'T |
|----|-------|
| Blue primary button, white text | Orange CTA "for energy" |
| Subtle card shadow | Glowing card with colored border |
| Consistent 8px radius throughout | Mixed radius (some 4px, some 20px) |
| 16px body text, 1.6 line-height | 13px dense body text |
| WCAG AA contrast on all text | Light gray text on white background |
| Sticky nav with logo + clear links | Hamburger menu on desktop |
