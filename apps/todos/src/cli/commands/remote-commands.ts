import type { Command } from "commander";
import chalk from "chalk";
import { TodosClient } from "../../sdk/client.js";
import {
  getRemoteApiConfig,
  loadConfig,
  normalizeApiUrl,
  updateConfig,
} from "../../lib/config.js";

type TaskLike = {
  id: string;
  short_id?: string | null;
  title: string;
  status?: string;
  priority?: string;
  assigned_to?: string | null;
};

function redact(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) console.log(JSON.stringify(data, null, 2));
}

function formatTaskLine(task: TaskLike): string {
  const id = task.short_id || task.id.slice(0, 8);
  const status = task.status || "unknown";
  const priority = task.priority || "medium";
  const assigned = task.assigned_to ? ` -> ${task.assigned_to}` : "";
  return `${chalk.dim(id)} ${status.padEnd(11)} ${priority.padEnd(8)} ${task.title}${assigned}`;
}

function remoteClient(): TodosClient {
  const remote = getRemoteApiConfig();
  if (remote.mode !== "remote" || !remote.apiUrl) {
    console.error(chalk.red("Remote mode requires TODOS_API_URL or todos config --set apiUrl=<url>."));
    process.exit(1);
  }
  return new TodosClient({ baseUrl: remote.apiUrl, apiKey: remote.apiKey || undefined });
}

function parseTags(tags: string | undefined): string[] | undefined {
  return tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;
}

function parseSetArg(raw: string): [string, string] {
  const index = raw.indexOf("=");
  if (index <= 0) {
    console.error(chalk.red("Expected --set key=value."));
    process.exit(1);
  }
  return [raw.slice(0, index), raw.slice(index + 1)];
}

function printableRemoteConfig() {
  const remote = getRemoteApiConfig();
  return {
    mode: remote.mode,
    apiUrl: remote.apiUrl,
    apiKey: redact(remote.apiKey),
    source: remote.source,
  };
}

export function registerRemoteCommands(program: Command): void {
  program
    .description("Remote todos client for hosted compatible APIs")
    .addHelpText("after", "\nRemote mode uses TODOS_API_URL/config apiUrl and TODOS_API_KEY/config apiKey. Local SQLite is not initialized.");

  program
    .command("login")
    .description("Configure remote API URL and API key")
    .option("--api-url <url>", "Hosted todos API URL")
    .option("--api-key <key>", "API key/token")
    .action((opts) => {
      const apiUrl = normalizeApiUrl(opts.apiUrl);
      const patch: { mode: "remote"; apiUrl?: string; apiKey?: string } = { mode: "remote" };
      if (apiUrl) patch.apiUrl = apiUrl;
      if (opts.apiKey) patch.apiKey = opts.apiKey;
      const next = updateConfig(patch);
      const globalOpts = program.opts();
      if (globalOpts.json) {
        output({ mode: next.mode, apiUrl: next.apiUrl ?? null, apiKey: redact(next.apiKey) }, true);
      } else {
        console.log(chalk.green("Remote todos configured."));
        if (next.apiUrl) console.log(chalk.dim(`  API: ${next.apiUrl}`));
        console.log(chalk.dim(`  API key: ${redact(next.apiKey) || "(not configured)"}`));
      }
    });

  program
    .command("logout")
    .description("Remove stored remote API key and return to local mode")
    .action(() => {
      const current = loadConfig();
      const next = updateConfig({ ...current, mode: "local", apiKey: undefined });
      const globalOpts = program.opts();
      if (globalOpts.json) output({ mode: next.mode ?? "local", apiKey: null }, true);
      else console.log(chalk.green("Remote API key removed. Local mode restored."));
    });

  program
    .command("config")
    .description("View or update remote configuration")
    .option("--get <key>", "Get a config value")
    .option("--set <key=value>", "Set apiUrl, apiKey, or mode")
    .action((opts) => {
      const globalOpts = program.opts();
      if (opts.set) {
        const [key, value] = parseSetArg(opts.set);
        if (!["apiUrl", "apiKey", "mode"].includes(key)) {
          console.error(chalk.red(`Unsupported remote config key: ${key}`));
          process.exit(1);
        }
        if (key === "mode" && value !== "local" && value !== "remote") {
          console.error(chalk.red("mode must be local or remote."));
          process.exit(1);
        }
        const patch = key === "apiUrl"
          ? { apiUrl: normalizeApiUrl(value) || undefined, mode: "remote" as const }
          : key === "apiKey"
            ? { apiKey: value }
            : { mode: value as "local" | "remote" };
        const next = updateConfig(patch);
        if (globalOpts.json) output({ ...next, apiKey: redact(next.apiKey) }, true);
        else console.log(chalk.green(`Set ${key}.`));
        return;
      }

      const printable = printableRemoteConfig();
      if (opts.get) {
        const value = (printable as Record<string, unknown>)[opts.get];
        if (globalOpts.json) output(value ?? null, true);
        else console.log(value ?? "");
        return;
      }
      if (globalOpts.json) output(printable, true);
      else console.log(JSON.stringify(printable, null, 2));
    });

  program
    .command("add <title>")
    .description("Create a new remote task")
    .option("-d, --description <text>", "Task description")
    .option("-p, --priority <level>", "Priority: low, medium, high, critical")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--tag <tags>", "Comma-separated tags (alias for --tags)")
    .option("--plan <id>", "Assign to a plan")
    .option("--assign <agent>", "Assign to agent")
    .option("--project <id>", "Assign to project")
    .action(async (title: string, opts) => {
      const globalOpts = program.opts();
      const task = await remoteClient().tasks.create({
        title,
        description: opts.description,
        priority: opts.priority,
        project_id: opts.project || globalOpts.project,
        plan_id: opts.plan,
        assigned_to: opts.assign,
        tags: parseTags(opts.tags || opts.tag),
      } as never);
      if (globalOpts.json) output(task, true);
      else {
        console.log(chalk.green("Task created:"));
        console.log(formatTaskLine(task));
      }
    });

  program
    .command("list")
    .description("List remote tasks")
    .option("-s, --status <status>", "Filter by status")
    .option("-p, --priority <priority>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--project <id>", "Filter by project")
    .option("--limit <n>", "Max tasks to return")
    .option("--format <fmt>", "Output format: table, compact, json")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const tasks = await remoteClient().tasks.list({
        status: opts.status,
        project_id: opts.project || globalOpts.project,
        assigned_to: opts.assigned,
        limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
      });
      const filtered = opts.priority ? tasks.filter((task) => task.priority === opts.priority) : tasks;
      const fmt = opts.format || (globalOpts.json ? "json" : "table");
      if (fmt === "json") {
        output(filtered, true);
      } else if (fmt === "compact") {
        for (const task of filtered) process.stdout.write(`${formatTaskLine(task)}\n`);
      } else if (filtered.length === 0) {
        console.log(chalk.dim("No tasks found."));
      } else {
        console.log(chalk.bold(`${filtered.length} task(s):\n`));
        for (const task of filtered) console.log(formatTaskLine(task));
      }
    });

  program
    .command("show <id>")
    .description("Show a remote task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const task = await remoteClient().tasks.get(id);
      if (globalOpts.json) output(task, true);
      else console.log(JSON.stringify(task, null, 2));
    });

  program
    .command("update <id>")
    .description("Update a remote task")
    .option("--title <text>", "New title")
    .option("-d, --description <text>", "New description")
    .option("-s, --status <status>", "New status")
    .option("-p, --priority <priority>", "New priority")
    .option("--assign <agent>", "Assign to agent")
    .option("--tags <tags>", "New tags")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const patch: Record<string, unknown> = {};
      if (opts.title !== undefined) patch["title"] = opts.title;
      if (opts.description !== undefined) patch["description"] = opts.description;
      if (opts.status !== undefined) patch["status"] = opts.status;
      if (opts.priority !== undefined) patch["priority"] = opts.priority;
      if (opts.assign !== undefined) patch["assigned_to"] = opts.assign;
      if (opts.tags !== undefined) patch["tags"] = parseTags(opts.tags);
      const task = await remoteClient().tasks.update(id, patch);
      if (globalOpts.json) output(task, true);
      else {
        console.log(chalk.green("Task updated:"));
        console.log(formatTaskLine(task));
      }
    });

  program
    .command("start <id>")
    .description("Start a remote task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const task = await remoteClient().tasks.start(id, globalOpts.agent);
      if (globalOpts.json) output(task, true);
      else console.log(formatTaskLine(task));
    });

  program
    .command("done <id>")
    .description("Complete a remote task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const task = await remoteClient().tasks.complete(id, globalOpts.agent);
      if (globalOpts.json) output(task, true);
      else console.log(formatTaskLine(task));
    });

  program
    .command("delete <id>")
    .description("Delete a remote task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const result = await remoteClient().tasks.delete(id);
      if (globalOpts.json) output(result, true);
      else console.log(chalk.green("Task deleted."));
    });

  program
    .command("count")
    .description("Show remote task counts")
    .action(async () => {
      const globalOpts = program.opts();
      const status = await remoteClient().tasks.status({ project_id: globalOpts.project });
      if (globalOpts.json) output(status, true);
      else console.log(`total: ${status.total}  pending: ${status.pending}  in_progress: ${status.in_progress}  completed: ${status.completed}`);
    });

  program
    .command("status")
    .description("Show remote project health")
    .option("--agent <id>", "Include next task for this agent")
    .option("--project <id>", "Filter to project")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const status = await remoteClient().tasks.status({
        project_id: opts.project || program.opts().project,
        agent_id: opts.agent,
      });
      if (opts.json || program.opts().json) output(status, true);
      else console.log(`Tasks: ${status.pending} pending | ${status.in_progress} active | ${status.completed} done | ${status.total} total`);
    });

  program
    .command("next")
    .description("Show the best remote pending task")
    .option("--agent <id>", "Prefer tasks assigned to this agent")
    .option("--project <id>", "Filter to project")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const result = await remoteClient().tasks.next({
        agent_id: opts.agent,
        project_id: opts.project || program.opts().project,
      });
      if (opts.json || program.opts().json) output(result.task, true);
      else if (!result.task) console.log(chalk.dim("No tasks available."));
      else console.log(formatTaskLine(result.task));
    });

  program
    .command("claim <agent>")
    .description("Claim the best remote pending task for an agent")
    .option("--project <id>", "Filter to project")
    .option("-j, --json", "Output as JSON")
    .action(async (agent: string, opts) => {
      const result = await remoteClient().tasks.claim(agent, opts.project || program.opts().project);
      if (opts.json || program.opts().json) output(result, true);
      else if (!result.task) console.log(chalk.dim("No tasks available to claim."));
      else console.log(chalk.green(`Claimed: ${formatTaskLine(result.task)}`));
    });

  program
    .command("projects")
    .description("List or create remote projects")
    .option("--add <path>", "Register a project path")
    .option("--name <name>", "Project name")
    .action(async (opts) => {
      const globalOpts = program.opts();
      if (opts.add) {
        const project = await remoteClient().projects.create({
          name: opts.name || opts.add.split(/[\\/]/).filter(Boolean).at(-1) || opts.add,
          path: opts.add,
        });
        if (globalOpts.json) output(project, true);
        else console.log(chalk.green(`Project registered: ${project.name}`));
        return;
      }
      const projects = await remoteClient().projects.list();
      if (globalOpts.json) output(projects, true);
      else for (const project of projects) console.log(`${project.id.slice(0, 8)} ${project.name} ${project.path}`);
    });

  program
    .command("agents")
    .description("List remote agents")
    .action(async () => {
      const globalOpts = program.opts();
      const agents = await remoteClient().agents.list();
      if (globalOpts.json) output(agents, true);
      else for (const agent of agents) console.log(`${agent.id.slice(0, 8)} ${agent.name} ${agent.status}`);
    });

  program
    .command("search <query>")
    .description("Search remote tasks client-side")
    .option("-j, --json", "Output as JSON")
    .action(async (query: string, opts) => {
      const lowered = query.toLowerCase();
      const tasks = await remoteClient().tasks.list({ limit: 1000 });
      const matches = tasks.filter((task) =>
        task.title.toLowerCase().includes(lowered)
        || String(task.description || "").toLowerCase().includes(lowered)
      );
      if (opts.json || program.opts().json) output(matches, true);
      else for (const task of matches) console.log(formatTaskLine(task));
    });
}
