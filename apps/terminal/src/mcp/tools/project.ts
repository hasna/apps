// Project tools: boot, project_overview, run, install, status, help

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { processOutput } from "../../output-processor.js";
import { getOutputProvider } from "../../providers/index.js";
import { getBootContext } from "../../session-boot.js";
import { truncateText } from "../../compact-output.js";

/** Detect project toolchain from filesystem */
function detectToolchain(workDir: string): { runner: string; ecosystem: string } {
  const { existsSync, readFileSync } = require("fs");
  const { join } = require("path");

  // JS/TS: bun > pnpm > yarn > npm
  const hasBun = existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock")) || (() => {
    try { return !!JSON.parse(readFileSync(join(workDir, "package.json"), "utf8")).engines?.bun; } catch { return false; }
  })();
  if (hasBun) return { runner: "bun", ecosystem: "js" };
  if (existsSync(join(workDir, "pnpm-lock.yaml"))) return { runner: "pnpm", ecosystem: "js" };
  if (existsSync(join(workDir, "yarn.lock"))) return { runner: "yarn", ecosystem: "js" };
  if (existsSync(join(workDir, "deno.json")) || existsSync(join(workDir, "deno.jsonc"))) return { runner: "deno", ecosystem: "js" };

  // Rust
  if (existsSync(join(workDir, "Cargo.toml"))) return { runner: "cargo", ecosystem: "rust" };

  // Go
  if (existsSync(join(workDir, "go.mod"))) return { runner: "go", ecosystem: "go" };

  // Python: poetry > pip
  if (existsSync(join(workDir, "poetry.lock"))) return { runner: "poetry", ecosystem: "python" };
  if (existsSync(join(workDir, "Pipfile"))) return { runner: "pipenv", ecosystem: "python" };
  if (existsSync(join(workDir, "pyproject.toml")) || existsSync(join(workDir, "requirements.txt"))) return { runner: "pip", ecosystem: "python" };

  // Ruby
  if (existsSync(join(workDir, "Gemfile"))) return { runner: "bundle", ecosystem: "ruby" };

  // PHP
  if (existsSync(join(workDir, "composer.json"))) return { runner: "composer", ecosystem: "php" };

  // Elixir
  if (existsSync(join(workDir, "mix.exs"))) return { runner: "mix", ecosystem: "elixir" };

  // .NET
  if (existsSync(join(workDir, "*.csproj")) || existsSync(join(workDir, "*.fsproj")) || existsSync(join(workDir, "Directory.Build.props"))) return { runner: "dotnet", ecosystem: "dotnet" };

  // Dart/Flutter
  if (existsSync(join(workDir, "pubspec.yaml"))) return { runner: "dart", ecosystem: "dart" };

  // Swift
  if (existsSync(join(workDir, "Package.swift"))) return { runner: "swift", ecosystem: "swift" };

  // Zig
  if (existsSync(join(workDir, "build.zig"))) return { runner: "zig", ecosystem: "zig" };

  // Make (generic)
  if (existsSync(join(workDir, "Makefile"))) return { runner: "make", ecosystem: "make" };

  // Fallback: npm if package.json exists
  if (existsSync(join(workDir, "package.json"))) return { runner: "npm", ecosystem: "js" };

  return { runner: "npm", ecosystem: "unknown" };
}

export function registerProjectTools(server: McpServer, h: ToolHelpers): void {

  // ── boot ──────────────────────────────────────────────────────────────────

  server.tool(
    "boot",
    "Get everything an agent needs on session start in ONE call — git state, project info, source structure. Replaces: git status + git log + cat package.json + ls src/. Cached for the session.",
    async () => {
      const ctx = await getBootContext(process.cwd());
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...ctx,
        hints: {
          cwd: process.cwd(),
          tip: "All terminal tools support relative paths. Use 'src/foo.ts' not the full absolute path. Use commit({message, push:true}) instead of raw git commands. Use run({task:'test'}) instead of bun/npm test. Use lookup({file, items}) instead of grep pipelines.",
        },
      }) }] };
    }
  );

  // ── project_overview ──────────────────────────────────────────────────────

  server.tool(
    "project_overview",
    "Get project overview in one call — package.json info, source structure, config files. Replaces: cat package.json + ls src/ + cat tsconfig.json.",
    {
      path: z.string().optional().describe("Project root (default: cwd)"),
    },
    async ({ path }) => {
      const cwd = path ?? process.cwd();
      const [pkgResult, srcResult, configResult] = await Promise.all([
        h.exec("cat package.json 2>/dev/null", cwd),
        h.exec("ls -1 src/ 2>/dev/null || ls -1 lib/ 2>/dev/null || ls -1 app/ 2>/dev/null", cwd),
        h.exec("ls -1 *.json *.config.* .env* tsconfig* 2>/dev/null", cwd),
      ]);

      let pkg: any = null;
      try { pkg = JSON.parse(pkgResult.stdout); } catch {}

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          name: pkg?.name,
          version: pkg?.version,
          scripts: pkg?.scripts ? Object.fromEntries(Object.entries(pkg.scripts).slice(0, 12).map(([name, script]) => [name, truncateText(script, 120)])) : {},
          dependencies: pkg?.dependencies ? Object.keys(pkg.dependencies).slice(0, 30) : [],
          devDependencies: pkg?.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 30) : [],
          sourceFiles: srcResult.stdout.split("\n").filter(l => l.trim()).slice(0, 50),
          configFiles: configResult.stdout.split("\n").filter(l => l.trim()).slice(0, 50),
          totals: {
            scripts: pkg?.scripts ? Object.keys(pkg.scripts).length : 0,
            dependencies: pkg?.dependencies ? Object.keys(pkg.dependencies).length : 0,
            devDependencies: pkg?.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
          },
          hint: "Default overview is compact. Use read_file({path:'package.json', full:true}) for full package metadata.",
        }) }],
      };
    }
  );

  // ── run ───────────────────────────────────────────────────────────────────

  server.tool(
    "run",
    "Run a project task by intent — test, build, lint, dev, typecheck, format. Auto-detects toolchain (bun/npm/pnpm/yarn/cargo/go/make). Saves ~100 tokens vs raw commands.",
    {
      task: z.string().describe("Task to run: test, build, lint, dev, start, typecheck, format, check — or any custom script name from package.json"),
      args: z.string().optional().describe("Extra arguments (e.g., '--watch', 'src/foo.test.ts')"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ task, args, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const { runner, ecosystem } = detectToolchain(workDir);
      const extra = args ? ` ${args}` : "";

      // Map intent to command per ecosystem
      const taskMap: Record<string, Record<string, string>> = {
        rust:    { test: "cargo test", build: "cargo build", lint: "cargo clippy", format: "cargo fmt", check: "cargo check" },
        go:      { test: "go test ./...", build: "go build ./...", lint: "golangci-lint run", format: "gofmt -w .", check: "go vet ./..." },
        python:  { test: "pytest", build: "python -m build", lint: "ruff check .", format: "ruff format .", check: "mypy .", typecheck: "mypy ." },
        ruby:    { test: "bundle exec rake test", build: "bundle exec rake build", lint: "bundle exec rubocop", format: "bundle exec rubocop -a" },
        php:     { test: "composer test", build: "composer build", lint: "composer lint", format: "composer format" },
        elixir:  { test: "mix test", build: "mix compile", lint: "mix credo", format: "mix format", check: "mix dialyzer" },
        dotnet:  { test: "dotnet test", build: "dotnet build", lint: "dotnet format --verify-no-changes", format: "dotnet format", check: "dotnet build --no-incremental" },
        dart:    { test: "dart test", build: "dart compile exe", lint: "dart analyze", format: "dart format ." },
        swift:   { test: "swift test", build: "swift build", lint: "swiftlint", format: "swiftformat ." },
        zig:     { test: "zig build test", build: "zig build" },
        make:    { test: "make test", build: "make build", lint: "make lint", format: "make format", check: "make check" },
      };

      let cmd: string;
      if (ecosystem === "js") {
        const prefix = runner === "yarn" ? "yarn" : `${runner} run`;
        cmd = `${prefix} ${task}${extra}`;
      } else if (taskMap[ecosystem]?.[task]) {
        cmd = `${taskMap[ecosystem][task]}${extra}`;
      } else {
        cmd = `${runner} ${task}${extra}`;
      }

      const result = await h.exec(cmd, workDir, 120000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);
      h.logCall("run", { command: `${task}${args ? ` ${args}` : ""}`, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        task,
        runner,
        summary: processed.summary,
        tokensSaved: processed.tokensSaved,
      }) }] };
    }
  );

  // ── install ───────────────────────────────────────────────────────────────

  server.tool(
    "install",
    "Install packages — auto-detects toolchain for any language. Agent says what to install, we figure out how.",
    {
      packages: z.array(z.string()).describe("Package names to install"),
      dev: z.boolean().optional().describe("Install as dev dependency (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ packages, dev, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const { runner, ecosystem } = detectToolchain(workDir);
      const pkgs = packages.join(" ");

      const installMap: Record<string, { cmd: string; devCmd: string }> = {
        bun:      { cmd: `bun add ${pkgs}`,             devCmd: `bun add -D ${pkgs}` },
        pnpm:     { cmd: `pnpm add ${pkgs}`,            devCmd: `pnpm add -D ${pkgs}` },
        yarn:     { cmd: `yarn add ${pkgs}`,             devCmd: `yarn add --dev ${pkgs}` },
        npm:      { cmd: `npm install ${pkgs}`,          devCmd: `npm install --save-dev ${pkgs}` },
        deno:     { cmd: `deno add ${pkgs}`,             devCmd: `deno add --dev ${pkgs}` },
        cargo:    { cmd: `cargo add ${pkgs}`,            devCmd: `cargo add --dev ${pkgs}` },
        go:       { cmd: `go get ${pkgs}`,               devCmd: `go get ${pkgs}` },
        pip:      { cmd: `pip install ${pkgs}`,          devCmd: `pip install ${pkgs}` },
        poetry:   { cmd: `poetry add ${pkgs}`,           devCmd: `poetry add --group dev ${pkgs}` },
        pipenv:   { cmd: `pipenv install ${pkgs}`,       devCmd: `pipenv install --dev ${pkgs}` },
        bundle:   { cmd: `bundle add ${pkgs}`,           devCmd: `bundle add ${pkgs} --group development` },
        composer: { cmd: `composer require ${pkgs}`,      devCmd: `composer require --dev ${pkgs}` },
        mix:      { cmd: `mix deps.get`,                  devCmd: `mix deps.get` },
        dotnet:   { cmd: `dotnet add package ${pkgs}`,    devCmd: `dotnet add package ${pkgs}` },
        dart:     { cmd: `dart pub add ${pkgs}`,          devCmd: `dart pub add --dev ${pkgs}` },
        swift:    { cmd: `swift package add ${pkgs}`,     devCmd: `swift package add ${pkgs}` },
      };

      const entry = installMap[runner] ?? installMap.npm;
      const cmd = dev ? entry.devCmd : entry.cmd;

      const result = await h.exec(cmd, workDir, 60000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);
      h.logCall("install", { command: cmd, exitCode: result.exitCode, durationMs: Date.now() - start, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        command: cmd,
        summary: processed.summary,
      }) }] };
    }
  );

  // ── status ────────────────────────────────────────────────────────────────

  server.tool(
    "status",
    "Get terminal server status, capabilities, and available parsers.",
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          name: "terminal", version: "3.3.0", cwd: process.cwd(),
          features: ["ai-output-processing", "token-compression", "noise-filtering", "diff-caching", "lazy-execution", "progressive-disclosure"],
        }) }],
      };
    }
  );

  // ── help ──────────────────────────────────────────────────────────────────

  server.tool(
    "help",
    "Get recommendations for which terminal tool to use. Describe what you want to do and get the best tool + usage example.",
    {
      goal: z.string().optional().describe("What you're trying to do (e.g., 'run tests', 'find where login is defined', 'commit my changes')"),
    },
    async ({ goal }) => {
      if (!goal) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          tools: {
            "execute / execute_smart": "Run any command. Smart = AI summary (80% fewer tokens)",
            "run({task})": "Run test/build/lint — auto-detects toolchain",
            "commit / bulk_commit / smart_commit": "Git commit — single, multi, or AI-grouped",
            "diff({ref})": "Show what changed with AI summary",
            "install({packages})": "Add packages — auto-detects bun/npm/pip/cargo",
            "search_content({pattern})": "Grep with structured results",
            "search_files({pattern})": "Find files by glob",
            "symbols({path})": "AI file outline — any language",
            "read_symbol({path, name})": "Read one function/class by name",
            "read_file({path, summarize})": "Read or AI-summarize a file",
            "read_files({files, summarize})": "Multi-file read in one call",
            "symbols_dir({path})": "Symbols for entire directory",
            "review({since})": "AI code review",
            "lookup({file, items})": "Find items in a file by name",
            "edit({file, find, replace})": "Find-replace in file",
            "repo_state": "Git branch + status + log in one call",
            "boot": "Full project context on session start",
            "watch({task})": "Run task on file change",
            "store_secret / list_secrets": "Secrets vault",
            "project_note({save/recall})": "Persistent project notes",
          },
          tips: [
            "Use relative paths — 'src/foo.ts' not '/Users/.../src/foo.ts'",
            "Use your native Read/Write/Edit for file operations when you don't need AI summary",
            "Use search_content for text patterns, symbols for code structure",
            "Use commit for single, bulk_commit for multiple, smart_commit for AI-grouped",
          ],
        }) }] };
      }

      // AI recommends the best tool for the goal
      const provider = getOutputProvider();
      const recommendation = await provider.complete(
        `Agent wants to: ${goal}\n\nAvailable tools: execute, execute_smart, run, commit, bulk_commit, smart_commit, diff, install, search_content, search_files, symbols, read_symbol, read_file, read_files, symbols_dir, review, lookup, edit, repo_state, boot, watch, store_secret, list_secrets, project_note, help`,
        {
          system: `Recommend the best terminal MCP tool for this goal. Return JSON: {"tool": "name", "example": {params}, "why": "one line"}. If multiple tools work, list top 2.`,
          maxTokens: 200, temperature: 0,
        }
      );

      return { content: [{ type: "text" as const, text: recommendation }] };
    }
  );
}
