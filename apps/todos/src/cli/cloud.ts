import { Command } from "commander";
import { TodosV1Client } from "../client.generated.js";
import { getPackageVersion } from "../lib/package-version.js";
import { getTodosCloudEnvironment } from "../runtime-mode.js";

function client(): TodosV1Client {
  const config = getTodosCloudEnvironment();
  return new TodosV1Client({ baseUrl: config.apiUrl, apiKey: config.apiKey, fetch: noRedirectFetch });
}

function noRedirectFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: "manual" });
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function run(argv: string[]): Promise<void> {
  const api = client();
  const program = new Command()
    .name("todos")
    .description("Headless task management for AI coding agents")
    .version(getPackageVersion())
    .option("--json", "Emit JSON");

  program.command("add <title>")
    .option("--description <text>")
    .option("--priority <priority>", "low, medium, high, or critical", "medium")
    .option("--project <id>")
    .option("--agent <name>")
    .action(async (title, options) => print(await api.createTask({
      title,
      description: options.description,
      priority: options.priority,
      project_id: options.project,
      assigned_to: options.agent,
    })));

  program.command("list")
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--project <id>")
    .option("--agent <name>")
    .option("--limit <count>")
    .action(async (options) => print(await api.listTasks({
      status: options.status,
      priority: options.priority,
      project_id: options.project,
      assigned_to: options.agent,
      limit: options.limit === undefined ? undefined : Number(options.limit),
    })));

  program.command("get <id>").action(async (id) => print(await api.getTask(id)));
  program.command("delete <id>").action(async (id) => print(await api.deleteTask(id)));
  program.command("start <id>").action(async (id) => print(await api.startTask(id)));

  program.command("complete <id>")
    .option("--agent <name>")
    .option("--notes <text>")
    .option("--commit-hash <hash>")
    .action(async (id, options) => print(await api.completeTask(id, {
      agent_id: options.agent,
      notes: options.notes,
      commit_hash: options.commitHash,
    })));

  program.command("update <id>")
    .option("--title <title>")
    .option("--description <text>")
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--agent <name>")
    .action(async (id, options) => print(await api.updateTask(id, {
      title: options.title,
      description: options.description,
      status: options.status,
      priority: options.priority,
      assigned_to: options.agent,
    })));

  program.command("status").action(async () => print(await api.getStats()));

  const projects = program.command("projects");
  projects.command("list").action(async () => print(await api.listProjects()));
  projects.command("create <name> <path>")
    .option("--description <text>")
    .action(async (name, path, options) => print(await api.createProject({ name, path, description: options.description })));

  await program.parseAsync(argv);
}
