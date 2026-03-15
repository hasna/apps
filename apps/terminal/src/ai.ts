import type { Permissions } from "./history.js";
import { cacheGet, cacheSet } from "./cache.js";
import { getProvider } from "./providers/index.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ── model routing ─────────────────────────────────────────────────────────────
// Simple queries → fast model. Complex/ambiguous → smart model.

const COMPLEX_SIGNALS = [
  /\b(undo|revert|rollback|previous|last)\b/i,
  /\b(all files?|recursively|bulk|batch)\b/i,
  /\b(pipeline|chain|then|and then|after)\b/i,
  /\b(if|when|unless|only if)\b/i,
  /\b(go into|go to|navigate|cd into|enter)\b.*\b(and|then)\b/i, // multi-step navigation
  /\b(inside|within|under)\b/i,  // relative references need context awareness
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

  // Cerebras — qwen for everything (llama3.1-8b too unreliable)
  return {
    fast: "qwen-3-235b-a22b-instruct-2507",
    smart: "qwen-3-235b-a22b-instruct-2507",
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

// ── project context ──────────────────────────────────────────────────────────

function detectProjectContext(): string {
  const cwd = process.cwd();
  const parts: string[] = [];

  // Node.js / TypeScript
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      parts.push(`Project: Node.js/TypeScript (package.json found)`);
      if (pkg.scripts) {
        const scripts = Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).slice(0, 8);
        parts.push(`Available scripts: ${scripts.join(", ")}`);
      }
      parts.push(`Use npm/bun/pnpm commands, NOT maven/gradle/cargo.`);
    } catch {}
  }

  // Python
  if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "pyproject.toml"))) {
    parts.push("Project: Python. Use pip/python commands.");
  }

  // Go
  if (existsSync(join(cwd, "go.mod"))) {
    parts.push("Project: Go. Use go build/test/run commands.");
  }

  // Rust
  if (existsSync(join(cwd, "Cargo.toml"))) {
    parts.push("Project: Rust. Use cargo build/test/run commands.");
  }

  // Java
  if (existsSync(join(cwd, "pom.xml"))) {
    parts.push("Project: Java/Maven. Use mvn commands.");
  }
  if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    parts.push("Project: Java/Gradle. Use gradle commands.");
  }

  // Directory structure — so AI knows actual paths (not guessed ones)
  try {
    const { execSync } = require("child_process");
    // Top-level dirs
    const topLevel = execSync("ls -1", { cwd, encoding: "utf8", timeout: 2000 }).trim();
    parts.push(`Top-level: ${topLevel.split("\n").join(", ")}`);

    // Detect monorepo (packages/ or workspaces in package.json)
    const isMonorepo = existsSync(join(cwd, "packages")) || existsSync(join(cwd, "apps"));
    if (isMonorepo) {
      const pkgDirs = execSync(
        `ls -d packages/*/src 2>/dev/null || ls -d apps/*/src 2>/dev/null || echo ""`,
        { cwd, encoding: "utf8", timeout: 2000 }
      ).trim();
      if (pkgDirs) {
        parts.push(`MONOREPO: Source is in packages/*/src/, NOT src/. Search packages/ not src/.`);
        parts.push(`Package sources:\n${pkgDirs}`);
      }
    }

    // src/ structure — include FILES so AI knows exact filenames + extensions
    for (const srcDir of isMonorepo ? ["packages"] : ["src", "lib", "app"]) {
      if (existsSync(join(cwd, srcDir))) {
        const tree = execSync(
          `find ${srcDir} -maxdepth ${isMonorepo ? 4 : 3} -not -path '*/node_modules/*' -not -path '*/dist/*' -not -name '*.test.*' -not -name '*.spec.*' 2>/dev/null | sort | head -80`,
          { cwd, encoding: "utf8", timeout: 3000 }
        ).trim();
        if (tree) parts.push(`Files in ${srcDir}/:\n${tree}`);
        break;
      }
    }
  } catch { /* timeout or no exec — skip */ }

  return parts.length > 0 ? `\n\nPROJECT CONTEXT:\n${parts.join("\n")}` : "";
}

// ── system prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(perms: Permissions, sessionEntries: SessionEntry[]): string {
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

  return `You are a terminal assistant. Output ONLY the exact shell command — no explanation, no markdown, no backticks.
The user describes what they want in plain English. You translate to the exact shell command.

RULES:
- When user refers to items from previous output, use the EXACT names shown (e.g., "feature/auth" not "auth", "open-skills" not "open_skills")
- When user says "the largest/smallest/first/second", look at the previous output to identify the correct item
- When user says "them all" or "combine them", refer to items from the most recent command output
- For "show who changed each line" use git blame, for "show remote urls" use git remote -v
- For text search in code, use grep -rn, NOT nm or objdump (those are for compiled binaries)
- On macOS: for memory use vm_stat or top -l 1, for disk use df -h, for processes use ps aux
- macOS uses BSD tools, NOT GNU. Use: du -d 1 (not --max-depth), ls (not ls --color), sort -r (not sort --reverse), ps aux (not ps --sort)
- NEVER invent commands that don't exist. Stick to standard Unix/macOS commands.
- NEVER install packages (npx, npm install, pip install, brew install). This is a READ-ONLY terminal.
- NEVER modify source code (sed -i, codemod, awk with redirect). Only observe, never change.
- Search src/ directory, NOT dist/ or node_modules/ for code queries.
- Use exact file paths from the project context below. Do NOT guess paths.
- For "what would break if I deleted X": use grep -rn "from.*X\\|import.*X\\|require.*X" src/ to find all importers.
- For "find where X is defined": use grep -rn "export.*function X\\|export.*class X\\|export.*const X" src/
- For "show me the code of function X": use grep -A 20 "function X" src/ to show the function body.
- For conceptual questions about what code does: use cat on the relevant file, the AI summary will explain it.

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
NEVER give up. Always try a grep/find/cat read-only alternative.

SEMANTIC MAPPING: When the user references a concept, search the file tree for RELATED terms:
- Look at directory names: src/agent/ likely contains "agentic" code
- Look at file names: lazy-executor.ts likely handles "lazy mode"
- When uncertain: grep -rn "keyword" src/ --include="*.ts" -l (list matching files)

ACTION vs CONCEPTUAL: If the prompt starts with "run", "execute", "check", "test", "build", "show output of" — ALWAYS generate an executable command. NEVER read README for action requests. Only read docs for "explain why", "what does X mean", "how was X designed".

EXISTENCE CHECKS: If the prompt starts with "is there", "does this have", "do we have", "does X exist" — NEVER run/start/launch anything. Use ls, find, or test -d to CHECK existence. These are READ-ONLY questions.

MONOREPO: If the project context says "MONOREPO", search packages/ or apps/ NOT src/. Use: grep -rn "pattern" packages/ --include="*.ts". For specific packages, use packages/PKGNAME/src/.
cwd: ${process.cwd()}
shell: zsh / macOS${projectContext}${restrictionBlock}${contextBlock}`;
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
  const system = buildSystemPrompt(perms, sessionEntries);

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
      system: buildSystemPrompt(perms, sessionEntries),
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
