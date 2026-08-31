# @hasna/slides

[![npm](https://img.shields.io/npm/v/@hasna/slides.svg)](https://www.npmjs.com/package/@hasna/slides)
[![license](https://img.shields.io/npm/l/@hasna/slides.svg)](./LICENSE)

Headless presentation-deck SDK for Hasna-coded apps. Author slides in **Markdown or HTML**, model themes / transitions / fragments / vertical stacks, **serialize to JSON**, and **export a self-contained [reveal.js](https://revealjs.com) HTML deck**. A React viewer is shipped separately at `@hasna/slides/react`.

The local project folder is `slides` (this repository, `hasna/apps`); the published package is `@hasna/slides`.

- **`@hasna/slides`** — the headless, framework-agnostic deck model + serialization + HTML export. No React, safe to run server-side.
- **`@hasna/slides/react`** — a reveal.js-backed `<Presentation>` / `<Deck>` viewer component (arrow-key navigation, overview mode, fragments, speaker notes).

Built on reveal.js `6.0.1` (MIT). This package is MIT-licensed.

## Install

```bash
bun add @hasna/slides
# React viewer peers (only if you use @hasna/slides/react)
bun add react react-dom
```

## Headless SDK

```ts
import { createDeck, exportDeckHtml, serializeDeck } from "@hasna/slides";

const deck = createDeck({ title: "Launch", theme: "moon" });

const intro = deck.addSlide({ body: "# Launch\n\nA new way to ship" });
deck.setNotes(intro.id, "Open warm, then get to the point.");

deck.addSlide({
  body: "<h2>Highlights</h2>",
  format: "html",
  fragments: ["Fast", "Simple", "Composable"],
});

// A vertical stack (down-arrow navigation)
const detail = deck.addSlide({ body: "## Deep dive" });
deck.addChild(detail.id, { body: "### Architecture" });

// Persist as JSON …
const json = serializeDeck(deck.toJSON());

// … or export a standalone reveal.js HTML file
const html = deck.toHtml();            // CDN-referenced, portable
await Bun.write("launch.html", html);
```

### Author from Markdown

`parseMarkdownDeck` follows the reveal.js Markdown convention:

- `---` on its own line starts a new horizontal slide.
- `--` on its own line starts a vertical sub-slide.
- `Note:` starts speaker notes that run to the end of the slide.

```ts
import { createDeck, parseMarkdownDeck } from "@hasna/slides";

const slides = parseMarkdownDeck(`
# Title

Welcome

Note: smile

---

## Agenda

- one
- two
`);

const deck = createDeck({ title: "Standup", slides });
```

### Self-contained export

By default `exportDeckHtml` references a pinned reveal.js build on jsDelivr, producing a single portable HTML file. Pass an inline asset bundle to produce a fully offline, self-contained file:

```ts
import { exportDeckHtml } from "@hasna/slides";
import { readFileSync } from "node:fs";

const req = (p: string) => readFileSync(require.resolve(`reveal.js/${p}`), "utf8");

const html = exportDeckHtml(deck.toJSON(), {
  assets: {
    revealCss: req("dist/reveal.css"),
    themeCss: req("dist/theme/black.css"),
    revealJs: req("dist/reveal.js"),
    markdownJs: req("plugin/markdown/markdown.js"),
    notesJs: req("plugin/notes/notes.js"),
  },
});
```

## React viewer

```tsx
import { Presentation } from "@hasna/slides/react";
import { createDeck, parseMarkdownDeck } from "@hasna/slides";

const deck = createDeck({ slides: parseMarkdownDeck(source) });

export function Preview() {
  return <Presentation deck={deck} theme="black" embedded />;
}
```

The viewer dynamically imports reveal.js inside an effect, so it is safe in
SSR frameworks (nothing reveal-related runs on the server). It provides
arrow-key navigation, overview mode (`O`), fragments, and the speaker-notes
view (`S`) out of the box.

## Dashboard

`dashboard/` is a Vite + React studio that demonstrates the SDK end to end:
author a deck in Markdown with a live reveal.js preview, read per-slide speaker
notes, switch themes, and export a self-contained HTML deck or JSON.

```bash
cd dashboard
bun install
bun run dev
```

## Concepts

| Concept | API |
| --- | --- |
| Create / load a deck | `createDeck`, `loadDeck` |
| Slide CRUD | `deck.addSlide`, `updateSlide`, `removeSlide`, `moveSlide` |
| Vertical stacks | `deck.addChild(parentId, …)` |
| Speaker notes | `deck.setNotes(id, …)` |
| Fragments | `slide.fragments: string[]` |
| Theme / config | `deck.setTheme`, `deck.setConfig` |
| Markdown authoring | `parseMarkdownDeck`, `slidesToMarkdown` |
| Serialize | `serializeDeck`, `deserializeDeck` |
| HTML export | `exportDeckHtml`, `deck.toHtml()` |
| React viewer | `@hasna/slides/react` → `<Presentation>` |

See [`docs/sdk.md`](./docs/sdk.md), [`docs/react.md`](./docs/react.md), and
[`docs/export.md`](./docs/export.md) for details.

## Status

Functional v1: headless deck SDK, Markdown authoring, JSON serialization,
standalone HTML export, and the React reveal.js viewer.

Deferred (optional scaffolding, tracked in `hasna.contract.json`): CLI, MCP
server, HTTP `slides-serve` API, and Postgres persistence.

## License

MIT © Hasna. reveal.js is © Hakim El Hattab and contributors, MIT.
