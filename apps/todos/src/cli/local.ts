import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  claimNextTask,
  completeTask,
  createTask,
  deleteTask,
  failTask,
  getStatus,
  getTask,
  listTasks,
  startTask,
  updateTask,
} from "../db/tasks.js";
import { createProject, listProjects } from "../db/projects.js";
import { listAgents, registerAgent } from "../db/agents.js";
import type { TaskFilter, TaskPriority, TaskStatus } from "../types/index.js";

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function taskId(value: string): string {
  const id = resolvePartialId(getDatabase(), "tasks", value);
  if (!id) throw new Error(`Task not found: ${value}`);
  return id;
}

export async function run(argv: string[]): Promise<void> {
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
    .action((title, options) => print(createTask({
      title,
      description: options.description,
      priority: options.priority as TaskPriority,
      project_id: options.project,
      assigned_to: options.agent,
    })));

  program.command("list")
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--project <id>")
    .option("--agent <name>")
    .option("--limit <count>")
    .action((options) => {
      const filter: TaskFilter = {
        status: options.status as TaskStatus | undefined,
        priority: options.priority as TaskPriority | undefined,
        project_id: options.project,
        assigned_to: options.agent,
        limit: options.limit === undefined ? undefined : Number(options.limit),
      };
      print(listTasks(filter));
    });

  program.command("get <id>").action((id) => print(getTask(taskId(id))));

  program.command("update <id>")
    .option("--title <title>")
    .option("--description <text>")
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--agent <name>")
    .action((id, options) => {
      const resolved = taskId(id);
      const current = getTask(resolved)!;
      print(updateTask(resolved, {
        version: current.version,
        title: options.title,
        description: options.description,
        status: options.status as TaskStatus | undefined,
        priority: options.priority as TaskPriority | undefined,
        assigned_to: options.agent,
      }));
    });

  program.command("start <id>")
    .requiredOption("--agent <name>")
    .action((id, options) => print(startTask(taskId(id), options.agent)));

  program.command("complete <id>")
    .option("--agent <name>")
    .option("--notes <text>")
    .option("--commit-hash <hash>")
    .action((id, options) => print(completeTask(taskId(id), options.agent, undefined, {
      notes: options.notes,
      commit_hash: options.commitHash,
    })));

  program.command("fail <id>")
    .requiredOption("--reason <text>")
    .option("--agent <name>")
    .option("--retry")
    .action((id, options) => print(failTask(taskId(id), options.agent, options.reason, { retry: options.retry })));

  program.command("delete <id>").action((id) => print({ deleted: deleteTask(taskId(id)) }));

  program.command("claim <agent>")
    .option("--project <id>")
    .action((agent, options) => print(claimNextTask(agent, { project_id: options.project })));

  program.command("status")
    .option("--project <id>")
    .option("--agent <name>")
    .option("--explain-blocked")
    .action((options) => print(getStatus(
      { project_id: options.project },
      options.agent,
      { explain_blocked: options.explainBlocked },
    )));

  const projects = program.command("projects");
  projects.command("list").action(() => print(listProjects()));
  projects.command("create <name> <path>")
    .option("--description <text>")
    .action((name, path, options) => print(createProject({ name, path, description: options.description })));

  const agents = program.command("agents");
  agents.command("list").action(() => print(listAgents()));
  agents.command("register <name>")
    .option("--description <text>")
    .action((name, options) => print(registerAgent({ name, description: options.description })));

  await program.parseAsync(argv);
}
