import Anthropic from "@anthropic-ai/sdk";
import type { Permissions } from "./history.js";
import { cacheGet, cacheSet } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── model routing ─────────────────────────────────────────────────────────────
// Simple queries → haiku (fast). Complex/ambiguous → sonnet.

const COMPLEX_SIGNALS = [
  /\b(undo|revert|rollback|previous|last)\b/i,
  /\b(all files?|recursively|bulk|batch)\b/i,
  /\b(pipeline|chain|then|and then|after)\b/i,
  /\b(if|when|unless|only if)\b/i,
  /[|&;]{2}/,           // pipes / &&  in NL (unusual = complex intent)
];

function pickModel(nl: string): string {
  const isComplex = COMPLEX_SIGNALS.some((r) => r.test(nl)) || nl.split(" ").length > 10;
  return isComplex ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
}

// ── irreversibility ───────────────────────────────────────────────────────────

const IRREVERSIBLE_PATTERNS = [
  /\brm\s/, /\brmdir\b/, /\btruncate\b/, /\bdrop\s+table\b/i,
  /\bdelete\s+from\b/i, /\bmv\b.*\/dev\/null/, /\b>\s*[^>]/,
  /\bdd\b/, /\bmkfs\b/, /\bformat\b/, /\bshred\b/,
];

export function isIrreversible(command: string): boolean {
  return IRREVERSIBLE_PATTERNS.some((r) => r.test(command));
}

// ── permissions ───────────────────────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS    = [/\brm\b/, /\brmdir\b/, /\btruncate\b/, /\bdrop\s+table\b/i, /\bdelete\s+from\b/i];
const NETWORK_PATTERNS        = [/\bcurl\b/, /\bwget\b/, /\bssh\b/, /\bscp\b/, /\bping\b/, /\bnc\b/, /\bnetcat\b/];
const SUDO_PATTERNS           = [/\bsudo\b/];
const INSTALL_PATTERNS        = [/\bbrew\s+install\b/, /\bnpm\s+install\s+-g\b/, /\bpip\s+install\b/, /\bapt\s+install\b/, /\byum\s+install\b/];
const WRITE_OUTSIDE_PATTERNS  = [/\s(\/etc|\/usr|\/var|\/opt|\/root|~\/[^.])/, />\s*\//];

export function checkPermissions(command: string, perms: Permissions): string | null {
  if (!perms.destructive && DESTRUCTIVE_PATTERNS.some((r) => r.test(command)))
    return "destructive commands are disabled";
  if (!perms.network && NETWORK_PATTERNS.some((r) => r.test(command)))
    return "network commands are disabled";
  if (!perms.sudo && SUDO_PATTERNS.some((r) => r.test(command)))
    return "sudo is disabled";
  if (!perms.install && INSTALL_PATTERNS.some((r) => r.test(command)))
    return "package installation is disabled";
  if (!perms.write_outside_cwd && WRITE_OUTSIDE_PATTERNS.some((r) => r.test(command)))
    return "writing outside cwd is disabled";
  return null;
}

// ── system prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(perms: Permissions, sessionCmds: string[]): string {
  const restrictions: string[] = [];
  if (!perms.destructive)
    restrictions.push("- NEVER generate commands that delete, remove, or overwrite files/data");
  if (!perms.network)
    restrictions.push("- NEVER generate commands that make network requests (curl, wget, ssh, etc.)");
  if (!perms.sudo)
    restrictions.push("- NEVER generate commands requiring sudo");
  if (!perms.write_outside_cwd)
    restrictions.push("- NEVER write to paths outside the current working directory");
  if (!perms.install)
    restrictions.push("- NEVER install packages (brew, npm -g, pip, apt, etc.)");

  const restrictionBlock = restrictions.length > 0
    ? `\n\nRESTRICTIONS:\n${restrictions.join("\n")}\nIf restricted, output: BLOCKED: <reason>`
    : "";

  const contextBlock = sessionCmds.length > 0
    ? `\n\nSESSION HISTORY:\n${sessionCmds.map((c) => `$ ${c}`).join("\n")}`
    : "";

  return `You are a terminal assistant. Output ONLY the exact shell command — no explanation, no markdown, no backticks.
cwd: ${process.cwd()}
shell: zsh / macOS${restrictionBlock}${contextBlock}`;
}

// ── streaming translate ───────────────────────────────────────────────────────

export async function translateToCommand(
  nl: string,
  perms: Permissions,
  sessionCmds: string[],
  onToken?: (partial: string) => void
): Promise<string> {
  // cache hit — instant
  const cached = cacheGet(nl);
  if (cached) { onToken?.(cached); return cached; }

  const model = pickModel(nl);
  let result = "";

  if (onToken) {
    // streaming path
    const stream = await client.messages.stream({
      model,
      max_tokens: 256,
      system: buildSystemPrompt(perms, sessionCmds),
      messages: [{ role: "user", content: nl }],
    });
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        result += chunk.delta.text;
        onToken(result.trim());
      }
    }
  } else {
    const message = await client.messages.create({
      model,
      max_tokens: 256,
      system: buildSystemPrompt(perms, sessionCmds),
      messages: [{ role: "user", content: nl }],
    });
    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");
    result = block.text;
  }

  const text = result.trim();
  if (text.startsWith("BLOCKED:")) throw new Error(text);
  cacheSet(nl, text);
  return text;
}

// ── prefetch ──────────────────────────────────────────────────────────────────
// Silently warm the cache after a command runs — no await, fire and forget

export function prefetchNext(
  lastNl: string,
  perms: Permissions,
  sessionCmds: string[]
) {
  // Only prefetch if we don't have it cached already
  if (cacheGet(lastNl)) return;
  translateToCommand(lastNl, perms, sessionCmds).catch(() => {});
}

// ── explain ───────────────────────────────────────────────────────────────────

export async function explainCommand(command: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    system: "Explain what this shell command does in one plain English sentence. No markdown, no code blocks.",
    messages: [{ role: "user", content: command }],
  });
  const block = message.content[0];
  if (block.type !== "text") return "";
  return block.text.trim();
}

// ── auto-fix ──────────────────────────────────────────────────────────────────

export async function fixCommand(
  originalNl: string,
  failedCommand: string,
  errorOutput: string,
  perms: Permissions,
  sessionCmds: string[]
): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: buildSystemPrompt(perms, sessionCmds),
    messages: [{
      role: "user",
      content: `I wanted to: ${originalNl}\nI ran: ${failedCommand}\nError:\n${errorOutput}\n\nGive me the corrected command only.`,
    }],
  });
  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  const text = block.text.trim();
  if (text.startsWith("BLOCKED:")) throw new Error(text);
  return text;
}
