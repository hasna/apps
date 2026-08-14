// Context hints — discover context via lightweight checks, inject into AI prompt
// Regex DISCOVERS, AI DECIDES. No hardcoded logic that makes decisions.

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

export interface ContextHints {
  project: string[];    // project metadata
  output: string[];     // observations about command output
  safety: string[];     // safety-relevant observations
  environment: string[]; // system/env observations
}

/** Discover project context from the filesystem */
export function discoverProjectHints(cwd: string): string[] {
  const hints: string[] = [];

  // Package managers and project files
  const projectFiles: [string, string][] = [
    ["package.json", "Node.js/TypeScript"],
    ["pyproject.toml", "Python"],
    ["requirements.txt", "Python"],
    ["go.mod", "Go"],
    ["Cargo.toml", "Rust"],
    ["pom.xml", "Java/Maven"],
    ["build.gradle", "Java/Gradle"],
    ["build.gradle.kts", "Java/Gradle (Kotlin DSL)"],
    ["Makefile", "Has Makefile"],
    ["Dockerfile", "Has Docker"],
    ["docker-compose.yml", "Has Docker Compose"],
    ["docker-compose.yaml", "Has Docker Compose"],
    [".github/workflows", "Has GitHub Actions CI"],
    ["Gemfile", "Ruby"],
    ["composer.json", "PHP"],
    ["mix.exs", "Elixir"],
    ["build.zig", "Zig"],
    ["CMakeLists.txt", "C/C++ (CMake)"],
  ];

  for (const [file, lang] of projectFiles) {
    if (existsSync(join(cwd, file))) {
      hints.push(`Project type: ${lang} (${file} found)`);
    }
  }

  // Extract metadata from package.json — trimmed to save tokens
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) hints.push(`Package: ${pkg.name}@${pkg.version ?? "?"}`);
      if (pkg.scripts) {
        // Only top-5 most useful scripts
        const priority = ["dev", "build", "test", "lint", "start", "typecheck", "check"];
        const scripts = Object.keys(pkg.scripts);
        const top = priority.filter(s => scripts.includes(s));
        const rest = scripts.filter(s => !priority.includes(s)).slice(0, Math.max(0, 5 - top.length));
        hints.push(`Scripts: ${[...top, ...rest].join(", ")}`);
      }
      if (pkg.dependencies) {
        // Only framework/major deps — skip utility libs
        const major = ["react", "next", "express", "fastify", "hono", "vue", "angular", "svelte",
          "prisma", "drizzle", "mongoose", "typeorm", "zod", "trpc", "graphql", "tailwindcss",
          "electron", "bun", "elysia", "nest", "nuxt", "remix", "astro", "vite"];
        const deps = Object.keys(pkg.dependencies);
        const found = deps.filter(d => major.some(m => d.includes(m)));
        if (found.length > 0) hints.push(`Key deps: ${found.slice(0, 10).join(", ")}`);
      }
    } catch {}
  }

  // Extract from pyproject.toml
  const pyPath = join(cwd, "pyproject.toml");
  if (existsSync(pyPath)) {
    try {
      const py = readFileSync(pyPath, "utf8");
      const name = py.match(/name\s*=\s*"([^"]+)"/)?.[1];
      if (name) hints.push(`Python package: ${name}`);
    } catch {}
  }

  // Extract from go.mod
  const goPath = join(cwd, "go.mod");
  if (existsSync(goPath)) {
    try {
      const go = readFileSync(goPath, "utf8");
      const mod = go.match(/module\s+(\S+)/)?.[1];
      if (mod) hints.push(`Go module: ${mod}`);
    } catch {}
  }

  // Extract from Cargo.toml
  const cargoPath = join(cwd, "Cargo.toml");
  if (existsSync(cargoPath)) {
    try {
      const cargo = readFileSync(cargoPath, "utf8");
      const name = cargo.match(/name\s*=\s*"([^"]+)"/)?.[1];
      if (name) hints.push(`Rust crate: ${name}`);
    } catch {}
  }

  // Monorepo detection
  if (existsSync(join(cwd, "packages"))) {
    try {
      const pkgs = readdirSync(join(cwd, "packages")).filter(d => !d.startsWith("."));
      hints.push(`MONOREPO: ${pkgs.length} packages in packages/ — search packages/ not src/`);
      hints.push(`Packages: ${pkgs.slice(0, 10).join(", ")}`);
    } catch {}
  }
  if (existsSync(join(cwd, "apps"))) {
    hints.push("MONOREPO: apps/ directory detected");
  }

  // Makefile targets
  if (existsSync(join(cwd, "Makefile"))) {
    try {
      const { execSync } = require("child_process");
      const targets = execSync("grep -E '^[a-zA-Z_-]+:' Makefile | head -10 | cut -d: -f1", { cwd, encoding: "utf8", timeout: 1000 }).trim();
      if (targets) hints.push(`Makefile targets: ${targets.split("\n").join(", ")}`);
    } catch {}
  }

  // Source directory structure — max 20 files to save tokens
  try {
    const { execSync } = require("child_process");
    const srcDirs = ["src", "lib", "app", "packages"];
    for (const dir of srcDirs) {
      if (existsSync(join(cwd, dir))) {
        const tree = execSync(
          `find ${dir} -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/dist/*' -not -name '*.test.*' -not -name '*.spec.*' 2>/dev/null | sort | head -20`,
          { cwd, encoding: "utf8", timeout: 2000 }
        ).trim();
        if (tree) hints.push(`Files in ${dir}/:\n${tree}`);
        break;
      }
    }
  } catch {}

  return hints;
}

/** Discover output-specific hints (observations about command output) */
export function discoverOutputHints(output: string, command: string): string[] {
  const hints: string[] = [];

  const lines = output.split("\n");
  hints.push(`Output: ${lines.length} lines, ${output.length} chars`);

  // Only detect test results from actual test runners (not grep output containing "pass"/"fail" in code)
  const isGrepOutput = /^\s*(src\/|\.\/|packages\/).*:\d+:/.test(output);
  if (!isGrepOutput) {
    const passMatch = output.match(/(\d+)\s+pass(?:ed|ing)?\b/i);
    const failMatch = output.match(/(\d+)\s+fail(?:ed|ing|ure)?\b/i);
    if (passMatch) hints.push(`Test results detected: ${passMatch[0]}`);
    if (failMatch) hints.push(`Test results detected: ${failMatch[0]}`);

    // Error patterns (only from actual command output, not code search)
    if (output.match(/error\s*TS\d+/i)) hints.push("TypeScript errors detected in output");
    if (output.match(/ENOENT|EACCES|EADDRINUSE/)) hints.push("System error code detected in output");
  }

  // Coverage patterns
  if (output.match(/%\s*Funcs|%\s*Lines|coverage/i)) hints.push("Code coverage data detected in output");

  // Large/repetitive output
  if (lines.length > 100) hints.push(`Large output (${lines.length} lines) — consider summarizing`);
  const uniqueLines = new Set(lines.map(l => l.trim())).size;
  if (uniqueLines < lines.length * 0.5) hints.push("Output has many duplicate/similar lines");

  // Sensitive data (only env var assignments, not code containing the word KEY/TOKEN)
  if (output.match(/^[A-Z_]+(KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/m)) hints.push("Output may contain sensitive data — redact credentials");

  // Error block extraction — state machine that captures multi-line errors
  if (!isGrepOutput) {
    const errorBlocks = extractErrorBlocks(output);
    if (errorBlocks.length > 0) {
      const summary = errorBlocks.slice(0, 3).map(b => b.trim().split("\n").slice(0, 5).join("\n")).join("\n---\n");
      hints.push(`ERROR BLOCKS FOUND (${errorBlocks.length}):\n${summary}`);
    }
  }

  return hints;
}

/** Extract multi-line error blocks using a state machine */
function extractErrorBlocks(output: string): string[] {
  const lines = output.split("\n");
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inErrorBlock = false;
  let blankCount = 0;

  // Patterns that START an error block
  const errorStarters = [
    /^error/i, /^Error:/i, /^ERROR/,
    /^Traceback/i, /^panic:/i, /^fatal:/i,
    /^FAIL/i, /^✗/, /^✘/,
    /error\s*TS\d+/i, /error\[E\d+\]/,
    /^SyntaxError/i, /^TypeError/i, /^ReferenceError/i,
    /^Unhandled/i, /^Exception/i,
    /ENOENT|EACCES|EADDRINUSE|ECONNREFUSED/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      blankCount++;
      if (inErrorBlock) {
        currentBlock.push(line);
        // 2+ blank lines = end of error block
        if (blankCount >= 2) {
          blocks.push(currentBlock.join("\n").trim());
          currentBlock = [];
          inErrorBlock = false;
        }
      }
      continue;
    }
    blankCount = 0;

    // Check if this line starts a new error block
    if (!inErrorBlock && errorStarters.some(p => p.test(trimmed))) {
      inErrorBlock = true;
      currentBlock = [line];
      continue;
    }

    if (inErrorBlock) {
      // Continuation: indented lines, "at ..." stack frames, "--->" pointers, "File ..." python traces
      const isContinuation =
        /^\s+/.test(line) ||
        /^\s*at\s/.test(trimmed) ||
        /^\s*-+>/.test(trimmed) ||
        /^\s*\|/.test(trimmed) ||
        /^\s*File "/.test(trimmed) ||
        /^\s*\d+\s*\|/.test(trimmed) || // rust/compiler line numbers
        /^Caused by:/i.test(trimmed);

      if (isContinuation) {
        currentBlock.push(line);
      } else {
        // Non-continuation, non-blank = end of error block
        blocks.push(currentBlock.join("\n").trim());
        currentBlock = [];
        inErrorBlock = false;

        // Check if THIS line starts a new error block
        if (errorStarters.some(p => p.test(trimmed))) {
          inErrorBlock = true;
          currentBlock = [line];
        }
      }
    }
  }

  // Flush remaining block
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n").trim());
  }

  return blocks;
}

/** Discover safety hints about a command */
export function discoverSafetyHints(command: string): string[] {
  const hints: string[] = [];

  // Observations about the command (AI decides if it's safe)
  if (command.match(/\brm\b|\brmdir\b|\btruncate\b/)) hints.push("SAFETY: command contains file deletion (rm/rmdir/truncate)");
  if (command.match(/\bkill\b|\bkillall\b|\bpkill\b/)) hints.push("SAFETY: command kills processes");
  if (command.match(/\bgit\s+push\b|\bgit\s+reset\s+--hard\b/)) hints.push("SAFETY: command pushes/resets git");
  if (command.match(/\bnpx\b|\bnpm\s+install\b|\bpip\s+install\b/)) hints.push("SAFETY: command installs packages");
  if (command.match(/\bsed\s+-i\b|\bcodemod\b/)) hints.push("SAFETY: command modifies files in-place");
  if (command.match(/\btouch\b|\bmkdir\b/)) hints.push("SAFETY: command creates files/directories");
  if (command.match(/>\s*\S+\.\w+/)) hints.push("SAFETY: command writes to a file via redirect");
  if (command.match(/\b(bun|npm|pnpm)\s+run\s+dev\b|\bstart\b/)) hints.push("SAFETY: command starts a server/process");

  // Read-only observations
  if (command.match(/^\s*git\s+(log|show|diff|status|branch|blame|tag)\b/)) hints.push("This is a read-only git command");
  if (command.match(/^\s*(ls|cat|head|tail|grep|find|wc|du|df|uptime|whoami|pwd)\b/)) hints.push("This is a read-only command");

  return hints;
}

/** Format all hints for system prompt injection */
export function formatHints(project: string[], output?: string[], safety?: string[]): string {
  const sections: string[] = [];

  if (project.length > 0) {
    sections.push("PROJECT CONTEXT:\n" + project.join("\n"));
  }
  if (output && output.length > 0) {
    sections.push("OUTPUT OBSERVATIONS:\n" + output.join("\n"));
  }
  if (safety && safety.length > 0) {
    sections.push("SAFETY OBSERVATIONS:\n" + safety.join("\n"));
  }

  return sections.join("\n\n");
}
