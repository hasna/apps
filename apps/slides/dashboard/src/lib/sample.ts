/**
 * A generic sample deck (reveal.js Markdown convention) used to seed the
 * studio. Intentionally about the SDK itself — no real-world / personal data.
 */
export const SAMPLE_MARKDOWN = `# @hasna/slides

A headless deck SDK
<!-- .element: class="fragment" -->

Note: Welcome. This deck is authored in Markdown and rendered by reveal.js.

---

## Author in Markdown

- Split slides with \`---\`
- Split vertical stacks with \`--\`
- Add speaker notes with \`Note:\`

Note: Everything you see is derived from a serializable deck model.

---

## Fragments

Reveal one line at a time

Press the arrow keys
<!-- .element: class="fragment" -->

Press \`O\` for overview
<!-- .element: class="fragment" -->

---

## Vertical stacks

Use the down arrow

--

### Deeper

Vertical sub-slides live under a parent slide.

--

### Deeper still

Great for optional detail.

---

## Export anywhere

- Serialize to JSON
- Export a self-contained reveal.js HTML deck
- Embed the \`<Presentation>\` React viewer

Note: Use the toolbar to export this deck.
`;
