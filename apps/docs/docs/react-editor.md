# React editor (`@hasna/docs/react`)

A TipTap-powered `<Editor>` component. It shares the headless document model, so its output
round-trips through the `@hasna/docs` SDK with no conversion.

```bash
bun add @hasna/docs react react-dom
```

## `<Editor>`

```tsx
import { Editor } from "@hasna/docs/react";
```

| Prop | Type | Description |
| --- | --- | --- |
| `value` | `DocJSON` | Controlled content (ProseMirror/TipTap JSON). |
| `markdown` | `string` | Initial content from Markdown (when `value` is absent). |
| `html` | `string` | Initial content from HTML (when `value`/`markdown` are absent). |
| `editable` | `boolean` | Defaults to `true`. |
| `showToolbar` | `boolean` | Defaults to `true`. |
| `className` | `string` | Extra class on the wrapper. |
| `onChange` | `(doc: DocJSON) => void` | Fires on every edit with the document JSON. |
| `onUpdate` | `(editor) => void` | Fires with the underlying TipTap editor. |
| `onReady` | `(editor) => void` | Fires once when the editor mounts. |

## Toolbar

`<Toolbar editor={editor} />` renders unstyled buttons for bold, italic, strike, inline
code, headings (H1–H3), bullet/ordered lists, blockquote, code block, link (with an
`unsetLink` prompt), horizontal rule, and undo/redo. Active buttons expose
`data-active="true"` and `aria-pressed`.

## Styling

The component ships **no CSS**. Style these classes yourself:

- `.hasna-docs-editor` — the wrapper
- `.hasna-docs-editor__content` — the ProseMirror surface (`.ProseMirror` inside)
- `.hasna-docs-toolbar`, `.hasna-docs-toolbar__group`, `.hasna-docs-toolbar__button`
  (`[data-active="true"]` for the active state)

See `dashboard/src/index.css` for a complete example theme.

## SSR

`immediatelyRender` is disabled to avoid hydration mismatches in Next.js / SSR frameworks.
Render `<Editor>` inside a client component.

## Demo

The `dashboard/` folder is a Vite + React 19 SPA that wires the editor to live
Markdown/HTML/JSON previews and a document outline, all through the SDK:

```bash
cd dashboard && bun install && bun run dev
```
