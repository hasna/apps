# @hasna/docs

[![npm](https://img.shields.io/npm/v/@hasna/docs.svg)](https://www.npmjs.com/package/@hasna/docs)
[![license](https://img.shields.io/npm/l/@hasna/docs.svg)](./LICENSE)

Headless rich-text **document SDK** built on the [ProseMirror](https://prosemirror.net) /
[TipTap](https://tiptap.dev) document model, plus a ready-to-drop-in TipTap-based React
`<Editor>`.

- **Headless core (`@hasna/docs`)** — framework-agnostic and dependency-free. Runs anywhere
  (Node, Bun, edge, browser) with no DOM. Create and edit documents, import/export
  **Markdown**, **HTML**, and **JSON**, and extract outlines + word counts.
- **React editor (`@hasna/docs/react`)** — a TipTap-powered `<Editor>` with a formatting
  toolbar (bold/italic/strike/code, headings, lists, links, blockquote, code block,
  undo/redo). It emits and accepts the *same* JSON the headless SDK reads.
- **CLI (`docs`)** — convert document files between Markdown/HTML/JSON/text and print
  outlines and statistics.

The document JSON is shape-compatible with ProseMirror/TipTap, so anything the editor
produces round-trips through the SDK unchanged.

## Install

```bash
bun add @hasna/docs        # or: npm i @hasna/docs
bun install -g @hasna/docs # for the `docs` CLI
```

React is an optional peer dependency; install it only if you use `@hasna/docs/react`:

```bash
bun add react react-dom
```

Installing this library creates no application directories in HOME or XDG roots.
The CLI reads only the input file you supply and writes its results to stdout.

## Headless SDK

```ts
import { Document, createDocument, heading, paragraph, text } from "@hasna/docs";

// Build a document programmatically
const doc = createDocument()
  .setContent([heading(1, [text("Release notes")])])
  .append(paragraph([text("Ships today.")]));

doc.toMarkdown(); // "# Release notes\n\nShips today.\n"
doc.toHTML();     // "<h1>Release notes</h1>\n<p>Ships today.</p>"
doc.outline();    // [{ level: 1, text: "Release notes", index: 0, id: "release-notes" }]
doc.stats();      // { words, characters, readingTimeMinutes, ... }

// Import from Markdown or HTML
const fromMd = Document.fromMarkdown("# Hi\n\n- a\n- b");
const fromHtml = Document.fromHTML("<h1>Hi</h1><ul><li>a</li></ul>");

// Load / validate existing ProseMirror-TipTap JSON
const loaded = Document.fromJSON(fromMd.toJSON());
```

Functional helpers are exported too (`toMarkdown`, `fromMarkdown`, `toHTML`, `fromHTML`,
`getOutline`, `countWords`, `applyStep`, node builders, …). See
[docs/sdk.md](./docs/sdk.md).

### Programmatic edits (steps)

```ts
import { applyStep, appendParagraph } from "@hasna/docs";

const next = applyStep(doc.toJSON(), {
  type: "insertNode",
  index: 0,
  node: { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Intro" }] },
});
```

Steps are a small, serializable JSON model — easy to log, queue, and replay server-side.

## React editor

```tsx
import { useState } from "react";
import { Editor } from "@hasna/docs/react";
import { toMarkdown } from "@hasna/docs";
import type { DocJSON } from "@hasna/docs";

export function MyEditor() {
  const [doc, setDoc] = useState<DocJSON>();
  return (
    <>
      <Editor markdown="# Start typing" onChange={setDoc} />
      <button onClick={() => console.log(doc && toMarkdown(doc))}>Export</button>
    </>
  );
}
```

The component ships no CSS of its own — it renders semantic classes
(`hasna-docs-editor`, `hasna-docs-toolbar`, `hasna-docs-toolbar__button[data-active]`) you
style yourself. See [docs/react-editor.md](./docs/react-editor.md) and the `dashboard/` demo.

## CLI

```bash
docs convert notes.md --to html     # Markdown/HTML/JSON -> md | html | json | text
docs outline notes.md               # print the heading outline
docs stats notes.md                 # word / character / reading-time stats
```

## Development

Release packing requires npm >=11 (tested with 11.19.0); older npm versions can run
`prepare` even with `--ignore-scripts`. `prepack` builds before scanning the
actual npm archive. When invoking `scan:artifact` directly, run `bun run build`
first. The scanner disables lifecycle recursion and overrides inherited dry-run
configuration so the checked archive always exists.

```bash
bun install
bun test          # unit tests
bun run typecheck # tsc --noEmit
bun run build     # library + react + cli + type declarations
cd dashboard && bun install && bun run dev   # live editor demo
```

## License

[MIT](./LICENSE) © Hasna. Built on TipTap and ProseMirror (both MIT).
