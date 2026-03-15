import type { Permissions } from "./history.js";
import { cacheGet, cacheSet } from "./cache.js";
import { getProvider } from "./providers/index.js";

// ── model routing ─────────────────────────────────────────────────────────────
// Simple queries → fast model. Complex/ambiguous → smart model.

const COMPLEX_SIGNALS = [
  /\b(undo|revert|rollback|previous|last)\b/i,
  /\b(all files?|recursively|bulk|batch)\b/i,
  /\b(pipeline|chain|then|and then|after)\b/i,
  /\b(if|when|unless|only if)\b/i,
  /[|&;]{2}/,           // pipes / &&  in NL (unusual = complex intent)
];

/** Model routing per provider */
function pickModel(nl: string): { fast: string; smart: string; pick: "fast" | "smart" } {
  const isComplex = COMPLEX_SIGNALS.some((r) => r.test(nl)) || nl.split(" ").length > 10;
  const provider = getProvider();

  if (provider.name === "anthropic") {
    return {
      fast: "claude-haiku-4-5-20251001",
      smart: "claude-sonnet-4-6",
      pick: isComplex ? "smart" : "fast",
    };
  }

  // Cerebras — fast model for simple, smart model for complex
  return {
    fast: "llama3.1-8b",
    smart: "llama3.1-8b",
    pick: isComplex ? "smart" : "fast",
  };
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

  const provider = getProvider();
  const routing = pickModel(nl);
  const model = routing.pick === "smart" ? routing.smart : routing.fast;
  const system = buildSystemPrompt(perms, sessionCmds);

  let text: string;

  if (onToken) {
    text = await provider.stream(nl, { model, maxTokens: 256, system }, {
      onToken: (partial) => onToken(partial),
    });
  } else {
    text = await provider.complete(nl, { model, maxTokens: 256, system });
  }

  if (text.startsWith("BLOCKED:")) throw new Error(text);
  cacheSet(nl, text);
  return text;
}

// ── prefetch ──────────────────────────────────────────────────────────────────

export function prefetchNext(
  lastNl: string,
  perms: Permissions,
  sessionCmds: string[]
) {
  if (cacheGet(lastNl)) return;
  translateToCommand(lastNl, perms, sessionCmds).catch(() => {});
}

// ── explain ───────────────────────────────────────────────────────────────────

export async function explainCommand(command: string): Promise<string> {
  const provider = getProvider();
  const routing = pickModel("explain"); // simple = fast model
  return provider.complete(command, {
    model: routing.fast,
    maxTokens: 128,
    system: "Explain what this shell command does in one plain English sentence. No markdown, no code blocks.",
  });
}

// ── auto-fix ──────────────────────────────────────────────────────────────────

export async function fixCommand(
  originalNl: string,
  failedCommand: string,
  errorOutput: string,
  perms: Permissions,
  sessionCmds: string[]
): Promise<string> {
  const provider = getProvider();
  const routing = pickModel(originalNl);
  const text = await provider.complete(
    `I wanted to: ${originalNl}\nI ran: ${failedCommand}\nError:\n${errorOutput}\n\nGive me the corrected command only.`,
    {
      model: routing.smart, // always use smart model for fixes
      maxTokens: 256,
      system: buildSystemPrompt(perms, sessionCmds),
    }
  );
  if (text.startsWith("BLOCKED:")) throw new Error(text);
  return text;
}

// ── summarize output (for MCP/agent use) ──────────────────────────────────────

export async function summarizeOutput(
  command: string,
  output: string,
  maxTokens: number = 200
): Promise<string> {
  const provider = getProvider();
  const routing = pickModel("summarize");
  return provider.complete(
    `Command: ${command}\nOutput:\n${output}\n\nSummarize this output concisely for an AI agent. Focus on: status, key results, errors. Be terse.`,
    {
      model: routing.fast,
      maxTokens,
      system: "You summarize command output for AI agents. Be extremely concise. Return structured info. No prose.",
    }
  );
}
