import type { Permissions } from "./history.js";
import { cacheGet, cacheSet } from "./cache.js";
import { getProvider } from "./providers/index.js";
import type { LLMProvider } from "./providers/base.js";
import { selectAccessibleModel } from "./providers/base.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";
import { discoverProjectHints, discoverSafetyHints, formatHints } from "./context-hints.js";

// ── model routing ─────────────────────────────────────────────────────────────
// Config-driven model selection. Defaults per provider, user can override in
// config.json under the effective data home (getTerminalDir()).

const COMPLEX_SIGNALS = [
  /\b(undo|revert|rollback|previous|last)\b/i,
  /\b(all files?|recursively|bulk|batch)\b/i,
  /\b(pipeline|chain|then|and then|after)\b/i,
  /\b(if|when|unless|only if)\b/i,
  /\b(go into|go to|navigate|cd into|enter)\b.*\b(and|then)\b/i,
  /\b(inside|within|under)\b/i,
  /[|&;]{2}/,
];

/** Default models per provider — user can override in config.json under the effective data home (getTerminalDir()) under "models" */
const MODEL_DEFAULTS: Record<string, { fast: string; smart: string }> = {
  cerebras:  { fast: "qwen-3-235b-a22b-instruct-2507", smart: "qwen-3-235b-a22b-instruct-2507" },
  groq:      { fast: "openai/gpt-oss-120b",             smart: "moonshotai/kimi-k2-instruct" },
  xai:       { fast: "grok-code-fast-1",                smart: "grok-4-fast-non-reasoning" },
  anthropic: { fast: "claude-haiku-4-5-20251001",       smart: "claude-sonnet-4-6" },
};

/**
 * Per-provider model preference order, in priority sequence. The chosen model
 * is the first preference the configured key can actually access (per its own
 * GET /models list); the static MODEL_DEFAULTS above remain the fallback when
 * the list cannot be discovered. This prevents hardcoding models a key cannot
 * reach — Cerebras 404 (qwen-3-235b), Groq 404 (kimi-k2), xAI stop-param 400
 * (grok-code-fast-1 / grok-4-fast-non-reasoning) — see O15-04797.
 */
const MODEL_PREFERENCES: Record<string, { fast: string[]; smart: string[] }> = {
  cerebras: {
    fast:  ["gpt-oss-120b", "gemma-4-31b", "qwen-3-235b-a22b-instruct-2507"],
    smart: ["gpt-oss-120b", "gemma-4-31b", "qwen-3-235b-a22b-instruct-2507"],
  },
  groq: {
    fast:  ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b", "moonshotai/kimi-k2-instruct"],
    smart: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b", "moonshotai/kimi-k2-instruct"],
  },
  xai: {
    fast:  ["grok-4.20-0309-non-reasoning", "grok-4.6", "grok-4.5", "grok-code-fast-1"],
    smart: ["grok-4.20-0309-non-reasoning", "grok-4.6", "grok-4.5", "grok-4-fast-non-reasoning"],
  },
  anthropic: {
    fast:  ["claude-haiku-4-5-20251001"],
    smart: ["claude-sonnet-4-6"],
  },
};

/** Load user model overrides from config.json under the effective data home (getTerminalDir()) (cached 30s) */
let _modelOverrides: Record<string, { fast?: string; smart?: string }> | null = null;
let _modelOverridesAt = 0;

function loadModelOverrides(): Record<string, { fast?: string; smart?: string }> {
  const now = Date.now();
  if (_modelOverrides && now - _modelOverridesAt < 30_000) return _modelOverrides;
  try {
    const configPath = join(getTerminalDir(), "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      _modelOverrides = config.models ?? {};
      _modelOverridesAt = now;
      return _modelOverrides!;
    }
  } catch {}
  _modelOverrides = {};
  _modelOverridesAt = now;
  return _modelOverrides;
}

/** Model routing per provider — config-driven defaults, intersected with the key's accessible model list */
export async function pickModel(
  nl: string,
  provider: LLMProvider = getProvider(),
): Promise<{ fast: string; smart: string; pick: "fast" | "smart" }> {
  const isComplex = COMPLEX_SIGNALS.some((r) => r.test(nl)) || nl.split(" ").length > 10;
  const defaults = MODEL_DEFAULTS[provider.name] ?? MODEL_DEFAULTS.cerebras;
  const preferences = MODEL_PREFERENCES[provider.name] ?? {
    fast: [defaults.fast],
    smart: [defaults.smart],
  };
  const overrides = loadModelOverrides()[provider.name] ?? {};

  let accessible: string[] = [];
  try {
    accessible = await provider.listModels();
  } catch {
    // Discovery failure is not fatal — fall back to the static defaults below.
  }

  const resolve = (slot: "fast" | "smart"): string =>
    overrides[slot] ?? selectAccessibleModel(preferences[slot], accessible, defaults[slot]);

  return {
    fast: resolve("fast"),
    smart: resolve("smart"),
    pick: isComplex ? "smart" : "fast",
  };
}

// ── irreversibility ───────────────────────────────────────────────────────────

const IRREVERSIBLE_PATTERNS = [
  /\brm\s/, /\brmdir\b/, /\btruncate\b/, /\bdrop\s+table\b/i,
  /\bdelete\s+from\b/i, /\bmv\b.*\/dev\/null/, /\becho\b.*>\s*[^>]/, /\bcat\b.*>\s*[^>]/,
  /\bdd\b/, /\bmkfs\b/, /\bformat\b/, /\bshred\b/,
  // Process/service killing
  /\bkill\b/, /\bkillall\b/, /\bpkill\b/,
  // Git push/force operations
  /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+force\b/,
  // Code modification / package installation (security risk)
  /\bnpx\s+\S+/, /\bnpm\s+install\b/, /\bbun\s+add\b/, /\bpip\s+install\b/,
  /\bcodemod\b/, /\bsed\s+-i\b/, /\bawk\s.*>\s*\S+\.\w+/, /\bperl\s+-[pi]\b/,
  // File creation/modification (READ-ONLY terminal)
  /\btouch\b/, /\bmkdir\b/, /\becho\s.*>/, /\btee\b/, /\bcp\b/, /\bmv\b/,
  // Starting servers/processes (dangerous from NL)
  /\b(bun|npm|pnpm|yarn)\s+run\s+dev\b/, /\b(bun|npm)\s+start\b/,
];

// Commands that are ALWAYS safe (read-only git, etc.)
const SAFE_OVERRIDES = [
  /^\s*git\s+(log|show|diff|branch|status|blame|tag|remote|stash\s+list)\b/,
  /^\s*git\s+log\b/,
  // find -exec with read-only tools is safe
  /\bfind\b.*-exec\s+(wc|cat|head|tail|grep|stat|file|du|ls)\b/,
  // find without -exec is always safe
  /^\s*find\b(?!.*-exec\s+(rm|mv|chmod|chown|sed))/,
  // xargs with read-only tools is safe
  /\bxargs\s+(wc|cat|head|tail|grep|stat|file|du|ls|git\s+log|git\s+show|git\s+blame)\b/,
  /\bxargs\s+-I\s*\S+\s+(wc|cat|head|tail|grep|stat|git)\b/,
];

export function isIrreversible(command: string): boolean {
  // Safe overrides take priority
  if (SAFE_OVERRIDES.some((r) => r.test(command))) return false;
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

// ── session context ──────────────────────────────────────────────────────────

export interface SessionEntry {
  nl: string;
  cmd: string;
  output?: string; // short output (first few lines)
  error?: boolean;
}

// ── correction memory ───────────────────────────────────────────────────────

/** Load past corrections relevant to a prompt — injected as negative examples */
function loadCorrectionHints(prompt: string): string {
  try {
    // Dynamic import to avoid circular deps
    const { findSimilarCorrections } = require("./sessions-db.js");
    const corrections = findSimilarCorrections(prompt, 3);
    if (corrections.length === 0) return "";

    const lines = corrections.map((c: any) =>
      `AVOID: "${c.failed_command}" (failed: ${c.error_type}). USE: "${c.corrected_command}" instead.`
    );
    return `\n\nLEARNED CORRECTIONS (from past failures):\n${lines.join("\n")}`;
  } catch { return ""; }
}

// ── project context (powered by context-hints) ──────────────────────────────

function detectProjectContext(): string {
  const hints = discoverProjectHints(process.cwd());
  return hints.length > 0 ? `\n\n${formatHints(hints)}` : "";
}

// ── system prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(perms: Permissions, sessionEntries: SessionEntry[], currentPrompt?: string): string {
  const nl = currentPrompt?.toLowerCase() ?? "";

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

  let contextBlock = "";
  if (sessionEntries.length > 0) {
    const lines: string[] = [];
    for (const e of sessionEntries.slice(-5)) {
      lines.push(`> ${e.nl}`);
      lines.push(`$ ${e.cmd}`);
      if (e.output) lines.push(e.output);
      if (e.error) lines.push("(command failed)");
    }
    contextBlock = `\n\nSESSION HISTORY (user intent > command $ output):\n${lines.join("\n")}`;
  }

  const projectContext = detectProjectContext();

  const safetyBlock = sessionEntries.length > 0
    ? (() => {
        const lastCmd = sessionEntries[sessionEntries.length - 1]?.cmd;
        if (lastCmd) {
          const safetyHints = discoverSafetyHints(lastCmd);
          return safetyHints.length > 0 ? `\n\nLAST COMMAND SAFETY:\n${safetyHints.join("\n")}` : "";
        }
        return "";
      })()
    : "";

  // ── Conditional sections (only included when relevant) ──
  const wantsStructure = /\b(function|class|interface|export|symbol|structure|hierarchy|outline)\b/i.test(nl);
  const astBlock = wantsStructure ? `\nAST-POWERED QUERIES: For code STRUCTURE questions, use "terminal symbols" instead of grep. It uses AST parsing for TypeScript, Python, Go, Rust.` : "";

  const wantsMultiple = /\b(and|both|also|plus|as well)\b/i.test(nl);
  const compoundBlock = wantsMultiple ? `\nCOMPOUND QUESTIONS: Prefer ONE command that captures all info. NEVER split into separate expensive commands.` : "";

  const wantsAnalysis = /\b(quality|lint|coverage|complexity|unused|dead code|security|audit|scan|dependency)\b/i.test(nl);
  const blockedAltBlock = wantsAnalysis ? `\nBLOCKED ALTERNATIVES: If your preferred command needs installing packages, try READ-ONLY alternatives (grep, cat, wc, awk). NEVER give up on analysis questions.` : "";

  return `Translate to bash. One command. Simplest form. No explanation.

list files in current directory → ls
list all files including hidden → ls -a
show open files → lsof
show file size → du -sh file
show file type → file filename
show file permissions → ls -la file
display routing table → route
show last logged in users → last
show file stats → stat file
print directory tree 2 levels → tree -L 2
count word occurrences in file → grep -c "word" file
print number of files in dir → ls -1 | wc -l
print first line of file → head -1 file
print last line of file → tail -1 file
print lines 3 to 5 of file → sed -n '3,5p' file
print every other line → awk 'NR%2==1' file
count words in file → wc -w file
find empty files not in subdirs → find . -maxdepth 1 -type f -empty
show system load → w
system utilization stats → vmstat
DNS servers → cat /etc/resolv.conf | grep nameserver
long integer size → getconf LONG_BIT
base64 decode string → echo 'str' | base64 -d
show file owner → ls -la file
unique lines in file → uniq file
max cpu time → ulimit -t
memory info → lsmem
process priority → nice
bash profile → cat ~/.bashrc
search recursively → grep -rn "pattern" src/
${astBlock}${compoundBlock}${blockedAltBlock}
cwd: ${process.cwd()}
shell: zsh / macOS${projectContext}${safetyBlock}${restrictionBlock}${contextBlock}${currentPrompt ? loadCorrectionHints(currentPrompt) : ""}

Q:`;
}

// ── streaming translate ───────────────────────────────────────────────────────

export async function translateToCommand(
  nl: string,
  perms: Permissions,
  sessionEntries: SessionEntry[],
  onToken?: (partial: string) => void
): Promise<string> {
  // Only use cache when there's no session context (context makes same NL produce different commands)
  if (sessionEntries.length === 0) {
    const cached = cacheGet(nl);
    if (cached) { onToken?.(cached); return cached; }
  }

  const provider = getProvider();
  const routing = await pickModel(nl);
  const model = routing.pick === "smart" ? routing.smart : routing.fast;
  const system = buildSystemPrompt(perms, sessionEntries, nl);

  let text: string;

  if (onToken) {
    text = await provider.stream(nl, { model, maxTokens: 256, temperature: 0, stop: ["\n"], system }, {
      onToken: (partial) => onToken(partial),
    });
  } else {
    text = await provider.complete(nl, { model, maxTokens: 256, temperature: 0, stop: ["\n"], system });
  }

  if (text.startsWith("BLOCKED:")) throw new Error(text);

  // Strip AI reasoning — extract ONLY the shell command (first line)
  let cleaned = text.trim();
  // Remove ALL markdown code blocks and their content markers
  cleaned = cleaned.replace(/```(?:bash|sh|shell)?\n?/g, "").replace(/```/g, "");
  // Split into lines and find the FIRST one that looks like a SHELL COMMAND
  const lines = cleaned.split("\n");
  let command = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Skip lines that are clearly English prose, not commands
    if (/^(Based on|I |This |The |Let me|Here|Note:|Since|Looking|To |However|BLOCKED:|If |You |We |For |It |A |An |That )/.test(t)) continue;
    if (/^[A-Z][a-z].*[.;:!?,]/.test(t)) continue; // English sentence with punctuation anywhere
    if (t.split(" ").length > 15 && !/[|&;><$]/.test(t)) continue; // Long line without shell operators = prose
    // Must start with a plausible command character (lowercase, /, ., $, or common tool)
    if (/^[a-z./$~(]/.test(t) || /^[A-Z]+[_=]/.test(t)) {
      command = t;
      break;
    }
  }
  cleaned = command || lines[0]?.trim() || cleaned;

  cacheSet(nl, cleaned);
  return cleaned;
}

// ── prefetch ──────────────────────────────────────────────────────────────────

export function prefetchNext(
  lastNl: string,
  perms: Permissions,
  sessionEntries: SessionEntry[]
) {
  if (sessionEntries.length === 0 && cacheGet(lastNl)) return;
  translateToCommand(lastNl, perms, sessionEntries).catch(() => {});
}

// ── explain ───────────────────────────────────────────────────────────────────

export async function explainCommand(command: string): Promise<string> {
  const provider = getProvider();
  const routing = await pickModel("explain"); // simple = fast model
  return provider.complete(command, {
    model: routing.fast,
    maxTokens: 128,
    temperature: 0,
    system: "Explain what this shell command does in one plain English sentence. No markdown, no code blocks.",
  });
}

// ── auto-fix ──────────────────────────────────────────────────────────────────

export async function fixCommand(
  originalNl: string,
  failedCommand: string,
  errorOutput: string,
  perms: Permissions,
  _sessionEntries: SessionEntry[]
): Promise<string> {
  const provider = getProvider();
  const routing = await pickModel(originalNl);

  // Lightweight fix prompt — no full project context, just rules + restrictions
  const restrictions: string[] = [];
  if (!perms.destructive) restrictions.push("- NEVER delete/remove/overwrite files");
  if (!perms.network) restrictions.push("- NEVER make network requests");
  if (!perms.install) restrictions.push("- NEVER install packages");

  const fixSystem = `You are a terminal assistant. Output ONLY the corrected shell command — no explanation.
macOS/BSD tools. NEVER use grep -P. Use grep -E for extended regex.
NEVER install packages. READ-ONLY terminal.
cwd: ${process.cwd()}${restrictions.length > 0 ? `\nRESTRICTIONS:\n${restrictions.join("\n")}` : ""}`;

  const text = await provider.complete(
    `I wanted to: ${originalNl}\nI ran: ${failedCommand}\nError:\n${errorOutput.slice(0, 2000)}\n\nGive me the corrected command only.`,
    {
      model: routing.smart,
      maxTokens: 256,
      temperature: 0,
      stop: ["\n"],
      system: fixSystem,
    }
  );
  if (text.startsWith("BLOCKED:")) throw new Error(text);
  return text.trim();
}

// summarizeOutput() removed — all output processing goes through processOutput() in output-processor.ts
