# HTML export

`exportDeckHtml(deck, options)` (also `deck.toHtml(options)`) renders a
complete, standalone reveal.js HTML document from a `DeckData`.

## Modes

### CDN (default)

References a pinned reveal.js build on jsDelivr. Produces a single portable
HTML file that needs network access to render.

```ts
const html = exportDeckHtml(deck.toJSON(), { theme: "moon" });
```

### Inline (self-contained)

Pass an `assets` bundle to inline every stylesheet and script, producing a
fully offline, self-contained file.

```ts
import { readFileSync } from "node:fs";
const req = (p: string) => readFileSync(require.resolve(`reveal.js/${p}`), "utf8");

const html = exportDeckHtml(deck.toJSON(), {
  assets: {
    revealCss: req("dist/reveal.css"),
    themeCss: req("dist/theme/moon.css"),
    revealJs: req("dist/reveal.js"),
    markdownJs: req("plugin/markdown/markdown.js"),
    notesJs: req("plugin/notes/notes.js"),
    highlightJs: req("plugin/highlight/highlight.js"),
    highlightCss: req("plugin/highlight/monokai.css"),
  },
});
```

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `assets` | `"cdn"` | `"cdn"` or an inline `InlineAssets` bundle. |
| `cdnBase` | pinned jsDelivr | CDN base URL (CDN mode). |
| `revealVersion` | `REVEAL_VERSION` | reveal.js version pin (CDN mode). |
| `theme` | deck theme | Override the theme. |
| `title` | deck title | Override the `<title>`. |
| `lang` | `"en"` | `<html lang>`. |
| `includeMarkdownPlugin` | `true` | Needed for markdown-format slides. |
| `includeNotesPlugin` | `true` | Speaker-notes view. |
| `includeHighlightPlugin` | `true` | Code syntax highlighting. |

## How slides render

- **Markdown slides** become `<section data-markdown><textarea data-template>…</textarea></section>`.
  Fragments are appended as lines with `<!-- .element: class="fragment" -->`,
  and notes are appended as a trailing `Note:` block.
- **HTML slides** emit their body verbatim; fragments become
  `<p class="fragment">…</p>` and notes become `<aside class="notes">…</aside>`.
- **Vertical stacks** (slides with `children`) nest as
  `<section><section>…</section><section>…</section></section>`.
- **Backgrounds**: a color-like value sets `data-background-color`; anything
  else is treated as `data-background-image`.
- Deck `config` is serialized into the `Reveal.initialize(...)` call.

`renderSlidesFragment(slides)` returns just the inner `.slides` markup, which is
what the React viewer injects into its container.
