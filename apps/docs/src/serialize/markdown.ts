/**
 * Markdown <-> document conversion. Headless and dependency-free.
 *
 * Supports the model's block set (headings, paragraphs, blockquotes, fenced
 * code, bullet/ordered lists incl. nesting, horizontal rules, GFM tables) and
 * inline marks (bold, italic, strike, code, link, hard breaks).
 */
import type { DocJSON, DocNode, HeadingLevel, Mark } from "../types/index.js";
import {
  blockquote,
  bulletList,
  codeBlock,
  heading,
  horizontalRule,
  listItem,
  orderedList,
  paragraph,
  text,
} from "../model/schema.js";

// ---------------------------------------------------------------------------
// Export: document -> Markdown
// ---------------------------------------------------------------------------

function escapeMd(value: string): string {
  return value.replace(/([\\`*_[\]~])/g, "\\$1");
}

function cellText(cell: DocNode): string {
  // A table cell wraps block content; take the inline of its first paragraph.
  const first = (cell.content ?? [])[0];
  return inlineToMarkdown(first?.content ?? []).replace(/\|/g, "\\|").trim();
}

function inlineToMarkdown(nodes: DocNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type !== "text") return inlineToMarkdown(node.content ?? []);
      const marks = node.marks ?? [];
      const has = (t: Mark["type"]) => marks.some((m) => m.type === t);
      let s = has("code") ? "`" + (node.text ?? "") + "`" : escapeMd(node.text ?? "");
      if (has("italic")) s = `*${s}*`;
      if (has("bold")) s = `**${s}**`;
      if (has("strike")) s = `~~${s}~~`;
      if (has("link")) {
        const href = String(marks.find((m) => m.type === "link")?.attrs?.href ?? "");
        s = `[${s}](${href})`;
      }
      return s;
    })
    .join("");
}

function renderListItem(item: DocNode, marker: string): string {
  const inner = blocksToMarkdown(item.content ?? []);
  const pad = " ".repeat(marker.length);
  return inner
    .split("\n")
    .map((line, i) => (i === 0 ? marker + line : line ? pad + line : line))
    .join("\n");
}

function renderTable(node: DocNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const toCells = (row: DocNode) => (row.content ?? []).map(cellText);
  const header = toCells(rows[0]!);
  const sep = header.map(() => "---");
  const body = rows.slice(1).map(toCells);
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(sep), ...body.map(line)].join("\n");
}

function blockToMarkdown(node: DocNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content ?? []);
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(level)} ${inlineToMarkdown(node.content ?? [])}`;
    }
    case "blockquote":
      return blocksToMarkdown(node.content ?? [])
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      const raw = (node.content ?? []).map((c) => c.text ?? "").join("");
      return "```" + lang + "\n" + raw + "\n```";
    }
    case "bulletList":
      return (node.content ?? []).map((it) => renderListItem(it, "- ")).join("\n");
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((it, i) => renderListItem(it, `${start + i}. `))
        .join("\n");
    }
    case "horizontalRule":
      return "---";
    case "table":
      return renderTable(node);
    default:
      return inlineToMarkdown(node.content ?? []);
  }
}

function blocksToMarkdown(blocks: DocNode[]): string {
  return blocks.map(blockToMarkdown).join("\n\n");
}

/** Serialize a document to a Markdown string. */
export function toMarkdown(doc: DocJSON): string {
  return blocksToMarkdown(doc.content ?? []).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Import: Markdown -> document
// ---------------------------------------------------------------------------

const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^(\s*)(```+|~~~+)\s*([\w-]*)\s*$/;
const HR_RE = /^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/;
const BLOCKQUOTE_RE = /^\s{0,3}>\s?(.*)$/;

function leading(line: string): number {
  return line.length - line.trimStart().length;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      buf += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(buf.trim());
      buf = "";
    } else {
      buf += s[i];
    }
  }
  cells.push(buf.trim());
  return cells;
}

/** Inline markdown parser: produces text/hardBreak nodes with marks. */
function parseInline(input: string, marks: Mark[] = []): DocNode[] {
  const out: DocNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(text(buf, marks.length ? [...marks] : undefined));
    buf = "";
  };
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    const rest = input.slice(i);

    if (ch === "\\" && i + 1 < input.length) {
      buf += input[i + 1];
      i += 2;
      continue;
    }
    // Hard break: two+ spaces before newline.
    if (ch === "\n") {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, "");
        flush();
        out.push({ type: "hardBreak" });
      } else {
        buf += " ";
      }
      i += 1;
      continue;
    }
    // Inline code.
    if (ch === "`") {
      const fence = /^`+/.exec(rest)![0];
      const close = input.indexOf(fence, i + fence.length);
      if (close !== -1) {
        flush();
        const codeText = input.slice(i + fence.length, close).replace(/^ | $/g, "");
        out.push(text(codeText, [...marks, { type: "code" }]));
        i = close + fence.length;
        continue;
      }
    }
    // Link [text](href)
    if (ch === "[") {
      const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)/.exec(rest);
      if (linkMatch) {
        flush();
        const href = linkMatch[2]!.trim();
        out.push(...parseInline(linkMatch[1]!, [...marks, { type: "link", attrs: { href } }]));
        i += linkMatch[0].length;
        continue;
      }
    }
    // Emphasis: strong (**/__), strike (~~), em (*/_)
    const emph = matchEmphasis(rest);
    if (emph) {
      flush();
      out.push(...parseInline(emph.inner, [...marks, { type: emph.mark }]));
      i += emph.length;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function matchEmphasis(
  rest: string,
): { mark: Mark["type"]; inner: string; length: number } | null {
  const tryDelim = (delim: string, mark: Mark["type"]) => {
    if (!rest.startsWith(delim)) return null;
    const close = rest.indexOf(delim, delim.length);
    if (close === -1) return null;
    const inner = rest.slice(delim.length, close);
    if (inner.length === 0) return null;
    return { mark, inner, length: close + delim.length };
  };
  return (
    tryDelim("**", "bold") ||
    tryDelim("__", "bold") ||
    tryDelim("~~", "strike") ||
    tryDelim("*", "italic") ||
    tryDelim("_", "italic")
  );
}

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  );
}

function parseListBlock(
  lines: string[],
  start: number,
): { node: DocNode; next: number } {
  const firstMatch = BULLET_RE.exec(lines[start]!) ?? ORDERED_RE.exec(lines[start]!);
  const ordered = ORDERED_RE.test(lines[start]!);
  const baseIndent = firstMatch![1]!.length;
  const startNum = ordered ? Number(firstMatch![2]) : 1;
  const items: DocNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const m = ordered ? ORDERED_RE.exec(line) : BULLET_RE.exec(line);
    if (!m || m[1]!.length !== baseIndent) break;
    const markerWidth = m[0].length - m[3]!.length;
    const itemLines: string[] = [m[3]!];
    i += 1;
    while (i < lines.length) {
      const cont = lines[i]!;
      if (cont.trim() === "") break;
      const siblingBullet = BULLET_RE.exec(cont);
      const siblingOrdered = ORDERED_RE.exec(cont);
      const sib = ordered ? siblingOrdered : siblingBullet;
      if (sib && sib[1]!.length === baseIndent) break;
      if (leading(cont) <= baseIndent && !siblingBullet && !siblingOrdered) break;
      itemLines.push(cont.slice(Math.min(leading(cont), markerWidth)));
      i += 1;
    }
    const inner = parseBlocks(itemLines);
    items.push(listItem(inner.length ? inner : [paragraph()]));
  }

  const node = ordered ? orderedList(items, startNum) : bulletList(items);
  return { node, next: i };
}

function parseBlocks(lines: string[]): DocNode[] {
  const blocks: DocNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    // Fenced code
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2]!;
      const lang = fence[3] || undefined;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(codeBlock(body.join("\n"), lang));
      continue;
    }
    // Heading
    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push(
        heading(h[1]!.length as HeadingLevel, parseInline(h[2]!)),
      );
      i += 1;
      continue;
    }
    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push(horizontalRule());
      i += 1;
      continue;
    }
    // Blockquote
    if (BLOCKQUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i]!)) {
        quoted.push(BLOCKQUOTE_RE.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push(blockquote(parseBlocks(quoted)));
      continue;
    }
    // List
    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const { node, next } = parseListBlock(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }
    // Table (row followed by separator)
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const header = splitTableRow(line);
      i += 2;
      const rows: DocNode[] = [
        {
          type: "tableRow",
          content: header.map((c) => ({
            type: "tableHeader",
            content: [paragraph(parseInline(c))],
          })),
        },
      ];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        const cells = splitTableRow(lines[i]!);
        rows.push({
          type: "tableRow",
          content: cells.map((c) => ({
            type: "tableCell",
            content: [paragraph(parseInline(c))],
          })),
        });
        i += 1;
      }
      blocks.push({ type: "table", content: rows });
      continue;
    }
    // Paragraph
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlockStart(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push(paragraph(parseInline(para.join("\n"))));
  }

  return blocks;
}

/** Parse a Markdown string into a document. */
export function fromMarkdown(md: string): DocJSON {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const content = parseBlocks(lines);
  return { type: "doc", content: content.length ? content : [paragraph()] };
}
