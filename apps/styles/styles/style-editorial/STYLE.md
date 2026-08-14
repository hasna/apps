# Editorial Style

Typography-first design that treats text as the primary visual medium. Inspired by print journalism, literary magazines, and long-form publishing. The type IS the layout.

## Core Principles

1. **Type is the design** — There are no decorative elements that text cannot replace. Hierarchy, rhythm, and visual interest come entirely from typographic decisions.
2. **Serif fonts for body — non-negotiable** — Playfair Display, Lora, or Georgia for body text. Serifs aid long-form reading and signal that the content is worth your time.
3. **Pull quotes are structural** — A large pull quote is not decoration; it is a navigational marker and a moment of visual relief in a dense text block.
4. **Generous leading is respect for the reader** — 1.8 line-height for body. 2.0 for caption-width narrow columns. Tight leading is a readability failure.
5. **Asymmetric layouts are encouraged** — A wide text column offset to one side, a large initial cap, a marginal note — these are editorial tools, not design indulgences.

## Typography

- **Headings**: Playfair Display Bold or Merriweather Bold. 36–64px. `letter-spacing: -0.02em` for display sizes.
- **Body**: Lora Regular, 18–20px, `line-height: 1.8`, `color: #1C1917`.
- **Measure (line length)**: 65–75ch. This is not optional. Short lines fragment reading; long lines cause tracking errors.
- **Pull quotes**: 24–32px, Playfair Display Italic, `color: #374151`, left border `4px solid #000`.
- **Captions**: 13px, Georgia or serif fallback, `color: #6B7280`, italic.
- **Drop caps**: First letter 4–5× body size, `float: left`, font-weight 700.

## Color System

- **Text**: Near-black `#1C1917` (warm black, not cold). Warmer than `#111` — editorial text should feel printed, not digital.
- **Background**: Cream `#FFFBF5` or white `#FFFFFF`. Cream is preferred for long reads; it reduces eye strain.
- **Secondary text**: `#57534E` for bylines, captions, dates.
- **Accent (single ink color)**: Deep red `#991B1B`, navy `#1E3A5F`, or forest `#14532D`. Applied to: links, pull quote borders, section rules, byline emphasis. One color only.
- **Dividers**: `border-top: 1px solid #D6D3D1` for section rules. Triple rules (`===`) as section openers in heavier designs.

## Spacing

- **Margins**: Wide. Minimum 20% of viewport width total (10% each side). This is where marginal notes live.
- **Vertical rhythm**: Everything aligns to a 4px baseline grid. `margin-bottom: 1.5rem` after paragraphs.
- **Section breaks**: Use typographic ornaments (`* * *`) or a full-width rule — not cards, not icons.
- **Article max-width**: 720–780px for body text. Wider for image-forward layouts.

## Components

- **Blockquotes**: Large left border (4px, accent color), italic serif, 1.2× body size, 32px left padding.
- **Drop caps**: `::first-letter` pseudo-element, float left, 3–4 lines tall, bold weight.
- **Section rules**: `<hr>` styled as `border-top: 1px solid currentColor; opacity: 0.3`.
- **Byline**: Small caps, condensed spacing, accent color for author name.
- **Image captions**: Italic, small, right-aligned or centered below the image.

## Anti-Patterns

1. UI widget overload — tabs, accordions, modals in editorial content break the reading flow
2. Colorful card grids to present articles — let type do this work
3. Icon sets as visual anchors — editorial design needs no icons
4. Tight leading (`line-height: 1.3`) on body text
5. Sans-serif body copy in a long-form context
6. Centered body text (justified is acceptable; left-aligned preferred)
7. More than one accent color
8. Social share buttons interrupting body text flow

## DO / DON'T

| DO | DON'T |
|----|-------|
| 75ch max line length on body | 100% width text column |
| 1.8 line-height on all body text | `line-height: 1.4` on 18px serif |
| Large pull quote every 4–6 paragraphs | No visual breaks in 2000-word article |
| Cream `#FFFBF5` background | Stark `#FFFFFF` for long-form reading |
| Drop cap on first paragraph | Decorative bullet icons |
| Wide margins for breathing room | Full-bleed text edge to edge |
