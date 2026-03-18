// Project tools: boot, project_overview, run, install, status, help

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { processOutput } from "../../output-processor.js";
import { getOutputProvider } from "../../providers/index.js";
import { getBootContext } from "../../session-boot.js";

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
          scripts: pkg?.scripts,
          dependencies: pkg?.dependencies ? Object.keys(pkg.dependencies) : [],
          devDependencies: pkg?.devDependencies ? Object.keys(pkg.devDependencies) : [],
          sourceFiles: srcResult.stdout.split("\n").filter(l => l.trim()),
          configFiles: configResult.stdout.split("\n").filter(l => l.trim()),
        }) }],
      };
    }
  );

  // ── run ───────────────────────────────────────────────────────────────────

  server.tool(
    "run",
    "Run a project task by intent — test, build, lint, dev, typecheck, format. Auto-detects toolchain (bun/npm/pnpm/yarn/cargo/go/make). Saves ~100 tokens vs raw commands.",
    {
      task: z.enum(["test", "build", "lint", "dev", "start", "typecheck", "format", "check"]).describe("What to run"),
      args: z.string().optional().describe("Extra arguments (e.g., '--watch', 'src/foo.test.ts')"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ task, args, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();

      // Detect toolchain from project files
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      let runner = "npm run";
      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) runner = "bun run";
      else if (existsSync(join(workDir, "pnpm-lock.yaml"))) runner = "pnpm run";
      else if (existsSync(join(workDir, "yarn.lock"))) runner = "yarn";
      else if (existsSync(join(workDir, "Cargo.toml"))) runner = "cargo";
      else if (existsSync(join(workDir, "go.mod"))) runner = "go";
      else if (existsSync(join(workDir, "Makefile"))) runner = "make";

      // Map intent to command
      let cmd: string;
      if (runner === "cargo") {
        cmd = `cargo ${task}${args ? ` ${args}` : ""}`;
      } else if (runner === "go") {
        const goMap: Record<string, string> = { test: "go test ./...", build: "go build ./...", lint: "golangci-lint run", format: "gofmt -w .", check: "go vet ./..." };
        cmd = goMap[task] ?? `go ${task}`;
      } else if (runner === "make") {
        cmd = `make ${task}${args ? ` ${args}` : ""}`;
      } else {
        // JS/TS ecosystem
        const jsMap: Record<string, string> = { test: "test", build: "build", lint: "lint", dev: "dev", start: "start", typecheck: "typecheck", format: "format", check: "check" };
        cmd = `${runner} ${jsMap[task] ?? task}${args ? ` ${args}` : ""}`;
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
    "Install packages — auto-detects bun/npm/pnpm/yarn/pip/cargo. Agent says what to install, we figure out how.",
    {
      packages: z.array(z.string()).describe("Package names to install"),
      dev: z.boolean().optional().describe("Install as dev dependency (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ packages, dev, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      let cmd: string;
      const pkgs = packages.join(" ");
      const devFlag = dev ? " -D" : "";

      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) {
        cmd = `bun add${devFlag} ${pkgs}`;
      } else if (existsSync(join(workDir, "pnpm-lock.yaml"))) {
        cmd = `pnpm add${devFlag} ${pkgs}`;
      } else if (existsSync(join(workDir, "yarn.lock"))) {
        cmd = `yarn add${dev ? " --dev" : ""} ${pkgs}`;
      } else if (existsSync(join(workDir, "package.json"))) {
        cmd = `npm install${dev ? " --save-dev" : ""} ${pkgs}`;
      } else if (existsSync(join(workDir, "requirements.txt")) || existsSync(join(workDir, "pyproject.toml"))) {
        cmd = `pip install ${pkgs}`;
      } else if (existsSync(join(workDir, "Cargo.toml"))) {
        cmd = `cargo add ${pkgs}`;
      } else {
        cmd = `npm install${dev ? " --save-dev" : ""} ${pkgs}`;
      }

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
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
      const recommendation = await provider.complete(
        `Agent wants to: ${goal}\n\nAvailable tools: execute, execute_smart, run, commit, bulk_commit, smart_commit, diff, install, search_content, search_files, symbols, read_symbol, read_file, read_files, symbols_dir, review, lookup, edit, repo_state, boot, watch, store_secret, list_secrets, project_note, help`,
        {
          model: outputModel,
          system: `Recommend the best terminal MCP tool for this goal. Return JSON: {"tool": "name", "example": {params}, "why": "one line"}. If multiple tools work, list top 2.`,
          maxTokens: 200, temperature: 0,
        }
      );

      return { content: [{ type: "text" as const, text: recommendation }] };
    }
  );
}
