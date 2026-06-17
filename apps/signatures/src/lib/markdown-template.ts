import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { marked } from "marked";
import { getRenderedOutputPath } from "./files.js";
import type { RecipientStatus, SignerType } from "../types/index.js";

export interface TemplateVariable {
  name: string;
  raw: string;
}

export interface SignatureAnchor {
  anchor: string;
  raw: string;
  signer_type?: SignerType;
  role?: string;
  assigned_to?: string;
  signing_order?: number;
  parallel_group?: number;
  required?: number;
  recipient_status?: RecipientStatus;
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
    if (parseSignatureExpression(name)) continue;
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
    const anchor = parseSignatureExpression(expression);
    if (anchor) anchors.push({ ...anchor, raw });
  }
  return anchors;
}

export function renderTemplateVariables(
  markdown: string,
  variables: Record<string, unknown>
): string {
  return markdown.replace(VAR_PATTERN, (raw, expression: string) => {
    const key = expression.trim();
    const signature = parseSignatureExpression(key);
    if (signature) return signatureAnchorSpan(signature);
    const value = getPathValue(variables, key);
    if (value === undefined || value === null) return raw;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export function parseSignatureExpression(expression: string): Omit<SignatureAnchor, "raw"> | undefined {
  const parts = expression.split("|").map((part) => part.trim()).filter(Boolean);
  const head = parts.shift();
  if (!head) return undefined;

  let anchor: string | undefined;
  if (head === "signature") {
    anchor = "signature";
  } else if (head.startsWith("signature:")) {
    anchor = head.slice("signature:".length).trim() || "signature";
  } else {
    return undefined;
  }

  const out: Omit<SignatureAnchor, "raw"> = { anchor };
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) throw new Error(`Signature anchor option must be key=value: ${part}`);
    const key = part.slice(0, eq).trim().toLowerCase().replace(/-/g, "_");
    const value = part.slice(eq + 1).trim();
    if (!key) throw new Error(`Signature anchor option key is empty: ${part}`);

    if (key === "type" || key === "signer_type") {
      if (value !== "human" && value !== "agent") throw new Error("signature signer_type must be one of: human, agent");
      out.signer_type = value;
    } else if (key === "role") {
      out.role = value || undefined;
    } else if (key === "assigned_to" || key === "assignee") {
      out.assigned_to = value || undefined;
    } else if (key === "order" || key === "signing_order") {
      out.signing_order = parsePositiveInteger(value, key);
    } else if (key === "group" || key === "parallel_group") {
      out.parallel_group = parsePositiveInteger(value, key);
    } else if (key === "required") {
      out.required = value === "false" || value === "0" ? 0 : 1;
    } else if (key === "recipient_status") {
      out.recipient_status = parseRecipientStatus(value);
    } else {
      throw new Error(`Unknown signature anchor option: ${key}`);
    }
  }

  return out;
}

function signatureAnchorSpan(anchor: Omit<SignatureAnchor, "raw">): string {
  const attrs: Array<[string, string | number | undefined]> = [
    ["data-signature-anchor", anchor.anchor],
    ["data-signer-type", anchor.signer_type],
    ["data-signature-role", anchor.role],
    ["data-assigned-to", anchor.assigned_to],
    ["data-signing-order", anchor.signing_order],
    ["data-parallel-group", anchor.parallel_group],
    ["data-required", anchor.required],
    ["data-recipient-status", anchor.recipient_status],
  ];
  return `<span ${attrs
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(" ")}></span>`;
}

function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Signature anchor ${key} must be a positive integer`);
  return parsed;
}

function parseRecipientStatus(value: string): RecipientStatus {
  if (value === "pending" || value === "available" || value === "viewed" || value === "signed" || value === "declined" || value === "expired" || value === "failed" || value === "skipped") {
    return value;
  }
  throw new Error("recipient_status must be one of: pending, available, viewed, signed, declined, expired, failed, skipped");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    setPathValue(out, key, raw);
  }
  return out;
}

function setPathValue(target: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".").map((part) => part.trim());
  if (parts.some((part) => !part)) throw new Error(`Variable path is invalid: ${path}`);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (existing === undefined) {
      current[part] = {};
    } else if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new Error(`Variable path conflicts with previous value: ${path}`);
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
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
