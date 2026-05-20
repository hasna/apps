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

  program
    .command("find-commit <sha>")
    .description("Find which task explains a git commit SHA")
    .action(async (sha: string) => {
      const globalOpts = program.opts();
      const { findTaskByCommit } = await import("../../db/task-commits.js");
      const { getTask } = await import("../../db/tasks.js");
      const result = findTaskByCommit(sha);
      if (globalOpts.json) {
        output(result, true);
        return;
      }
      if (!result) {
        console.log(chalk.dim(`No task linked to commit ${sha}.`));
        return;
      }
      const task = getTask(result.task_id);
      const taskLabel = task ? `${task.short_id || task.id.slice(0, 8)} ${task.title}` : result.task_id;
      console.log(`${chalk.yellow(result.commit.sha.slice(0, 7))} -> ${chalk.cyan(taskLabel)}`);
      if (result.commit.message) console.log(chalk.dim(`  ${result.commit.message}`));
    });

  program
    .command("link-ref <task-id> <ref>")
    .description("Link a git branch or pull request to a task")
    .option("--type <type>", "Ref type: branch or pull_request", "branch")
    .option("--url <url>", "Remote URL for the branch or pull request")
    .option("--provider <name>", "Provider name, e.g. git or github")
    .option("--metadata <json>", "Additional JSON metadata")
    .action(async (taskId: string, ref: string, opts: { type?: string; url?: string; provider?: string; metadata?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { linkTaskGitRef } = await import("../../db/task-commits.js");
      const refType = opts.type === "pr" ? "pull_request" : opts.type;
      if (refType !== "branch" && refType !== "pull_request") {
        console.error(chalk.red("--type must be branch, pr, or pull_request"));
        process.exit(1);
      }
      let metadata: Record<string, unknown> | undefined;
      if (opts.metadata) {
        try {
          metadata = JSON.parse(opts.metadata) as Record<string, unknown>;
        } catch {
          console.error(chalk.red("--metadata must be valid JSON"));
          process.exit(1);
        }
      }
      const gitRef = linkTaskGitRef({
        task_id: resolvedId,
        ref_type: refType,
        name: ref,
        url: opts.url,
        provider: opts.provider,
        metadata,
      });
      if (globalOpts.json) { output(gitRef, true); return; }
      console.log(chalk.green(`Linked ${gitRef.ref_type} ${gitRef.name} to task ${taskId}`));
    });

  program
    .command("find-ref <ref>")
    .description("Find tasks linked to a git branch or pull request")
    .action(async (ref: string) => {
      const globalOpts = program.opts();
      const { findTasksByGitRef } = await import("../../db/task-commits.js");
      const { getTask } = await import("../../db/tasks.js");
      const refs = findTasksByGitRef(ref);
      if (globalOpts.json) {
        output(refs, true);
        return;
      }
      if (refs.length === 0) {
        console.log(chalk.dim(`No tasks linked to ${ref}.`));
        return;
      }
      for (const gitRef of refs) {
        const task = getTask(gitRef.task_id);
        const label = task ? `${task.short_id || task.id.slice(0, 8)} ${task.title}` : gitRef.task_id;
        const url = gitRef.url ? chalk.dim(` ${gitRef.url}`) : "";
        console.log(`${chalk.cyan(label)} <- ${gitRef.ref_type} ${chalk.yellow(gitRef.name)}${url}`);
      }
    });

  program
    .command("record-verification <task-id> <command>")
    .description("Record a verification command and result for a task")
    .option("--status <status>", "Verification status: passed, failed, or unknown", "unknown")
    .option("--summary <text>", "Short output summary")
    .option("--artifact <path>", "Artifact or log path")
    .option("--agent <name>", "Agent that ran the command")
    .action(async (taskId: string, command: string, opts: { status?: string; summary?: string; artifact?: string; agent?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      if (opts.status !== "passed" && opts.status !== "failed" && opts.status !== "unknown") {
        console.error(chalk.red("--status must be passed, failed, or unknown"));
        process.exit(1);
      }
      const { addTaskVerification } = await import("../../db/task-commits.js");
      const verification = addTaskVerification({
        task_id: resolvedId,
        command,
        status: opts.status,
        output_summary: opts.summary,
        artifact_path: opts.artifact,
        agent_id: opts.agent,
      });
      if (globalOpts.json) { output(verification, true); return; }
      console.log(chalk.green(`Recorded ${verification.status} verification for task ${taskId}`));
    });

  program
    .command("trace <task-id>")
    .description("Show local git refs, commits, changed files, and verification commands for a task")
    .action(async (taskId: string) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { getTaskTraceability } = await import("../../db/task-commits.js");
      const { getTask } = await import("../../db/tasks.js");
      const { listTaskFiles } = await import("../../db/task-files.js");
      const task = getTask(resolvedId);
      const trace = {
        task,
        ...getTaskTraceability(resolvedId),
        files: listTaskFiles(resolvedId),
      };
      if (globalOpts.json) {
        output(trace, true);
        return;
      }
      console.log(chalk.bold(`Trace: ${task?.short_id || resolvedId.slice(0, 8)} ${task?.title || ""}\n`));
      if (trace.git_refs.length > 0) {
        console.log(chalk.bold("Git refs:"));
        for (const ref of trace.git_refs) console.log(`  ${ref.ref_type} ${chalk.yellow(ref.name)}${ref.url ? ` ${chalk.dim(ref.url)}` : ""}`);
      }
      if (trace.commits.length > 0) {
        console.log(chalk.bold("\nCommits:"));
        for (const commit of trace.commits) console.log(`  ${chalk.yellow(commit.sha.slice(0, 7))} ${commit.message || ""}`);
      }
      if (trace.files.length > 0) {
        console.log(chalk.bold("\nFiles:"));
        for (const file of trace.files) console.log(`  [${file.status}] ${file.path}`);
      }
      if (trace.verifications.length > 0) {
        console.log(chalk.bold("\nVerifications:"));
        for (const verification of trace.verifications) {
          const summary = verification.output_summary ? chalk.dim(` — ${verification.output_summary}`) : "";
          console.log(`  ${verification.status} ${verification.command}${summary}`);
        }
      }
      if (trace.git_refs.length === 0 && trace.commits.length === 0 && trace.files.length === 0 && trace.verifications.length === 0) {
        console.log(chalk.dim("No local traceability links recorded."));
      }
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
