import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { marked } from "marked";
import { getRenderedOutputPath } from "./files.js";

export interface TemplateVariable {
  name: string;
  raw: string;
}

export interface SignatureAnchor {
  anchor: string;
  raw: string;
}

export interface RenderedMarkdown {
  markdown: string;
  html: string;
  html_path: string;
  variables: TemplateVariable[];
  signature_anchors: SignatureAnchor[];
}

const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!part) return undefined;
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function parseVariables(markdown: string): TemplateVariable[] {
  const seen = new Set<string>();
  const vars: TemplateVariable[] = [];
  for (const match of markdown.matchAll(VAR_PATTERN)) {
    const raw = match[0] ?? "";
    const name = (match[1] ?? "").trim();
    if (name.startsWith("signature")) continue;
    if (!seen.has(name)) {
      seen.add(name);
      vars.push({ name, raw });
    }
  }
  return vars;
}

export function parseSignatureAnchors(markdown: string): SignatureAnchor[] {
  const anchors: SignatureAnchor[] = [];
  for (const match of markdown.matchAll(VAR_PATTERN)) {
    const raw = match[0] ?? "";
    const expression = (match[1] ?? "").trim();
    if (expression === "signature") {
      anchors.push({ anchor: "signature", raw });
    } else if (expression.startsWith("signature:")) {
      anchors.push({ anchor: expression.slice("signature:".length).trim() || "signature", raw });
    }
  }
  return anchors;
}

export function renderTemplateVariables(
  markdown: string,
  variables: Record<string, unknown>
): string {
  return markdown.replace(VAR_PATTERN, (raw, expression: string) => {
    const key = expression.trim();
    if (key === "signature" || key.startsWith("signature:")) {
      const anchor = key.includes(":") ? key.slice(key.indexOf(":") + 1).trim() : "signature";
      return `<span data-signature-anchor="${anchor || "signature"}"></span>`;
    }
    const value = getPathValue(variables, key);
    if (value === undefined || value === null) return raw;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export async function renderMarkdown(
  markdown: string,
  variables: Record<string, unknown> = {},
  outputName = "document.md"
): Promise<RenderedMarkdown> {
  const filled = renderTemplateVariables(markdown, variables);
  const body = await marked.parse(filled, { async: false });
  const html = buildDocumentHtml(String(body));
  const htmlPath = getRenderedOutputPath(outputName, ".html");
  writeFileSync(htmlPath, html);
  return {
    markdown: filled,
    html,
    html_path: htmlPath,
    variables: parseVariables(markdown),
    signature_anchors: parseSignatureAnchors(markdown),
  };
}

export async function renderMarkdownFile(
  path: string,
  variables: Record<string, unknown> = {}
): Promise<RenderedMarkdown> {
  return renderMarkdown(readFileSync(path, "utf-8"), variables, basename(path));
}

export function parseCliVariables(values: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const value of values ?? []) {
    const eq = value.indexOf("=");
    if (eq === -1) {
      throw new Error(`Variable must be key=value: ${value}`);
    }
    const key = value.slice(0, eq).trim();
    const raw = value.slice(eq + 1);
    if (!key) throw new Error(`Variable key is empty: ${value}`);
    out[key] = raw;
  }
  return out;
}

export function buildDocumentHtml(body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open Signatures Document</title>
  <style>
    body {
      color: #17202a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.55;
      margin: 48px auto;
      max-width: 760px;
    }
    h1, h2, h3 { color: #111827; line-height: 1.2; margin: 1.4em 0 0.5em; }
    h1 { font-size: 30px; }
    h2 { font-size: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    p, ul, ol, table, blockquote { margin: 0 0 14px; }
    blockquote { border-left: 3px solid #94a3b8; color: #475569; padding-left: 14px; }
    code { background: #f3f4f6; border-radius: 4px; padding: 1px 4px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
    [data-signature-anchor] {
      border-bottom: 1px solid #111827;
      display: inline-block;
      height: 42px;
      min-width: 220px;
      vertical-align: bottom;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
