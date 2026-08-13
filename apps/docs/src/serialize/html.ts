/**
 * HTML <-> document conversion. Fully headless (no DOM): export walks the doc
 * JSON and emits an HTML string; import uses a small tokenizer that understands
 * the model's supported tag set.
 */
import type { DocJSON, DocNode, HeadingLevel, Mark, MarkType } from "../types/index.js";
import {
  blockquote,
  bulletList,
  codeBlock,
  heading,
  horizontalRule,
  hardBreak,
  listItem,
  orderedList,
  paragraph,
  text,
} from "../model/schema.js";

// ---------------------------------------------------------------------------
// Export: document -> HTML
// ---------------------------------------------------------------------------

const ESCAPE_TEXT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const ESCAPE_ATTR: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => ESCAPE_TEXT[c] ?? c);
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (c) => ESCAPE_ATTR[c] ?? c);
}

// Innermost-last ordering so nesting is deterministic (link outermost).
const MARK_ORDER: MarkType[] = ["link", "bold", "italic", "strike", "code"];

function wrapMarks(inner: string, marks: Mark[]): string {
  const ordered = [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
  );
  let out = inner;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const mark = ordered[i]!;
    switch (mark.type) {
      case "bold":
        out = `<strong>${out}</strong>`;
        break;
      case "italic":
        out = `<em>${out}</em>`;
        break;
      case "strike":
        out = `<s>${out}</s>`;
        break;
      case "code":
        out = `<code>${out}</code>`;
        break;
      case "link": {
        const href = escapeAttr(String(mark.attrs?.href ?? ""));
        const target = mark.attrs?.target
          ? ` target="${escapeAttr(String(mark.attrs.target))}"`
          : "";
        const rel = mark.attrs?.rel ? ` rel="${escapeAttr(String(mark.attrs.rel))}"` : "";
        out = `<a href="${href}"${target}${rel}>${out}</a>`;
        break;
      }
    }
  }
  return out;
}

function inlineToHTML(nodes: DocNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      if (node.type === "text") {
        return wrapMarks(escapeText(node.text ?? ""), node.marks ?? []);
      }
      return inlineToHTML(node.content);
    })
    .join("");
}

function blockToHTML(node: DocNode): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inlineToHTML(node.content)}</p>`;
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `<h${level}>${inlineToHTML(node.content)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${(node.content ?? []).map(blockToHTML).join("")}</blockquote>`;
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
      const raw = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `<pre><code${cls}>${escapeText(raw)}</code></pre>`;
    }
    case "bulletList":
      return `<ul>${(node.content ?? []).map(blockToHTML).join("")}</ul>`;
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      const attr = start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr}>${(node.content ?? []).map(blockToHTML).join("")}</ol>`;
    }
    case "listItem":
      return `<li>${(node.content ?? []).map(blockToHTML).join("")}</li>`;
    case "horizontalRule":
      return "<hr>";
    case "table":
      return `<table><tbody>${(node.content ?? []).map(blockToHTML).join("")}</tbody></table>`;
    case "tableRow":
      return `<tr>${(node.content ?? []).map(blockToHTML).join("")}</tr>`;
    case "tableHeader":
      return `<th>${(node.content ?? []).map(blockToHTML).join("")}</th>`;
    case "tableCell":
      return `<td>${(node.content ?? []).map(blockToHTML).join("")}</td>`;
    default:
      // Fallback: treat unknown block as a paragraph of its inline content.
      return `<p>${inlineToHTML(node.content)}</p>`;
  }
}

/** Serialize a document to an HTML string. */
export function toHTML(doc: DocJSON): string {
  return (doc.content ?? []).map(blockToHTML).join("\n");
}

// ---------------------------------------------------------------------------
// Import: HTML -> document
// ---------------------------------------------------------------------------

interface ElementToken {
  kind: "element";
  name: string;
  attrs: Record<string, string>;
  children: HtmlToken[];
}
interface TextToken {
  kind: "text";
  value: string;
}
type HtmlToken = ElementToken | TextToken;

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "col"]);
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1]!.toLowerCase();
    let val = m[2] ?? "";
    if (val && (val[0] === '"' || val[0] === "'")) val = val.slice(1, -1);
    attrs[key] = decodeEntities(val);
  }
  return attrs;
}

/** Tokenize HTML into a shallow tree. Comments and doctype are dropped. */
function tokenizeHTML(html: string): HtmlToken[] {
  const root: ElementToken = { kind: "element", name: "#root", attrs: {}, children: [] };
  const stack: ElementToken[] = [root];
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!?\/?[a-zA-Z][^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (raw: string) => {
    if (!raw) return;
    stack[stack.length - 1]!.children.push({ kind: "text", value: decodeEntities(raw) });
  };

  while ((m = tagRe.exec(html)) !== null) {
    pushText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const tag = m[0];
    if (tag.startsWith("<!--") || tag.startsWith("<![") || tag.startsWith("<!")) continue;
    const closing = tag[1] === "/";
    if (closing) {
      const name = tag.slice(2, -1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const selfClose = /\/>\s*$/.test(tag);
    const inner = tag.slice(1, selfClose ? -2 : -1);
    const spaceIdx = inner.search(/\s/);
    const name = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();
    const attrs = spaceIdx === -1 ? {} : parseAttrs(inner.slice(spaceIdx + 1));
    const el: ElementToken = { kind: "element", name, attrs, children: [] };
    stack[stack.length - 1]!.children.push(el);
    if (!selfClose && !VOID_TAGS.has(name)) stack.push(el);
  }
  pushText(html.slice(last));
  return root.children;
}

const INLINE_MARK_TAGS: Record<string, MarkType | null> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  s: "strike",
  del: "strike",
  strike: "strike",
  code: "code",
  a: "link",
  span: null,
  u: null,
  mark: null,
};

function collectRawText(tokens: HtmlToken[]): string {
  return tokens
    .map((t) => (t.kind === "text" ? t.value : collectRawText(t.children)))
    .join("");
}

function inlineFromTokens(tokens: HtmlToken[], marks: Mark[]): DocNode[] {
  const out: DocNode[] = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      if (token.value) out.push(text(token.value, marks.length ? marks : undefined));
      continue;
    }
    if (token.name === "br") {
      out.push(hardBreak());
      continue;
    }
    const markType = INLINE_MARK_TAGS[token.name];
    if (markType === undefined) {
      // Unknown inline element: descend, keeping current marks.
      out.push(...inlineFromTokens(token.children, marks));
      continue;
    }
    let nextMarks = marks;
    if (markType) {
      const mark: Mark =
        markType === "link"
          ? { type: "link", attrs: { href: token.attrs.href ?? "" } }
          : { type: markType };
      nextMarks = [...marks.filter((mk) => mk.type !== markType), mark];
    }
    out.push(...inlineFromTokens(token.children, nextMarks));
  }
  return out;
}

function isBlockElement(name: string): boolean {
  return [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "ul",
    "ol",
    "li",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
    "section",
    "article",
  ].includes(name);
}

function listItemsFromTokens(tokens: HtmlToken[]): DocNode[] {
  const items: DocNode[] = [];
  for (const token of tokens) {
    if (token.kind === "element" && token.name === "li") {
      items.push(listItem(blocksFromTokens(token.children)));
    }
  }
  return items;
}

function tableRowsFromTokens(tokens: HtmlToken[]): DocNode[] {
  const rows: DocNode[] = [];
  for (const token of tokens) {
    if (token.kind !== "element") continue;
    if (token.name === "thead" || token.name === "tbody" || token.name === "tfoot") {
      rows.push(...tableRowsFromTokens(token.children));
    } else if (token.name === "tr") {
      const cells: DocNode[] = [];
      for (const cellTok of token.children) {
        if (cellTok.kind !== "element") continue;
        if (cellTok.name === "th") {
          cells.push({ type: "tableHeader", content: [paragraph(inlineFromTokens(cellTok.children, []))] });
        } else if (cellTok.name === "td") {
          cells.push({ type: "tableCell", content: [paragraph(inlineFromTokens(cellTok.children, []))] });
        }
      }
      rows.push({ type: "tableRow", content: cells });
    }
  }
  return rows;
}

function blocksFromTokens(tokens: HtmlToken[]): DocNode[] {
  const blocks: DocNode[] = [];
  let inlineBuffer: HtmlToken[] = [];

  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const inline = inlineFromTokens(inlineBuffer, []);
    inlineBuffer = [];
    if (inline.some((n) => n.type !== "text" || (n.text ?? "").trim().length > 0)) {
      blocks.push(paragraph(inline));
    }
  };

  for (const token of tokens) {
    if (token.kind === "text") {
      if (token.value.trim().length > 0) inlineBuffer.push(token);
      continue;
    }
    if (!isBlockElement(token.name)) {
      inlineBuffer.push(token);
      continue;
    }
    flushInline();
    switch (token.name) {
      case "p":
        blocks.push(paragraph(inlineFromTokens(token.children, [])));
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        blocks.push(
          heading(
            Number(token.name[1]) as HeadingLevel,
            inlineFromTokens(token.children, []),
          ),
        );
        break;
      case "blockquote":
        blocks.push(blockquote(blocksFromTokens(token.children)));
        break;
      case "pre": {
        const codeEl = token.children.find(
          (c) => c.kind === "element" && c.name === "code",
        ) as ElementToken | undefined;
        const langClass = codeEl?.attrs.class ?? "";
        const lang = /language-([\w-]+)/.exec(langClass)?.[1];
        const raw = collectRawText(codeEl ? codeEl.children : token.children).replace(/\n$/, "");
        blocks.push(codeBlock(raw, lang));
        break;
      }
      case "ul":
        blocks.push(bulletList(listItemsFromTokens(token.children)));
        break;
      case "ol": {
        const start = token.attrs.start ? Number(token.attrs.start) : 1;
        blocks.push(orderedList(listItemsFromTokens(token.children), start));
        break;
      }
      case "li":
        // Stray <li> outside a list: treat its content as blocks.
        blocks.push(...blocksFromTokens(token.children));
        break;
      case "hr":
        blocks.push(horizontalRule());
        break;
      case "table":
        blocks.push({ type: "table", content: tableRowsFromTokens(token.children) });
        break;
      case "div":
      case "section":
      case "article":
        blocks.push(...blocksFromTokens(token.children));
        break;
      default:
        break;
    }
  }
  flushInline();
  return blocks;
}

/** Parse an HTML string into a document. */
export function fromHTML(html: string): DocJSON {
  const tokens = tokenizeHTML(html);
  const content = blocksFromTokens(tokens);
  return { type: "doc", content: content.length ? content : [paragraph()] };
}
