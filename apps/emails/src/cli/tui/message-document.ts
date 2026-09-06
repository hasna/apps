import { parseDocument } from "htmlparser2";
import { marked, type Token, type Tokens } from "marked";

type ChildNode = ReturnType<typeof parseDocument>["children"][number];
type Element = Extract<ChildNode, { attribs: Record<string, string> }>;

export type MessageBlock =
  | { kind: "markdown"; content: string }
  | { kind: "code"; content: string; language: string }
  | { kind: "quote"; content: string }
  | { kind: "list"; items: Array<{ marker: string; blocks: MessageBlock[] }> };

const MAX_SOURCE = 220_000;
const CLIPPED = "Message clipped for terminal performance. Open Raw to view the full source.";

/** Mail is untrusted terminal input, including when a control sequence is HTML encoded. */
export function safeMailText(value: string): string {
  return value.replace(/(?:\x1b\]|\x9d)[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
    .replace(/\r\n?/g, "\n");
}

function isElement(node: ChildNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function invisible(node: Element): boolean {
  return /^(head|script|style|title|meta|link|iframe|object|template|noscript|svg)$/i.test(node.name)
    || "hidden" in node.attribs
    || node.attribs["aria-hidden"] === "true"
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i.test(node.attribs.style ?? "");
}

function plain(node: ChildNode, depth = 0): string {
  if (depth > 60) return "";
  if (node.type === "text") return node.data;
  if (!isElement(node) || invisible(node)) return "";
  if (node.name === "br") return "\n";
  return node.children.map((child) => plain(child, depth + 1)).join("");
}

function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/([`*_\[\]<>])/g, "\\$1")
    .replace(/^(\s*)([#>+-]|\d+\.)\s/gm, "$1\\$2 ");
}

export function safeMailLink(href: string): string | null {
  const value = safeMailText(href).trim();
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  return value.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Parse HTML as a document, never by stripping tags. Layout tables flatten, data tables survive. */
function htmlMarkdown(html: string): string {
  const root = parseDocument(html);
  function render(node: ChildNode, depth = 0): string {
    if (depth > 60) return "";
    if (node.type === "text") return escapeMarkdown(node.data.replace(/\s+/g, " "));
    if (!isElement(node) || invisible(node)) return "";
    const tag = node.name.toLowerCase();
    if (tag === "pre") {
      const code = node.children.find((child) => isElement(child) && child.name === "code");
      const language = code && isElement(code) ? /language-([\w+-]+)/.exec(code.attribs.class ?? "")?.[1] ?? "" : "";
      const text = safeMailText(plain(node)).replace(/^\n|\n$/g, "");
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === "img") {
      if (node.attribs.width === "1" || node.attribs.height === "1") return "";
      return node.attribs.alt ? `[Image: ${escapeMarkdown(node.attribs.alt)}]` : "";
    }
    // Structural renderers visit only their chosen children. Eagerly rendering
    // every child first makes nested tables/lists do exponential duplicate work.
    let rendered: string | undefined;
    const content = () => rendered ??= node.children.map((child) => render(child, depth + 1)).join("");
    const emphasis = (marker: string) => {
      const value = content();
      return value.trim()
        ? `${/^\s/.test(value) ? " " : ""}${marker}${value.trim()}${marker}${/\s$/.test(value) ? " " : ""}` : value;
    };
    if (tag === "br") return "  \n";
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "blockquote" || /\b(gmail_quote|yahoo_quoted|moz-cite-prefix)\b/.test(node.attribs.class ?? "")) {
      return `\n\n${content().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${content().trim()}\n\n`;
    if (tag === "strong" || tag === "b") return emphasis("**");
    if (tag === "em" || tag === "i") return emphasis("*");
    if (tag === "s" || tag === "del") return emphasis("~~");
    if (tag === "code") {
      const text = plain(node);
      const fence = "`".repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
      return `${fence} ${text} ${fence}`;
    }
    if (tag === "a") {
      const href = safeMailLink(node.attribs.href ?? "");
      return href ? `[${content().trim() || href}](${href})` : content();
    }
    if (tag === "ul" || tag === "ol") {
      const items = node.children.filter((child) => isElement(child) && child.name === "li");
      const start = Number.parseInt(node.attribs.start ?? "1", 10) || 1;
      return "\n\n" + items.map((item, index) => {
        const marker = tag === "ol" ? `${start + index}. ` : "- ";
        return marker + render(item, depth + 1).trim().replace(/\n/g, "\n" + " ".repeat(marker.length));
      }).join("\n") + "\n\n";
    }
    if (tag === "table") {
      const rows: Element[] = [];
      const collect = (element: Element, level = depth) => {
        if (level > 60) return;
        for (const child of element.children) {
          if (!isElement(child) || invisible(child)) continue;
          if (child.name === "tr") rows.push(child);
          else if (/^(thead|tbody|tfoot)$/.test(child.name)) collect(child, level + 1);
        }
      };
      collect(node);
      const cells = rows.map((row) => row.children.filter((child): child is Element => isElement(child) && /^(td|th)$/.test(child.name)));
      if (node.attribs.role !== "presentation" && cells.some((row) => row.some((cell) => cell.name === "th"))) {
        const width = Math.max(0, ...cells.map((row) => row.length));
        if (width > 0 && width <= 20) {
          const lines = cells.map((row) => "| " + Array.from({ length: width }, (_, i) => row[i]
            ? render(row[i]!, depth + 1).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|") : "").join(" | ") + " |");
          lines.splice(1, 0, "| " + Array(width).fill("---").join(" | ") + " |");
          return `\n\n${lines.join("\n")}\n\n`;
        }
      }
    }
    if (/^(p|div|section|article|header|footer|table|tr|dl|dt|dd)$/.test(tag)) return `\n\n${content().trim()}\n\n`;
    if (tag === "td" || tag === "th") return content() + " ";
    return content();
  }
  return safeMailText(root.children.map((node) => render(node)).join("")).trim();
}

function splitTokens(tokens: Token[], references: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let prose = "";
  const flush = () => {
    if (prose.trim()) blocks.push({ kind: "markdown", content: prose.trim() + references });
    prose = "";
  };
  for (const token of tokens) {
    if (token.type === "code") {
      flush();
      blocks.push({ kind: "code", content: token.text, language: token.lang?.split(/\s/)[0] ?? "" });
    } else if (token.type === "blockquote") {
      flush();
      blocks.push({ kind: "quote", content: token.text + references });
    } else if (token.type === "list") {
      flush();
      const list = token as Tokens.List;
      blocks.push({ kind: "list", items: list.items.map((item, i) => ({
        marker: item.task ? (item.checked ? "☑" : "☐") : list.ordered ? `${Number(list.start) + i}.` : "•",
        blocks: splitTokens(item.tokens, references),
      })) });
    } else if (token.type !== "def") {
      prose += token.raw;
    }
  }
  flush();
  return blocks;
}

export function messageDocument(text?: string | null, html?: string | null): MessageBlock[] {
  const raw = html?.trim() || text || "";
  let clipped = raw.length > MAX_SOURCE;
  const bounded = safeMailText(raw.slice(0, MAX_SOURCE));
  const isHtml = !!html?.trim() || /^\s*<(?:!doctype|html|body|div|p|table|br|pre|h[1-6]|span|strong|em|ul|ol|blockquote)\b/i.test(bounded);
  let source = isHtml ? htmlMarkdown(bounded) : bounded;
  if (!source.trim() && text) {
    source = safeMailText(text.slice(0, MAX_SOURCE));
    clipped = text.length > MAX_SOURCE;
  }
  // Keep the attribution with the quoted reply, like Gmail's trimmed history.
  source = source.replace(/^(On .{1,300}wrote:)\n(?=>)/gm, "> $1\n>\n");
  const tokens = marked.lexer(source, { gfm: true });
  const references = Object.entries(tokens.links).map(([key, value]) => `\n[${key}]: ${value.href}${value.title ? ` "${value.title}"` : ""}`).join("");
  const blocks = splitTokens(tokens, references ? "\n" + references : "");
  if (clipped) blocks.push({ kind: "markdown", content: CLIPPED });
  return blocks.length ? blocks : [{ kind: "markdown", content: "(Empty message)" }];
}
