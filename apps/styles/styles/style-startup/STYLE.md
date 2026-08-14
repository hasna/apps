# Startup Style

High-energy, conversion-optimized, and gradient-forward. Startup design is marketing design — every pixel serves the goal of turning a visitor into a user.

## Core Principles

1. **The hero is a sales pitch** — Above the fold must contain: a bold claim, a sub-explanation, and one CTA. Everything else is secondary.
2. **Purple-to-indigo is the canonical gradient** — `linear-gradient(135deg, #7C3AED, #4F46E5)` reads as "modern tech startup" globally. Own it or consciously diverge.
3. **Social proof at every scroll depth** — Logos, testimonials, user counts, and star ratings should appear every 2–3 sections. Skepticism compounds with scrolling.
4. **Urgency in CTAs** — "Start for free" beats "Learn more." "Get started" beats "Explore." Action verbs, present tense, no friction words.
5. **Modern sans, big and loud** — Headlines at 56–80px on desktop. Text is not for reading first — it is for grabbing attention.

## Typography

- **Headings**: Cal Sans, Plus Jakarta Sans, or Sora. Fallback: `font-weight: 800` on Inter.
- **Hero heading**: 56–80px, `font-weight: 800`, gradient text effect using `background-clip: text`.
- **Body**: Inter or system-ui, 17–18px, `#4B5563`, 1.7 line-height. Readable but not the focus.
- **CTA text**: 16–18px, bold (700), all-caps optional for secondary CTAs.
- **Gradient text**: `background: linear-gradient(90deg, #7C3AED, #06B6D4); -webkit-background-clip: text; color: transparent`.

## Color System

- **Primary gradient**: Purple `#7C3AED` → Indigo `#4F46E5`. Applied to hero bg, gradient text, and primary CTA buttons.
- **Background**: White `#FFFFFF` primary. Dark `#0F0F0F` for hero alternate or dark-mode sections.
- **CTA accent**: Bright yellow `#FBBF24` or electric green `#10B981` for the single "Start now" button. Different from the gradient — creates contrast.
- **Surface**: `#F9FAFB` for feature section backgrounds, `#EEF2FF` (indigo tint) for highlighted cards.
- **Text**: `#111827` headings, `#4B5563` body, `#9CA3AF` captions.

## Spacing

- **Hero section**: 120–160px vertical padding. It needs room to breathe and impress.
- **Feature grids**: 3-column, 24–32px gap, 48px section padding vertical.
- **Section rhythm**: Alternating full-width sections (colored bg) and white sections keeps the page from becoming monotonous.
- **CTA blocks**: 80–96px vertical padding, centered, with a strong heading + one button.

## Components

- **Primary Button**: Gradient fill (`#7C3AED` → `#4F46E5`), white text, 12px radius, 48px height. Hover: slightly lighter gradient + subtle glow `box-shadow: 0 0 20px rgba(124,58,237,0.4)`.
- **Feature Cards**: White bg, `border-radius: 16px`, `box-shadow: 0 4px 24px rgba(0,0,0,0.08)`, colored icon at top.
- **Testimonial Cards**: Light purple bg (`#EEF2FF`), quote in larger type, avatar + name below.
- **Logo strips**: Grayscale logos, low opacity. "Trusted by" text above. Full-width, scrollable on mobile.

## Anti-Patterns

1. Muted or earthy palette — startups must feel alive
2. Wall of text without visual breaks
3. Weak CTA copy ("Click here", "Submit", "Learn more")
4. Serif fonts for body or headings — reads as legacy
5. Single flat-color hero with no gradient or visual interest
6. Burying the pricing/CTA below 3 scrolls
7. Symmetrical, timid layouts — be willing to be bold
8. No social proof — testimonials and logos are mandatory

## DO / DON'T

| DO | DON'T |
|----|-------|
| "Start building for free →" as primary CTA | "Get more information" as CTA |
| Purple-to-indigo gradient on hero | Flat gray hero background |
| 72px bold heading above the fold | 32px modest heading |
| Gradient text on 2–3 key heading words | Gradient text on all headings (overuse) |
| Logo strip with "Trusted by 10,000+ teams" | No social proof on landing page |
| Electric accent color for the buy button | Gradient button for every button |
