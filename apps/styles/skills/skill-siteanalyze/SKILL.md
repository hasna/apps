---
name: siteanalyze
description: Analyze a website's design system — detects shadcn, Tailwind, extracts colors/typography/components. Outputs open-styles compatible profiles.
---

# Site Analyze Skill

Deep-analyze any live website to extract its complete design system. Uses Playwright to crawl the page, extract CSS variables and computed styles, detect frameworks (shadcn/ui, Tailwind CSS, Material UI, Bootstrap), and Claude Vision to classify the visual style.

## Usage

```bash
# Full analysis
skill-siteanalyze analyze --url https://example.com

# Quick color + typography only (no AI)
skill-siteanalyze analyze --url https://example.com --quick

# Save as open-styles profile
skill-siteanalyze analyze --url https://example.com --output ./profile.json --format profile

# Take screenshot too
skill-siteanalyze analyze --url https://example.com --screenshot ./screenshot.png
```

## What it detects

- **Frameworks**: shadcn/ui, Tailwind CSS, Material UI, Bootstrap, Chakra UI, Ant Design
- **Colors**: CSS custom properties, computed background/text/border colors, palette
- **Typography**: font families, sizes, weights, line heights
- **Components**: detected shadcn component names from CSS classes/data attributes
- **Style category**: matches against open-styles design profiles

## Environment Variables

- `ANTHROPIC_API_KEY` — for Claude Vision style classification (optional, skipped in --quick mode)

## Output

JSON with full analysis + open-styles compatible profile.
