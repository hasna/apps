import type { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTask } from "../../db/tasks.js";
import { autoProject, output, resolveTaskId } from "../helpers.js";

const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

// --- MCP Registration Helpers ---

function getMcpBinaryPath(): string {
  try {
    const p = execSync("which todos-mcp", { encoding: "utf-8" }).trim();
    if (p) return p;
  } catch {
    // fall through
  }

  const bunBin = join(HOME, ".bun", "bin", "todos-mcp");
  if (existsSync(bunBin)) return bunBin;

  return "todos-mcp";
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function readTomlFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function writeTomlFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
}

function removeTomlBlock(content: string, blockName: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;
  const header = `[${blockName}]`;

  for (const line of lines) {
    if (line.trim() === header) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim().startsWith("[")) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

// --- Claude Code: use `claude mcp add` ---

function registerClaude(binPath: string, global?: boolean): void {
  const scope = global ? "user" : "project";
  const cmd = `claude mcp add --transport stdio --scope ${scope} todos -- ${binPath}`;
  try {
    execSync(cmd, { stdio: "pipe" });
    console.log(chalk.green(`Claude Code (${scope}): registered via 'claude mcp add'`));
  } catch {
    console.log(chalk.yellow(`Claude Code: could not auto-register. Run this command manually:`));
    console.log(chalk.cyan(`  ${cmd}`));
  }
}

function unregisterClaude(_global?: boolean): void {
  try {
    execSync("claude mcp remove todos", { stdio: "pipe" });
    console.log(chalk.green(`Claude Code: removed todos MCP server`));
  } catch {
    console.log(chalk.yellow(`Claude Code: could not auto-remove. Run manually:`));
    console.log(chalk.cyan("  claude mcp remove todos"));
  }
}

// --- Codex CLI: ~/.codex/config.toml ---

function registerCodex(binPath: string): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);
  content = removeTomlBlock(content, "mcp_servers.todos");
  const block = `\n[mcp_servers.todos]\ncommand = "${binPath}"\nargs = []\n`;
  content = content.trimEnd() + "\n" + block;
  writeTomlFile(configPath, content);
  console.log(chalk.green(`Codex CLI: registered in ${configPath}`));
}

function unregisterCodex(): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);
  if (!content.includes("[mcp_servers.todos]")) {
    console.log(chalk.dim(`Codex CLI: todos not found in ${configPath}`));
    return;
  }
  content = removeTomlBlock(content, "mcp_servers.todos");
  writeTomlFile(configPath, content.trimEnd() + "\n");
  console.log(chalk.green(`Codex CLI: unregistered from ${configPath}`));
}

// --- Gemini CLI: ~/.gemini/settings.json ---

function registerGemini(binPath: string): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);
  if (!config["mcpServers"]) {
    config["mcpServers"] = {};
  }
  const servers = config["mcpServers"] as Record<string, unknown>;
  servers["todos"] = {
    command: binPath,
    args: [] as string[],
  };
  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: registered in ${configPath}`));
}

function unregisterGemini(): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);
  const servers = config["mcpServers"] as Record<string, unknown> | undefined;
  if (!servers || !("todos" in servers)) {
    console.log(chalk.dim(`Gemini CLI: todos not found in ${configPath}`));
    return;
  }
  delete servers["todos"];
  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: unregistered from ${configPath}`));
}

// --- Main register/unregister ---

function registerMcp(agent: string, global?: boolean): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];
  const binPath = getMcpBinaryPath();
  for (const a of agents) {
    switch (a) {
      case "claude": registerClaude(binPath, global); break;
      case "codex": registerCodex(binPath); break;
      case "gemini": registerGemini(binPath); break;
      default: console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

function unregisterMcp(agent: string, global?: boolean): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];
  for (const a of agents) {
    switch (a) {
      case "claude": unregisterClaude(global); break;
      case "codex": unregisterCodex(); break;
      case "gemini": unregisterGemini(); break;
      default: console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

export function registerMcpHooksCommands(program: Command) {
  // hooks
  const hooks = program
    .command("hooks")
    .description("Manage Claude Code hook integration");

  hooks
    .command("install")
    .description("Install Claude Code hooks for auto-sync")
    .action(() => {
      let todosBin = "todos";
      try {
        const p = execSync("which todos", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        if (p) todosBin = p;
      } catch { /* use default */ }

      const hooksDir = join(process.cwd(), ".claude", "hooks");
      if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

      const hookScript = `#!/usr/bin/env bash
# Auto-generated by: todos hooks install
# Syncs todos with Claude Code task list on tool use events.
# Uses session_id when available; falls back to project-based task_list_id.

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)
TASK_LIST="\${TODOS_CLAUDE_TASK_LIST:-\${SESSION_ID}}"

TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

case "$TOOL_NAME" in
  TaskCreate|TaskUpdate)
    TODOS_CLAUDE_TASK_LIST="$TASK_LIST" ${todosBin} sync --all --pull 2>/dev/null || true
    ;;
  mcp__todos__*)
    TODOS_CLAUDE_TASK_LIST="$TASK_LIST" ${todosBin} sync --all --push 2>/dev/null || true
    ;;
esac

exit 0
`;
      const hookPath = join(hooksDir, "todos-sync.sh");
      writeFileSync(hookPath, hookScript);
      execSync(`chmod +x "${hookPath}"`);
      console.log(chalk.green(`Hook script created: ${hookPath}`));

      const settingsPath = join(process.cwd(), ".claude", "settings.json");
      const settings = readJsonFile(settingsPath);

      if (!settings["hooks"]) {
        settings["hooks"] = {};
      }
      const hooksConfig = settings["hooks"] as Record<string, unknown>;

      if (!hooksConfig["PostToolUse"]) {
        hooksConfig["PostToolUse"] = [];
      }
      const postToolUse = hooksConfig["PostToolUse"] as Array<Record<string, unknown>>;

      const filtered = postToolUse.filter((group) => {
        const groupHooks = group["hooks"] as Array<Record<string, unknown>> | undefined;
        if (!groupHooks) return true;
        return !groupHooks.some((h) => (h["command"] as string || "").includes("todos-sync.sh"));
      });

      filtered.push({
        matcher: "TaskCreate|TaskUpdate",
        hooks: [{ type: "command", command: hookPath }],
      });
      filtered.push({
        matcher: "mcp__todos__create_task|mcp__todos__update_task|mcp__todos__complete_task|mcp__todos__start_task",
        hooks: [{ type: "command", command: hookPath }],
      });

      hooksConfig["PostToolUse"] = filtered;
      writeJsonFile(settingsPath, settings);
      console.log(chalk.green(`Claude Code hooks configured in: ${settingsPath}`));
      console.log(chalk.dim("Task list ID auto-detected from project."));
    });

  // mcp
  program
    .command("mcp")
    .description("Start MCP server (stdio)")
    .option("--register <agent>", "Register MCP server with an agent (claude, codex, gemini, all)")
    .option("--unregister <agent>", "Unregister MCP server from an agent (claude, codex, gemini, all)")
    .option("-g, --global", "Register/unregister globally (user-level) instead of project-level")
    .action(async (opts) => {
      if (opts.register) {
        registerMcp(opts.register, opts.global);
        return;
      }
      if (opts.unregister) {
        unregisterMcp(opts.unregister, opts.global);
        return;
      }
      await import("../../mcp/index.js");
    });

  // import — GitHub issue import
  program
    .command("import <url>")
    .description("Import a GitHub issue as a task")
    .option("--project <id>", "Project ID")
    .option("--list <id>", "Task list ID")
    .action(async (url: string, opts: { project?: string; list?: string }) => {
      const globalOpts = program.opts();
      const { parseGitHubUrl, fetchGitHubIssue, issueToTask } = await import("../../lib/github.js");
      const parsed = parseGitHubUrl(url);
      if (!parsed) {
        console.error(chalk.red("Invalid GitHub issue URL. Expected: https://github.com/owner/repo/issues/123"));
        process.exit(1);
      }
      try {
        const issue = fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number);
        const projectId = opts.project || autoProject(globalOpts) || undefined;
        const input = issueToTask(issue, { project_id: projectId, task_list_id: opts.list });
        const task = createTask(input);
        if (globalOpts.json) { output(task, true); return; }
        console.log(chalk.green(`Imported GH#${issue.number}: ${issue.title}`));
        console.log(`  ${chalk.dim("Task ID:")} ${task.short_id || task.id}`);
        console.log(`  ${chalk.dim("Labels:")}  ${issue.labels.join(", ") || "none"}`);
        console.log(`  ${chalk.dim("Priority:")} ${task.priority}`);
      } catch (e: any) {
        if (e.message?.includes("gh")) {
          console.error(chalk.red("GitHub CLI (gh) not found or not authenticated. Install: https://cli.github.com"));
        } else {
          console.error(chalk.red(`Import failed: ${e.message}`));
        }
        process.exit(1);
      }
    });

  // link-commit
  program
    .command("link-commit <task-id> <sha>")
    .description("Link a git commit to a task")
    .option("--message <text>", "Commit message")
    .option("--author <name>", "Commit author")
    .option("--files <list>", "Comma-separated list of changed files")
    .action(async (taskId: string, sha: string, opts: { message?: string; author?: string; files?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { linkTaskToCommit } = await import("../../db/task-commits.js");
      const commit = linkTaskToCommit({
        task_id: resolvedId,
        sha,
        message: opts.message,
        author: opts.author,
        files_changed: opts.files ? opts.files.split(",").filter(Boolean) : undefined,
      });
      if (globalOpts.json) { output(commit, true); return; }
      console.log(chalk.green(`Linked commit ${sha.slice(0, 7)} to task ${taskId}`));
    });

  // hook install/uninstall
  const hookCmd = program.command("hook").description("Manage git hooks for auto-linking commits to tasks");

  hookCmd
    .command("install")
    .description("Install post-commit hook that auto-links commits to tasks")
    .action(async () => {
      try {
        const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8" }).trim();
        const hookPath = `${gitDir}/hooks/post-commit`;
        const marker = "# todos-auto-link";

        if (existsSync(hookPath)) {
          const existing = readFileSync(hookPath, "utf-8");
          if (existing.includes(marker)) {
            console.log(chalk.yellow("Hook already installed."));
            return;
          }
          writeFileSync(hookPath, existing + `\n${marker}\n$(dirname "$0")/../../scripts/post-commit-hook.sh\n`);
        } else {
          writeFileSync(hookPath, `#!/usr/bin/env bash\n${marker}\n$(dirname "$0")/../../scripts/post-commit-hook.sh\n`);
          chmodSync(hookPath, 0o755);
        }
        console.log(chalk.green("Post-commit hook installed. Commits with task IDs (e.g. OPE-00042) will auto-link."));
      } catch (e) {
        console.error(chalk.red("Not in a git repository or hook install failed."));
        process.exit(1);
      }
    });

  hookCmd
    .command("uninstall")
    .description("Remove the todos post-commit hook")
    .action(async () => {
      try {
        const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8" }).trim();
        const hookPath = `${gitDir}/hooks/post-commit`;
        const marker = "# todos-auto-link";

        if (!existsSync(hookPath)) {
          console.log(chalk.dim("No post-commit hook found."));
          return;
        }
        const content = readFileSync(hookPath, "utf-8");
        if (!content.includes(marker)) {
          console.log(chalk.dim("Hook not managed by todos."));
          return;
        }
        const cleaned = content.split("\n").filter((l: string) => !l.includes(marker) && !l.includes("post-commit-hook.sh")).join("\n").trim();
        if (cleaned === "#!/usr/bin/env bash" || cleaned === "") {
          (await import("node:fs")).unlinkSync(hookPath);
        } else {
          writeFileSync(hookPath, cleaned + "\n");
        }
        console.log(chalk.green("Post-commit hook removed."));
      } catch (e) {
        console.error(chalk.red("Not in a git repository or hook removal failed."));
        process.exit(1);
      }
    });
}
