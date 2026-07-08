# Headless SDK (`@hasna/docs`)

The default entry point is framework-agnostic and has **no runtime dependencies**. It works
in Node, Bun, edge runtimes, and the browser without a DOM.

## Document model

Documents are plain JSON, shape-compatible with the ProseMirror/TipTap model:

```jsonc
{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Hi" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "bold", "marks": [{ "type": "bold" }] }] }
  ]
}
```

**Nodes:** `doc`, `paragraph`, `text`, `heading`, `bulletList`, `orderedList`, `listItem`,
`blockquote`, `codeBlock`, `horizontalRule`, `hardBreak`, `table`, `tableRow`, `tableHeader`,
`tableCell`.

**Marks:** `bold`, `italic`, `strike`, `code`, `link`.

## `Document`

| Method | Description |
| --- | --- |
| `Document.create({ content? })` | New (optionally seeded) document. |
| `Document.fromJSON(json)` | Validate + load ProseMirror/TipTap JSON. |
| `Document.fromMarkdown(md)` | Parse Markdown. |
| `Document.fromHTML(html)` | Parse HTML. |
| `.toJSON()` / `.toMarkdown()` / `.toHTML()` / `.toText()` | Serialize. |
| `.outline()` | Heading outline (`level`, `text`, `index`, `id`). |
| `.stats()` / `.wordCount()` | Word/character/reading-time statistics. |
| `.apply(step)` / `.applyAll(steps)` | Apply typed edit steps. |
| `.append(node)` / `.prepend(node)` / `.insertText(i, text)` / `.setContent(nodes)` | Convenience edits. |
| `.clone()` | Independent deep copy. |

`createDocument(...)` and `loadDocument(...)` are functional aliases.

## Functional API

Every capability is also exported as a pure function so you can work with plain JSON:

- Serialization — `toMarkdown`, `fromMarkdown`, `toHTML`, `fromHTML`
- Analysis — `getOutline`, `countWords`, `toText`, `nodeText`, `slugify`
- Editing — `applyStep`, `applySteps`, `appendNode`, `prependNode`, `appendParagraph`
- Builders — `text`, `paragraph`, `heading`, `blockquote`, `codeBlock`, `bulletList`,
  `orderedList`, `listItem`, `horizontalRule`, `hardBreak`, `bold`, `italic`, `strike`,
  `code`, `link`
- Validation — `assertValidDoc`, `isValidDoc`, `DocumentValidationError`

## Edit steps

Steps are a compact, serializable discriminated union:

```ts
type Step =
  | { type: "insertNode"; index: number; node: DocNode }
  | { type: "removeNode"; index: number }
  | { type: "replaceNode"; index: number; node: DocNode }
  | { type: "insertText"; index: number; text: string; marks?: Mark[] }
  | { type: "setDoc"; content: DocNode[] };
```

They operate on the document's top-level block list and are pure — each returns a new
document without mutating the input. Because they are plain JSON, they are easy to log,
persist, queue, and replay in a server or agent context.

## Notes on fidelity

- Markdown import/export covers headings, paragraphs, emphasis (bold/italic/strike/code),
  links, blockquotes, fenced code, bullet/ordered lists (including nesting), horizontal
  rules, and GFM tables.
- HTML import/export is DOM-free and covers the same node/mark set (tables included).
- Round-trips are stable (idempotent) for the supported subset.
