import { createHash } from "node:crypto";
import type { GuardrailInput, GuardrailRedaction, GuardrailRedactionRule } from "./types";

export type TextField = {
  path: string;
  value: string;
};

const DEFAULT_SECRET_PATTERNS = [
  String.raw`\bsk-[A-Za-z0-9_\-*]{12,}\b`,
  String.raw`\bsk_(?:live|test)_[A-Za-z0-9_]{12,}\b`,
  String.raw`\bghp_[A-Za-z0-9_]{20,}\b`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}\b`,
  String.raw`\bxox[baprs]-[A-Za-z0-9-]{10,}\b`,
  String.raw`\bAIza[A-Za-z0-9_-]{20,}\b`,
  String.raw`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`,
  String.raw`(?i)(bearer\s+)[A-Za-z0-9_\-.]{12,}`,
];

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringifyJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushText(fields: TextField[], path: string, value: string | undefined | null): void {
  if (typeof value === "string" && value.length > 0) fields.push({ path, value });
}

export function collectTextFields(input: GuardrailInput): TextField[] {
  const fields: TextField[] = [];
  pushText(fields, "subject", input.subject);
  pushText(fields, "prompt.text", input.prompt?.text);
  input.prompt?.messages?.forEach((message, index) => {
    if (typeof message.content === "string") pushText(fields, `prompt.messages.${index}.content`, message.content);
    else pushText(fields, `prompt.messages.${index}.content`, stringifyJson(message.content));
  });
  pushText(fields, "action.id", input.action?.id);
  pushText(fields, "action.name", input.action?.name);
  pushText(fields, "action.kind", input.action?.kind);
  pushText(fields, "action.input", stringifyJson(input.action?.input));
  pushText(fields, "action.preview", stringifyJson(input.action?.preview));
  pushText(fields, "shell.command", input.shell?.command);
  pushText(fields, "shell.args", input.shell?.args?.join(" "));
  pushText(fields, "mcp.serverId", input.mcp?.serverId);
  pushText(fields, "mcp.serverName", input.mcp?.serverName);
  pushText(fields, "mcp.toolName", input.mcp?.toolName);
  pushText(fields, "mcp.arguments", stringifyJson(input.mcp?.arguments));
  pushText(fields, "browser.url", input.browser?.url);
  pushText(fields, "browser.domain", input.browser?.domain);
  pushText(fields, "browser.action", input.browser?.action);
  pushText(fields, "computer.app", input.computer?.app);
  pushText(fields, "computer.action", input.computer?.action);
  pushText(fields, "computer.screenText", input.computer?.screenText);
  pushText(fields, "runtime.path", input.runtime?.path);
  pushText(fields, "runtime.host", input.runtime?.host);
  pushText(fields, "runtime.packageName", input.runtime?.packageName);
  pushText(fields, "modelRouting.requestedModel", input.modelRouting?.requestedModel);
  pushText(fields, "modelRouting.selectedModel", input.modelRouting?.selectedModel);
  pushText(fields, "modelRouting.provider", input.modelRouting?.provider);
  pushText(fields, "secretAccess.secretName", input.secretAccess?.secretName);
  pushText(fields, "secretAccess.source", input.secretAccess?.source);
  pushText(fields, "sourceAccess.uri", input.sourceAccess?.uri);
  pushText(fields, "sourceAccess.license", input.sourceAccess?.license);
  pushText(fields, "business.operation", input.business?.operation);
  pushText(fields, "business.resource", input.business?.resource);
  pushText(fields, "content.text", input.content?.text);
  pushText(fields, "content.json", stringifyJson(input.content?.json));
  return fields;
}

export function collectSearchText(input: GuardrailInput): string {
  return collectTextFields(input)
    .map((field) => field.value)
    .join("\n");
}

function compilePattern(pattern: string): RegExp {
  if (pattern.startsWith("(?i)")) {
    return new RegExp(pattern.slice(4), "giu");
  }
  return new RegExp(pattern, "gu");
}

function pathAllowed(path: string, allowed: string[] | undefined): boolean {
  return !allowed?.length || allowed.some((candidate) => candidate === path || candidate === "*" || path.startsWith(`${candidate}.`));
}

export function detectRedactions(input: GuardrailInput, policyId: string, rules: GuardrailRedactionRule[]): GuardrailRedaction[] {
  const fields = collectTextFields(input);
  const redactions: GuardrailRedaction[] = [];
  for (const rule of rules) {
    const replacement = rule.replacement ?? "[redacted]";
    const pattern = compilePattern(rule.pattern);
    for (const field of fields) {
      if (!pathAllowed(field.path, rule.paths)) continue;
      for (const match of field.value.matchAll(pattern)) {
        const matched = match[0];
        if (!matched) continue;
        const start = match.index ?? 0;
        const base = {
          policyId,
          path: field.path,
          replacement,
          originalSha256: sha256(matched),
          start,
          end: start + matched.length,
        };
        redactions.push(rule.id ? { ...base, ruleId: rule.id } : base);
      }
    }
  }
  return redactions;
}

export function defaultSecretRedactionRules(): GuardrailRedactionRule[] {
  return DEFAULT_SECRET_PATTERNS.map((pattern, index) => ({
    id: `secret-pattern-${index + 1}`,
    pattern,
    replacement: "[redacted-secret]",
  }));
}
