import type { DeckData, Slide } from "./types.js";
import { REVEAL_VERSION } from "./version.js";

/** Inline (self-contained) asset bundle for {@link exportDeckHtml}. */
export interface InlineAssets {
  /** Contents of reveal.js core CSS (`dist/reveal.css`). */
  revealCss: string;
  /** Contents of the chosen theme CSS (`dist/theme/<theme>.css`). */
  themeCss: string;
  /** Contents of reveal.js (`dist/reveal.js`, the non-module build). */
  revealJs: string;
  /** Optional markdown plugin JS (`plugin/markdown/markdown.js`). */
  markdownJs?: string;
  /** Optional speaker-notes plugin JS (`plugin/notes/notes.js`). */
  notesJs?: string;
  /** Optional syntax-highlight plugin JS (`plugin/highlight/highlight.js`). */
  highlightJs?: string;
  /** Optional syntax-highlight theme CSS. */
  highlightCss?: string;
}

export interface ExportHtmlOptions {
  /**
   * How reveal.js assets are referenced.
   *   - `"cdn"` (default): reference a pinned jsDelivr CDN. Produces a single
   *     portable HTML file that needs network access to render.
   *   - an {@link InlineAssets} object: inline every asset string, producing a
   *     truly self-contained, offline HTML file.
   */
  assets?: "cdn" | InlineAssets;
  /** CDN base URL (CDN mode only). */
  cdnBase?: string;
  /** reveal.js version to pin on the CDN (CDN mode only). */
  revealVersion?: string;
  /** Override the deck theme. */
  theme?: string;
  /** Override the document `<title>`. */
  title?: string;
  /** `<html lang>` value. Defaults to `"en"`. */
  lang?: string;
  /** Include the markdown plugin. Defaults to `true`. */
  includeMarkdownPlugin?: boolean;
  /** Include the speaker-notes plugin. Defaults to `true`. */
  includeNotesPlugin?: boolean;
  /** Include the syntax-highlight plugin. Defaults to `true`. */
  includeHighlightPlugin?: boolean;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]!);
}

/** Guard raw markdown that is embedded inside a `<textarea>`. */
function escapeForTextarea(value: string): string {
  return value.replace(/<\/textarea/gi, "&lt;/textarea");
}

const CSS_COLOR_KEYWORDS = new Set([
  "transparent",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "gray",
  "grey",
  "silver",
  "navy",
  "teal",
  "maroon",
  "olive",
  "lime",
  "aqua",
  "fuchsia",
]);

/** Heuristic: does a background value describe a CSS color vs an image URL? */
export function looksLikeColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return true;
  if (/^(rgb|rgba|hsl|hsla)\(/.test(v)) return true;
  if (CSS_COLOR_KEYWORDS.has(v)) return true;
  return false;
}

/** Build the `data-*`/attribute map for a slide's `<section>` element. */
function sectionAttributes(slide: Slide, markdown: boolean): string {
  const attrs: Record<string, string> = {};
  if (markdown) attrs["data-markdown"] = "";
  if (slide.transition) attrs["data-transition"] = slide.transition;
  if (slide.autoAnimate) attrs["data-auto-animate"] = "";
  if (slide.background) {
    if (looksLikeColor(slide.background)) {
      attrs["data-background-color"] = slide.background;
    } else {
      attrs["data-background-image"] = slide.background;
    }
  }
  for (const [key, val] of Object.entries(slide.attributes ?? {})) {
    attrs[key] = val;
  }
  const rendered = Object.entries(attrs)
    .map(([k, v]) => (v === "" ? k : `${k}="${escapeAttr(v)}"`))
    .join(" ");
  return rendered ? ` ${rendered}` : "";
}

/** Render one leaf slide to a `<section>...</section>` string. */
function renderLeaf(slide: Slide): string {
  const isMarkdown = slide.format === "markdown";
  const attrs = sectionAttributes(slide, isMarkdown);

  if (isMarkdown) {
    let md = slide.body;
    for (const fragment of slide.fragments ?? []) {
      md += `\n\n${fragment}\n<!-- .element: class="fragment" -->`;
    }
    if (slide.notes) {
      md += `\n\nNote:\n${slide.notes}`;
    }
    const inner = `<textarea data-template>\n${escapeForTextarea(md)}\n</textarea>`;
    return `<section${attrs}>${inner}</section>`;
  }

  // HTML-format slide: body is inserted verbatim.
  const parts: string[] = [slide.body];
  for (const fragment of slide.fragments ?? []) {
    parts.push(`<p class="fragment">${fragment}</p>`);
  }
  if (slide.notes) {
    parts.push(`<aside class="notes">${escapeText(slide.notes)}</aside>`);
  }
  return `<section${attrs}>\n${parts.join("\n")}\n</section>`;
}

/** Render one top-level slide (a leaf, or a vertical stack if it has children). */
function renderNode(slide: Slide): string {
  if (!slide.children || slide.children.length === 0) {
    return renderLeaf(slide);
  }
  const inner = [slide, ...slide.children]
    .map((s) => renderLeaf({ ...s, children: undefined }))
    .join("\n");
  return `<section>\n${inner}\n</section>`;
}

/**
 * Render just the inner `.slides` markup for a deck (the sequence of
 * `<section>` elements). Used by the React viewer to populate its container.
 */
export function renderSlidesFragment(slides: Slide[]): string {
  return slides.map(renderNode).join("\n");
}

function buildPluginList(opts: {
  markdown: boolean;
  highlight: boolean;
  notes: boolean;
}): string[] {
  const list: string[] = [];
  if (opts.markdown) list.push("RevealMarkdown");
  if (opts.highlight) list.push("RevealHighlight");
  if (opts.notes) list.push("RevealNotes");
  return list;
}

/**
 * Export a deck to a complete, standalone reveal.js HTML document.
 *
 * In the default `"cdn"` mode the document references a pinned reveal.js build
 * on jsDelivr. Pass an {@link InlineAssets} bundle to inline every asset and
 * produce a fully offline, self-contained file.
 */
export function exportDeckHtml(deck: DeckData, options: ExportHtmlOptions = {}): string {
  const theme = options.theme ?? deck.theme ?? "black";
  const title = options.title ?? deck.title ?? "Presentation";
  const lang = options.lang ?? "en";
  const includeMarkdown = options.includeMarkdownPlugin ?? true;
  const includeNotes = options.includeNotesPlugin ?? true;
  const includeHighlight = options.includeHighlightPlugin ?? true;

  const slidesHtml = renderSlidesFragment(deck.slides);
  const plugins = buildPluginList({
    markdown: includeMarkdown,
    highlight: includeHighlight,
    notes: includeNotes,
  });

  const config = { ...deck.config };
  const configJson = JSON.stringify(config);
  const initScript =
    `Reveal.initialize(Object.assign(${configJson}, ` +
    `{ plugins: [${plugins.join(", ")}] }));`;

  const inline = options.assets && options.assets !== "cdn" ? options.assets : null;

  let headAssets: string;
  let bodyScripts: string;

  if (inline) {
    const styleBlocks = [
      `<style>${inline.revealCss}</style>`,
      `<style>${inline.themeCss}</style>`,
    ];
    if (includeHighlight && inline.highlightCss) {
      styleBlocks.push(`<style>${inline.highlightCss}</style>`);
    }
    headAssets = styleBlocks.join("\n    ");

    const scriptBlocks = [`<script>${inline.revealJs}</script>`];
    if (includeMarkdown && inline.markdownJs) {
      scriptBlocks.push(`<script>${inline.markdownJs}</script>`);
    }
    if (includeHighlight && inline.highlightJs) {
      scriptBlocks.push(`<script>${inline.highlightJs}</script>`);
    }
    if (includeNotes && inline.notesJs) {
      scriptBlocks.push(`<script>${inline.notesJs}</script>`);
    }
    scriptBlocks.push(`<script>${initScript}</script>`);
    bodyScripts = scriptBlocks.join("\n    ");
  } else {
    const version = options.revealVersion ?? REVEAL_VERSION;
    const cdnBase = options.cdnBase ?? `https://cdn.jsdelivr.net/npm/reveal.js@${version}`;
    const styleBlocks = [
      `<link rel="stylesheet" href="${cdnBase}/dist/reveal.css">`,
      `<link rel="stylesheet" href="${cdnBase}/dist/theme/${escapeAttr(theme)}.css">`,
    ];
    if (includeHighlight) {
      styleBlocks.push(
        `<link rel="stylesheet" href="${cdnBase}/plugin/highlight/monokai.css">`,
      );
    }
    headAssets = styleBlocks.join("\n    ");

    const scriptBlocks = [`<script src="${cdnBase}/dist/reveal.js"></script>`];
    if (includeMarkdown) {
      scriptBlocks.push(`<script src="${cdnBase}/plugin/markdown/markdown.js"></script>`);
    }
    if (includeHighlight) {
      scriptBlocks.push(`<script src="${cdnBase}/plugin/highlight/highlight.js"></script>`);
    }
    if (includeNotes) {
      scriptBlocks.push(`<script src="${cdnBase}/plugin/notes/notes.js"></script>`);
    }
    scriptBlocks.push(`<script>${initScript}</script>`);
    bodyScripts = scriptBlocks.join("\n    ");
  }

  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeText(title)}</title>
    ${headAssets}
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
${slidesHtml}
      </div>
    </div>
    ${bodyScripts}
  </body>
</html>
`;
}
