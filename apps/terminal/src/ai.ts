import type { Permissions } from "./history.js";
import { cacheGet, cacheSet } from "./cache.js";
import { getProvider } from "./providers/index.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { discoverProjectHints, discoverSafetyHints, formatHints } from "./context-hints.js";

// ── model routing ─────────────────────────────────────────────────────────────
// Config-driven model selection. Defaults per provider, user can override in ~/.terminal/config.json

const COMPLEX_SIGNALS = [
  /\b(undo|revert|rollback|previous|last)\b/i,
  /\b(all files?|recursively|bulk|batch)\b/i,
  /\b(pipeline|chain|then|and then|after)\b/i,
  /\b(if|when|unless|only if)\b/i,
  /\b(go into|go to|navigate|cd into|enter)\b.*\b(and|then)\b/i,
  /\b(inside|within|under)\b/i,
  /[|&;]{2}/,
];

/** Default models per provider — user can override in ~/.terminal/config.json under "models" */
const MODEL_DEFAULTS: Record<string, { fast: string; smart: string }> = {
  cerebras:  { fast: "qwen-3-235b-a22b-instruct-2507", smart: "qwen-3-235b-a22b-instruct-2507" },
  groq:      { fast: "openai/gpt-oss-120b",             smart: "moonshotai/kimi-k2-instruct" },
  xai:       { fast: "grok-code-fast-1",                smart: "grok-4-fast-non-reasoning" },
  anthropic: { fast: "claude-haiku-4-5-20251001",       smart: "claude-sonnet-4-6" },
};

/** Load user model overrides from ~/.terminal/config.json */
function loadModelOverrides(): Record<string, { fast?: string; smart?: string }> {
  try {
    const configPath = join(process.env.HOME ?? "~", ".terminal", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      return config.models ?? {};
    }
  } catch {}
  return {};
}

/** Model routing per provider — config-driven with defaults */
function pickModel(nl: string): { fast: string; smart: string; pick: "fast" | "smart" } {
  const isComplex = COMPLEX_SIGNALS.some((r) => r.test(nl)) || nl.split(" ").length > 10;
  const provider = getProvider();
  const defaults = MODEL_DEFAULTS[provider.name] ?? MODEL_DEFAULTS.cerebras;
  const overrides = loadModelOverrides()[provider.name] ?? {};

  return {
    fast: overrides.fast ?? defaults.fast,
    smart: overrides.smart ?? defaults.smart,
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

  // Inject safety hints for the command being generated (AI sees what's risky)
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

  return `You are a terminal assistant. Output ONLY the exact shell command — no explanation, no markdown, no backticks.
The user describes what they want in plain English. You translate to the exact shell command.

RULES:
- SIMPLICITY FIRST: Use the simplest command that works. Prefer grep | sort | head over 10-pipe chains. Complex pipelines are OK when needed, but NEVER pass file:line output to wc or xargs without cleaning it first.
- ALWAYS use grep -rn (with -r) when searching directories. NEVER use grep without -r on src/ or any directory.
- When user refers to items from previous output, use the EXACT names shown (e.g., "feature/auth" not "auth", "open-skills" not "open_skills")
- When user says "the largest/smallest/first/second", look at the previous output to identify the correct item
- When user says "them all" or "combine them", refer to items from the most recent command output
- For "show who changed each line" use git blame, for "show remote urls" use git remote -v
- For text search in code, use grep -rn, NOT nm or objdump (those are for compiled binaries)
- On macOS: for memory use vm_stat or top -l 1, for disk use df -h, for processes use ps aux
- macOS uses BSD tools, NOT GNU. Use: du -d 1 (not --max-depth), ls (not ls --color), sort -r (not sort --reverse), ps aux (not ps --sort)
- NEVER use grep -P (PCRE). macOS grep has NO -P flag. Use grep -E for extended regex, or sed/awk for complex extraction.
- NEVER invent commands that don't exist. Stick to standard Unix/macOS commands.
- NEVER install packages (npx, npm install, pip install, brew install). This is a READ-ONLY terminal.
- NEVER modify source code (sed -i, codemod, awk with redirect). Only observe, never change.
- Search src/ directory, NOT dist/ or node_modules/ for code queries.
- Use exact file paths from the project context below. Do NOT guess paths.
- For "what would break if I deleted X": use grep -rn "from.*X\\|import.*X\\|require.*X" src/ to find all importers.
- For "find where X is defined": use grep -rn "export.*function X\\|export.*class X\\|export.*const X" src/
- For "show me the code of function X": if you know the file, use grep -A 30 "function X" src/file.ts. If not, use grep -rn -A 30 "function X" src/ --include="*.ts"
- ALWAYS use grep -rn (recursive) when searching directories. NEVER use grep without -r on a directory — it will fail.
- For conceptual questions about what code does: use cat on the relevant file, the AI summary will explain it.
- For DESTRUCTIVE requests (delete, remove, install, push): output BLOCKED: <reason>. NEVER try to execute destructive commands.

AST-POWERED QUERIES: For code STRUCTURE questions, use the built-in AST tool instead of grep:
- "find all exported functions" → terminal symbols src/ (lists all functions, classes, interfaces with line numbers)
- "show all interfaces" → terminal symbols src/ | grep interface
- "what does file X export" → terminal symbols src/file.ts
- "show me the class hierarchy" → terminal symbols src/
The "terminal symbols" command uses AST parsing (not regex) — it understands TypeScript, Python, Go, Rust code structure.
For TEXT search (TODO, string matches, imports) → use grep as normal.

COMPOUND QUESTIONS: For questions asking multiple things, prefer ONE command that captures all info. Extract multiple answers from a single output.
- "how many tests and do they pass" → bun test (extract count AND pass/fail from output)
- "what files changed and how many lines" → git log --stat -3 (shows files AND line counts)
- "what version of node and bun" → node -v && bun -v (only use && for trivial non-failing commands)
NEVER split into separate test runs or expensive commands chained with &&.

BLOCKED ALTERNATIVES: If your preferred command would require installing packages (npx, npm install), ALWAYS try a READ-ONLY alternative:
- Code quality analysis → grep -rn "TODO\\|FIXME\\|HACK\\|XXX" src/
- Linting → check if "lint" or "typecheck" exists in package.json scripts, run that
- Security scan → grep -rn "eval\\|exec\\|spawn\\|password\\|secret" src/
- Dependency audit → cat package.json | grep -A 50 dependencies
- Test coverage → bun test --coverage (or npm run test:coverage if available)
NEVER give up. NEVER output BLOCKED for analysis questions. Always try a grep/find/cat/wc/awk read-only alternative.
- Cyclomatic complexity → grep -rn "if\\|else\\|for\\|while\\|switch\\|case\\|catch\\|&&\\|||" src/ --include="*.ts" | wc -l
- Unused exports → grep -rn "export function\|export const\|export class" src/ --include="*.ts" | sed 's/.*export [a-z]* //' | sed 's/[(<:].*//' | sort -u
- Dead code → for each exported name, grep -rn "name" src/ --include="*.ts" | wc -l (if only 1 match = unused)
- Dependency graph → grep -rn "from " src/ --include="*.ts" | sed 's/:.*from "/→/' | sed 's/".*//' | sort -u
- Most parameters → grep -rn "function " src/ --include="*.ts" | awk -F'[()]' '{print gsub(/,/,",",$2)+1, $0}' | sort -nr | head -10
ALWAYS try a heuristic shell approach before giving up. NEVER say BLOCKED for analysis questions.

SEMANTIC MAPPING: When the user references a concept, search the file tree for RELATED terms:
- Look at directory names: src/agent/ likely contains "agentic" code
- Look at file names: lazy-executor.ts likely handles "lazy mode"
- When uncertain: grep -rn "keyword" src/ --include="*.ts" -l (list matching files)

ACTION vs CONCEPTUAL: If the prompt starts with "run", "execute", "check", "test", "build", "show output of" — ALWAYS generate an executable command. NEVER read README for action requests. Only read docs for "explain why", "what does X mean", "how was X designed".

EXISTENCE CHECKS: If the prompt starts with "is there", "does this have", "do we have", "does X exist" — NEVER run/start/launch anything. Use ls, find, or test -d to CHECK existence. These are READ-ONLY questions.

MONOREPO: If the project context says "MONOREPO", search packages/ or apps/ NOT src/. Use: grep -rn "pattern" packages/ --include="*.ts". For specific packages, use packages/PKGNAME/src/.
cwd: ${process.cwd()}
shell: zsh / macOS${projectContext}${safetyBlock}${restrictionBlock}${contextBlock}${currentPrompt ? loadCorrectionHints(currentPrompt) : ""}`;
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
  const routing = pickModel(nl);
  const model = routing.pick === "smart" ? routing.smart : routing.fast;
  const system = buildSystemPrompt(perms, sessionEntries, nl);

  let text: string;

  if (onToken) {
    text = await provider.stream(nl, { model, maxTokens: 256, system }, {
      onToken: (partial) => onToken(partial),
    });
  } else {
    text = await provider.complete(nl, { model, maxTokens: 256, system });
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
  sessionEntries: SessionEntry[]
): Promise<string> {
  const provider = getProvider();
  const routing = pickModel(originalNl);
  const text = await provider.complete(
    `I wanted to: ${originalNl}\nI ran: ${failedCommand}\nError:\n${errorOutput}\n\nGive me the corrected command only.`,
    {
      model: routing.smart, // always use smart model for fixes
      maxTokens: 256,
      system: buildSystemPrompt(perms, sessionEntries, originalNl),
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
