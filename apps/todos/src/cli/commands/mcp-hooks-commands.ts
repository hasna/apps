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

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    console.error(chalk.red(`${label} must be valid JSON object`));
    process.exit(1);
  }
}

function listOption(value: string | undefined): string[] | undefined {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

function envOption(value: string | undefined): Record<string, string> | undefined {
  const keys = listOption(value);
  return keys ? Object.fromEntries(keys.map((key) => [key, "set"])) : undefined;
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

  const contracts = program
    .command("contracts")
    .description("Manage local task contracts, acceptance criteria, and review gates");

  contracts
    .command("set <task-id>")
    .description("Set acceptance criteria, required verification, artifacts, files, risk, and done definition")
    .option("--criteria <items>", "Semicolon-separated acceptance criteria")
    .option("--verify <items>", "Semicolon-separated required verification commands")
    .option("--artifact <items>", "Comma-separated expected artifact paths")
    .option("--file <items>", "Comma-separated relevant file paths")
    .option("--risk <level>", "Risk level: low, medium, high, or critical")
    .option("--done <items>", "Semicolon-separated done-definition checklist items")
    .action(async (taskId: string, opts: { criteria?: string; verify?: string; artifact?: string; file?: string; risk?: string; done?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const splitSemi = (value?: string) => value?.split(";").map((item) => item.trim()).filter(Boolean);
      if (opts.risk && !["low", "medium", "high", "critical"].includes(opts.risk)) {
        console.error(chalk.red("--risk must be low, medium, high, or critical"));
        process.exit(1);
      }
      const { setTaskContract } = await import("../../lib/task-contracts.js");
      const contract = setTaskContract({
        task_id: resolvedId,
        acceptance_criteria: splitSemi(opts.criteria),
        verification_commands: splitSemi(opts.verify),
        expected_artifacts: listOption(opts.artifact),
        relevant_files: listOption(opts.file),
        risk_level: opts.risk as Parameters<typeof setTaskContract>[0]["risk_level"],
        done_definition: splitSemi(opts.done),
      });
      if (globalOpts.json) { output(contract, true); return; }
      console.log(chalk.green(`Saved contract for task ${taskId}`));
      if (contract.acceptance_criteria.length > 0) console.log(`  ${chalk.dim("Criteria:")} ${contract.acceptance_criteria.length}`);
      if (contract.verification_commands.length > 0) console.log(`  ${chalk.dim("Required checks:")} ${contract.verification_commands.length}`);
    });

  contracts
    .command("show <task-id>")
    .description("Show the local task contract and review state")
    .action(async (taskId: string) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { getTaskContract, getTaskReview } = await import("../../lib/task-contracts.js");
      const result = { contract: getTaskContract(resolvedId), review: getTaskReview(resolvedId) };
      if (globalOpts.json) { output(result, true); return; }
      if (!result.contract && !result.review) {
        console.log(chalk.dim(`No contract or review state recorded for ${taskId}.`));
        return;
      }
      if (result.contract) {
        console.log(chalk.bold(`Contract: ${taskId}`));
        for (const item of result.contract.acceptance_criteria) console.log(`  - ${item}`);
        if (result.contract.verification_commands.length > 0) console.log(chalk.dim(`  Checks: ${result.contract.verification_commands.join("; ")}`));
      }
      if (result.review) console.log(`${chalk.dim("Review:")} ${result.review.state}${result.review.reviewer ? ` by ${result.review.reviewer}` : ""}`);
    });

  contracts
    .command("request-review <task-id>")
    .description("Request local review for a task")
    .option("--requester <name>", "Requester agent")
    .option("--reviewer <name>", "Reviewer agent or human")
    .option("--notes <text>", "Review notes")
    .action(async (taskId: string, opts: { requester?: string; reviewer?: string; notes?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { requestTaskReview } = await import("../../lib/task-contracts.js");
      const review = requestTaskReview({
        task_id: resolvedId,
        requester: opts.requester || globalOpts.agent || "cli",
        reviewer: opts.reviewer,
        notes: opts.notes,
      });
      if (globalOpts.json) { output(review, true); return; }
      console.log(chalk.green(`Review requested for task ${taskId}`));
    });

  contracts
    .command("review <task-id>")
    .description("Record local review approval, requested changes, or reopen state")
    .requiredOption("--state <state>", "approved, changes_requested, or reopened")
    .option("--reviewer <name>", "Reviewer agent or human")
    .option("--notes <text>", "Review notes")
    .option("--changes <items>", "Semicolon-separated requested changes")
    .action(async (taskId: string, opts: { state: string; reviewer?: string; notes?: string; changes?: string }) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      if (!["approved", "changes_requested", "reopened"].includes(opts.state)) {
        console.error(chalk.red("--state must be approved, changes_requested, or reopened"));
        process.exit(1);
      }
      const { recordTaskReview } = await import("../../lib/task-contracts.js");
      const review = recordTaskReview({
        task_id: resolvedId,
        state: opts.state as Parameters<typeof recordTaskReview>[0]["state"],
        reviewer: opts.reviewer || globalOpts.agent || "cli",
        notes: opts.notes,
        changes_requested: opts.changes?.split(";").map((item) => item.trim()).filter(Boolean),
      });
      if (globalOpts.json) { output(review, true); return; }
      console.log(chalk.green(`Review state for task ${taskId}: ${review.state}`));
    });

  contracts
    .command("check <task-id>")
    .description("Check whether local task evidence satisfies the task contract")
    .action(async (taskId: string) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(taskId);
      const { checkTaskDoneContract } = await import("../../lib/task-contracts.js");
      const result = checkTaskDoneContract(resolvedId);
      if (globalOpts.json) { output(result, true); return; }
      if (result.ok) {
        console.log(chalk.green(`Task ${taskId} satisfies its local contract.`));
        return;
      }
      console.log(chalk.yellow(`Task ${taskId} is missing contract evidence:`));
      for (const missing of result.missing) console.log(`  - ${missing}`);
    });

  const verificationProviders = program
    .command("verify-providers")
    .description("Manage optional local verification provider adapters");

  verificationProviders
    .command("set <name>")
    .description("Create or update a local verification provider")
    .requiredOption("--kind <kind>", "command, testbox, ci_log, browser, or script")
    .option("--command <command>", "Local command template. Supports {task_id}, {agent_id}, {artifact_path}, and {url}")
    .option("--cwd <path>", "Command working directory")
    .option("--capabilities <items>", "Comma-separated capability labels")
    .option("--attempts <n>", "Retry attempts", "1")
    .option("--backoff-ms <n>", "Retry backoff in milliseconds", "0")
    .option("--timeout-ms <n>", "Command timeout in milliseconds")
    .option("--env <json>", "Static provider environment as a JSON object")
    .action(async (name: string, opts: { kind: string; command?: string; cwd?: string; capabilities?: string; attempts?: string; backoffMs?: string; timeoutMs?: string; env?: string }) => {
      const globalOpts = program.opts();
      if (!["command", "testbox", "ci_log", "browser", "script"].includes(opts.kind)) {
        console.error(chalk.red("--kind must be command, testbox, ci_log, browser, or script"));
        process.exit(1);
      }
      const { upsertVerificationProvider } = await import("../../lib/verification-providers.js");
      const provider = upsertVerificationProvider({
        name,
        kind: opts.kind as Parameters<typeof upsertVerificationProvider>[0]["kind"],
        command: opts.command,
        cwd: opts.cwd,
        capabilities: listOption(opts.capabilities),
        retry: { attempts: Number(opts.attempts), backoff_ms: Number(opts.backoffMs) },
        timeout_ms: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
        env: parseJsonOption(opts.env, "--env") as Record<string, string> | undefined,
      });
      if (globalOpts.json) { output(provider, true); return; }
      console.log(chalk.green(`Saved verification provider ${provider.name}`));
    });

  verificationProviders
    .command("list")
    .description("List local verification providers")
    .action(async () => {
      const globalOpts = program.opts();
      const { listVerificationProviders } = await import("../../lib/verification-providers.js");
      const providers = listVerificationProviders();
      if (globalOpts.json) { output(providers, true); return; }
      if (providers.length === 0) {
        console.log(chalk.dim("No verification providers configured."));
        return;
      }
      for (const provider of providers) console.log(`${provider.name.padEnd(12)} ${provider.kind}`);
    });

  verificationProviders
    .command("capabilities <name>")
    .description("Show local verification provider capabilities")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { discoverVerificationProviderCapabilities } = await import("../../lib/verification-providers.js");
      const capabilities = discoverVerificationProviderCapabilities(name);
      if (globalOpts.json) { output(capabilities, true); return; }
      console.log(`${capabilities.name} ${capabilities.kind}: ${capabilities.capabilities.join(", ")}`);
    });

  verificationProviders
    .command("remove <name>")
    .description("Remove a local verification provider")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeVerificationProvider } = await import("../../lib/verification-providers.js");
      const removed = removeVerificationProvider(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Provider removed.") : chalk.dim("No provider matched."));
    });

  verificationProviders
    .command("run <name>")
    .description("Run a local verification provider and optionally record task evidence")
    .option("--task <id>", "Task ID to record verification evidence against")
    .option("--agent <name>", "Agent running the provider")
    .option("--command <command>", "Override provider command for this run")
    .option("--cwd <path>", "Command working directory")
    .option("--log <text>", "CI log text to classify")
    .option("--log-file <path>", "CI log file to classify")
    .option("--artifact <path>", "Local artifact or screenshot path")
    .option("--url <url>", "Browser URL label")
    .option("--metadata <json>", "Additional run metadata")
    .action(async (name: string, opts: { task?: string; agent?: string; command?: string; cwd?: string; log?: string; logFile?: string; artifact?: string; url?: string; metadata?: string }) => {
      const globalOpts = program.opts();
      const { runVerificationProvider } = await import("../../lib/verification-providers.js");
      const result = await runVerificationProvider({
        name,
        task_id: opts.task ? resolveTaskId(opts.task) : undefined,
        agent_id: opts.agent || globalOpts.agent,
        command: opts.command,
        cwd: opts.cwd,
        log_text: opts.log,
        log_path: opts.logFile,
        artifact_path: opts.artifact,
        url: opts.url,
        metadata: parseJsonOption(opts.metadata, "--metadata"),
      });
      if (globalOpts.json) { output(result, true); return; }
      console.log(`${result.status} ${result.provider}: ${result.output_summary || ""}`);
    });

  const runs = program
    .command("runs")
    .description("Manage the local run ledger and evidence capture");

  runs
    .command("start <task-id>")
    .description("Start a local run ledger entry for a task")
    .option("--agent <name>", "Agent starting the run")
    .option("--title <text>", "Run title")
    .option("--summary <text>", "Run summary")
    .option("--metadata <json>", "Additional JSON metadata")
    .option("--claim", "Claim/start the task for the agent before recording the run")
    .action(async (taskId: string, opts: { agent?: string; title?: string; summary?: string; metadata?: string; claim?: boolean }) => {
      const globalOpts = program.opts();
      const { startTaskRun } = await import("../../db/task-runs.js");
      const run = startTaskRun({
        task_id: resolveTaskId(taskId),
        agent_id: opts.agent || globalOpts.agent,
        title: opts.title,
        summary: opts.summary,
        metadata: parseJsonOption(opts.metadata, "--metadata"),
        claim: opts.claim,
      });
      if (globalOpts.json) { output(run, true); return; }
      console.log(chalk.green(`Started run ${run.id.slice(0, 8)} for task ${taskId}`));
    });

  runs
    .command("list [task-id]")
    .description("List local run ledger entries")
    .action(async (taskId?: string) => {
      const globalOpts = program.opts();
      const { listTaskRuns } = await import("../../db/task-runs.js");
      const taskRuns = listTaskRuns(taskId ? resolveTaskId(taskId) : undefined);
      if (globalOpts.json) { output(taskRuns, true); return; }
      if (taskRuns.length === 0) {
        console.log(chalk.dim("No runs recorded."));
        return;
      }
      for (const run of taskRuns) {
        console.log(`${chalk.yellow(run.id.slice(0, 8))} ${run.status.padEnd(9)} ${run.title || run.summary || run.task_id}`);
      }
    });

  runs
    .command("show <run-id>")
    .description("Show a run ledger with events, commands, files, and artifacts")
    .action(async (runId: string) => {
      const globalOpts = program.opts();
      const { getTaskRunLedger } = await import("../../db/task-runs.js");
      const ledger = getTaskRunLedger(runId);
      if (globalOpts.json) { output(ledger, true); return; }
      console.log(chalk.bold(`Run ${ledger.run.id.slice(0, 8)} ${ledger.run.status}`));
      console.log(chalk.dim(`Task: ${ledger.run.task_id}`));
      if (ledger.run.summary) console.log(ledger.run.summary);
      if (ledger.events.length > 0) {
        console.log(chalk.bold("\nEvents:"));
        for (const event of ledger.events) console.log(`  ${event.event_type.padEnd(9)} ${event.message || ""}`);
      }
      if (ledger.commands.length > 0) {
        console.log(chalk.bold("\nCommands:"));
        for (const command of ledger.commands) console.log(`  ${command.status.padEnd(7)} ${command.command}${command.output_summary ? chalk.dim(` — ${command.output_summary}`) : ""}`);
      }
      if (ledger.files.length > 0) {
        console.log(chalk.bold("\nFiles:"));
        for (const file of ledger.files) console.log(`  [${file.status}] ${file.path}`);
      }
      if (ledger.artifacts.length > 0) {
        console.log(chalk.bold("\nArtifacts:"));
        for (const artifact of ledger.artifacts) console.log(`  ${artifact.artifact_type || "artifact"} ${artifact.path}${artifact.description ? chalk.dim(` — ${artifact.description}`) : ""}`);
      }
    });

  runs
    .command("simulate <fixture>")
    .description("Dry-run replay a recorded context pack or run fixture without mutating local state")
    .option("--agent <name>", "Agent identity to include in the simulation")
    .option("--scenario <name>", "Scenario label for the deterministic replay")
    .option("--format <format>", "Output format: json or markdown", "json")
    .action(async (fixture: string, opts: { agent?: string; scenario?: string; format?: string }) => {
      const globalOpts = program.opts();
      const format = globalOpts.json ? "json" : opts.format || "json";
      if (format !== "json" && format !== "markdown") {
        console.error(chalk.red("--format must be json or markdown"));
        process.exit(1);
      }
      const { renderAgentReplaySimulationMarkdown, simulateAgentReplayFile } = await import("../../lib/agent-replay-simulator.js");
      const simulation = simulateAgentReplayFile(fixture, { agent_id: opts.agent || globalOpts.agent, scenario: opts.scenario });
      if (format === "json") { output(simulation, true); return; }
      console.log(renderAgentReplaySimulationMarkdown(simulation));
    });

  runs
    .command("event <run-id> <type> [message]")
    .description("Record a progress, comment, claim, or generic run event")
    .option("--agent <name>", "Agent recording the event")
    .option("--data <json>", "Additional JSON event data")
    .action(async (runId: string, type: string, message: string | undefined, opts: { agent?: string; data?: string }) => {
      const globalOpts = program.opts();
      const allowed = ["started", "progress", "claim", "comment", "command", "file", "artifact", "completed", "failed", "cancelled"];
      if (!allowed.includes(type)) {
        console.error(chalk.red(`type must be one of: ${allowed.join(", ")}`));
        process.exit(1);
      }
      const { addTaskRunEvent } = await import("../../db/task-runs.js");
      const event = addTaskRunEvent({
        run_id: runId,
        event_type: type as any,
        message,
        data: parseJsonOption(opts.data, "--data"),
        agent_id: opts.agent || globalOpts.agent,
      });
      if (globalOpts.json) { output(event, true); return; }
      console.log(chalk.green(`Recorded ${event.event_type} event for run ${event.run_id.slice(0, 8)}`));
    });

  runs
    .command("command <run-id> <command>")
    .description("Record command/test evidence for a run")
    .option("--status <status>", "Command status: passed, failed, or unknown", "unknown")
    .option("--exit-code <code>", "Process exit code")
    .option("--summary <text>", "Short output summary")
    .option("--artifact <path>", "Optional local artifact/log path")
    .option("--sandbox <name>", "Runner sandbox profile to check before recording")
    .option("--cwd <path>", "Command working directory for sandbox checks")
    .option("--write <list>", "Comma-separated write paths for sandbox checks")
    .option("--env <list>", "Comma-separated environment keys for sandbox checks")
    .option("--network", "Request network access for sandbox checks")
    .option("--agent <name>", "Agent that ran the command")
    .action(async (runId: string, command: string, opts: { status?: string; exitCode?: string; summary?: string; artifact?: string; sandbox?: string; cwd?: string; write?: string; env?: string; network?: boolean; agent?: string }) => {
      const globalOpts = program.opts();
      if (opts.status !== "passed" && opts.status !== "failed" && opts.status !== "unknown") {
        console.error(chalk.red("--status must be passed, failed, or unknown"));
        process.exit(1);
      }
      if (opts.sandbox) {
        const { checkRunnerSandbox } = await import("../../lib/runner-sandbox.js");
        const check = checkRunnerSandbox({
          name: opts.sandbox,
          cwd: opts.cwd,
          command,
          write_paths: listOption(opts.write),
          env: envOption(opts.env),
          network: opts.network,
        });
        if (!check.allowed) {
          if (globalOpts.json) { output(check, true); return; }
          console.error(chalk.red(`Command denied by sandbox ${opts.sandbox}:`));
          for (const reason of check.reasons) console.error(`  - ${reason}`);
          process.exit(1);
        }
      }
      const { addTaskRunCommand } = await import("../../db/task-runs.js");
      const evidence = addTaskRunCommand({
        run_id: runId,
        command,
        status: opts.status,
        exit_code: opts.exitCode !== undefined ? Number.parseInt(opts.exitCode, 10) : undefined,
        output_summary: opts.summary,
        artifact_path: opts.artifact,
        agent_id: opts.agent || globalOpts.agent,
      });
      if (globalOpts.json) { output(evidence, true); return; }
      console.log(chalk.green(`Recorded ${evidence.status} command for run ${runId.slice(0, 8)}`));
    });

  runs
    .command("file <run-id> <path>")
    .description("Record a file touched by a run")
    .option("--status <status>", "File status: planned, active, modified, reviewed, or removed", "modified")
    .option("--note <text>", "Why the file was touched")
    .option("--agent <name>", "Agent touching the file")
    .action(async (runId: string, path: string, opts: { status?: string; note?: string; agent?: string }) => {
      const globalOpts = program.opts();
      const allowed = ["planned", "active", "modified", "reviewed", "removed"];
      if (!allowed.includes(opts.status || "modified")) {
        console.error(chalk.red(`--status must be one of: ${allowed.join(", ")}`));
        process.exit(1);
      }
      const { addTaskRunFile } = await import("../../db/task-runs.js");
      const file = addTaskRunFile({
        run_id: runId,
        path,
        status: opts.status as any,
        note: opts.note,
        agent_id: opts.agent || globalOpts.agent,
      });
      if (globalOpts.json) { output(file, true); return; }
      console.log(chalk.green(`Recorded file ${file.path} for run ${runId.slice(0, 8)}`));
    });

  runs
    .command("artifact <run-id> <path>")
    .description("Record a local artifact for a run in the content-addressed store")
    .option("--type <type>", "Artifact type, e.g. log, screenshot, report")
    .option("--description <text>", "Artifact description")
    .option("--size <bytes>", "Size in bytes")
    .option("--sha256 <hash>", "SHA-256 checksum")
    .option("--metadata <json>", "Additional JSON metadata")
    .option("--no-store", "Record metadata only and do not copy local content")
    .option("--require-file", "Fail if the artifact file cannot be stored")
    .option("--retention-days <days>", "Retention period for stored content metadata")
    .option("--agent <name>", "Agent adding the artifact")
    .action(async (runId: string, path: string, opts: { type?: string; description?: string; size?: string; sha256?: string; metadata?: string; store?: boolean; requireFile?: boolean; retentionDays?: string; agent?: string }) => {
      const globalOpts = program.opts();
      const { addTaskRunArtifact } = await import("../../db/task-runs.js");
      const artifact = addTaskRunArtifact({
        run_id: runId,
        path,
        artifact_type: opts.type,
        description: opts.description,
        size_bytes: opts.size !== undefined ? Number.parseInt(opts.size, 10) : undefined,
        sha256: opts.sha256,
        metadata: parseJsonOption(opts.metadata, "--metadata"),
        store_content: opts.requireFile ? true : opts.store,
        retention_days: opts.retentionDays !== undefined ? Number.parseInt(opts.retentionDays, 10) : undefined,
        agent_id: opts.agent || globalOpts.agent,
      });
      if (globalOpts.json) { output(artifact, true); return; }
      const stored = artifact.metadata["artifact_store"] ? "stored" : "metadata only";
      console.log(chalk.green(`Recorded artifact ${artifact.path} for run ${runId.slice(0, 8)} (${stored})`));
    });

  runs
    .command("artifact-verify <run-id>")
    .description("Verify locally stored run artifact content against recorded checksums")
    .action(async (runId: string) => {
      const globalOpts = program.opts();
      const { verifyTaskRunArtifacts } = await import("../../db/task-runs.js");
      const reports = verifyTaskRunArtifacts(runId);
      if (globalOpts.json) { output(reports, true); return; }
      for (const report of reports) {
        const color = report.status === "ok" || report.status === "metadata_only" ? chalk.green : chalk.red;
        console.log(color(`${report.status.padEnd(13)} ${report.path} ${report.message}`));
      }
      if (reports.some(report => report.status === "missing" || report.status === "mismatch")) {
        process.exit(1);
      }
    });

  runs
    .command("finish <run-id>")
    .description("Finish a run ledger entry")
    .option("--status <status>", "completed, failed, or cancelled", "completed")
    .option("--summary <text>", "Final summary")
    .option("--agent <name>", "Agent finishing the run")
    .action(async (runId: string, opts: { status?: string; summary?: string; agent?: string }) => {
      const globalOpts = program.opts();
      if (opts.status !== "completed" && opts.status !== "failed" && opts.status !== "cancelled") {
        console.error(chalk.red("--status must be completed, failed, or cancelled"));
        process.exit(1);
      }
      const { finishTaskRun } = await import("../../db/task-runs.js");
      const run = finishTaskRun({ run_id: runId, status: opts.status, summary: opts.summary, agent_id: opts.agent || globalOpts.agent });
      if (globalOpts.json) { output(run, true); return; }
      console.log(chalk.green(`Finished run ${run.id.slice(0, 8)} as ${run.status}`));
    });

  const agentRuns = program
    .command("agent-runs")
    .description("Queue and dispatch local agent runs");

  agentRuns
    .command("adapter-set <name>")
    .description("Create or update a local agent run adapter")
    .option("--command <command>", "Local command template. Supports {task_id}, {run_id}, and {agent_id}")
    .option("--sandbox <name>", "Runner sandbox profile to check before launch")
    .option("--cwd <path>", "Command working directory")
    .option("--env <json>", "Static adapter environment as a JSON object")
    .action(async (name: string, opts: { command?: string; sandbox?: string; cwd?: string; env?: string }) => {
      const globalOpts = program.opts();
      if (!opts.command) {
        console.error(chalk.red("--command is required"));
        process.exit(1);
      }
      const { upsertAgentRunAdapter } = await import("../../lib/agent-run-dispatcher.js");
      const adapter = upsertAgentRunAdapter({
        name,
        command: opts.command,
        sandbox: opts.sandbox,
        cwd: opts.cwd,
        env: parseJsonOption(opts.env, "--env") as Record<string, string> | undefined,
      });
      if (globalOpts.json) { output(adapter, true); return; }
      console.log(chalk.green(`Saved agent run adapter ${adapter.name}`));
    });

  agentRuns
    .command("adapters")
    .description("List local agent run adapters")
    .action(async () => {
      const globalOpts = program.opts();
      const { listAgentRunAdapters } = await import("../../lib/agent-run-dispatcher.js");
      const adapters = listAgentRunAdapters();
      if (globalOpts.json) { output(adapters, true); return; }
      if (adapters.length === 0) {
        console.log(chalk.dim("No agent run adapters configured."));
        return;
      }
      for (const adapter of adapters) console.log(`${adapter.name.padEnd(12)} ${adapter.command}`);
    });

  agentRuns
    .command("adapter-remove <name>")
    .description("Remove a local agent run adapter")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeAgentRunAdapter } = await import("../../lib/agent-run-dispatcher.js");
      const removed = removeAgentRunAdapter(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Adapter removed.") : chalk.dim("No adapter matched."));
    });

  agentRuns
    .command("queue <task-id>")
    .description("Queue a local agent run for a task")
    .option("--adapter <name>", "Configured adapter name")
    .option("--command <command>", "Custom command template")
    .option("--sandbox <name>", "Runner sandbox profile")
    .option("--cwd <path>", "Command working directory")
    .option("--agent <name>", "Agent identity for the run")
    .option("--title <text>", "Run title")
    .option("--summary <text>", "Run summary")
    .option("--metadata <json>", "Additional metadata")
    .option("--claim", "Claim/start the task before queueing")
    .action(async (taskId: string, opts: { adapter?: string; command?: string; sandbox?: string; cwd?: string; agent?: string; title?: string; summary?: string; metadata?: string; claim?: boolean }) => {
      const globalOpts = program.opts();
      const { queueAgentRun } = await import("../../lib/agent-run-dispatcher.js");
      const queued = queueAgentRun({
        task_id: resolveTaskId(taskId),
        adapter: opts.adapter,
        command: opts.command,
        sandbox: opts.sandbox,
        cwd: opts.cwd,
        agent_id: opts.agent || globalOpts.agent,
        title: opts.title,
        summary: opts.summary,
        metadata: parseJsonOption(opts.metadata, "--metadata"),
        claim: opts.claim,
      });
      if (globalOpts.json) { output(queued, true); return; }
      console.log(chalk.green(`Queued agent run ${queued.run.id.slice(0, 8)} for task ${taskId}`));
    });

  agentRuns
    .command("list")
    .description("List queued local agent runs")
    .action(async () => {
      const globalOpts = program.opts();
      const { listAgentRunQueue } = await import("../../lib/agent-run-dispatcher.js");
      const queue = listAgentRunQueue();
      if (globalOpts.json) { output(queue, true); return; }
      if (queue.length === 0) {
        console.log(chalk.dim("No agent runs queued."));
        return;
      }
      for (const item of queue) console.log(`${item.run.id.slice(0, 8)} ${item.dispatcher.state.padEnd(9)} ${item.dispatcher.adapter || "custom"} ${item.run.task_id}`);
    });

  agentRuns
    .command("run-next")
    .description("Run the next queued local agent dispatch")
    .option("--adapter <name>", "Only run queue entries for this adapter")
    .option("--dry-run", "Return the command that would run without executing it")
    .action(async (opts: { adapter?: string; dryRun?: boolean }) => {
      const globalOpts = program.opts();
      const { runNextAgentDispatch } = await import("../../lib/agent-run-dispatcher.js");
      const result = await runNextAgentDispatch({ adapter: opts.adapter, dry_run: opts.dryRun });
      if (globalOpts.json) { output(result, true); return; }
      if (!result) {
        console.log(chalk.dim("No queued agent run matched."));
        return;
      }
      console.log(`${result.status} ${result.run_id.slice(0, 8)} ${result.command}`);
    });

  agentRuns
    .command("cancel <run-id>")
    .description("Cancel a queued or running local agent dispatch")
    .action(async (runId: string) => {
      const globalOpts = program.opts();
      const { cancelAgentRunDispatch } = await import("../../lib/agent-run-dispatcher.js");
      const result = cancelAgentRunDispatch(runId);
      if (globalOpts.json) { output(result, true); return; }
      console.log(chalk.yellow(`Cancelled agent run ${result.run.id.slice(0, 8)}`));
    });

  agentRuns
    .command("retry <run-id>")
    .description("Queue a retry for a previous local agent dispatch")
    .action(async (runId: string) => {
      const globalOpts = program.opts();
      const { retryAgentRunDispatch } = await import("../../lib/agent-run-dispatcher.js");
      const result = retryAgentRunDispatch(runId);
      if (globalOpts.json) { output(result, true); return; }
      console.log(chalk.green(`Queued retry ${result.run.id.slice(0, 8)} for ${runId}`));
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
