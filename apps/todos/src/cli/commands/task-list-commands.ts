import type { Command } from "commander";
import { normalizeSlug } from "../../lib/slugs.js";
import { assertTaskListApiEnvironment } from "../../lib/task-list-client-boundary.js";
import {
  assertTaskListReceipt,
  listSharedTaskLists,
  deleteSharedTaskList,
} from "../../mcp/task-list-api.js";
import {
  getTodosCloudClient,
  cloudResolveProjectRef,
  cloudResolveTaskListForUpdate,
  cloudResolveTaskListRef,
  cloudGetTaskList,
  cloudCreateTaskList,
  cloudUpdateTaskList,
  cloudListTaskListTasks,
} from "../cloud-router.js";
import { handleError, output, outputRecord } from "../helpers.js";
import type { TaskListStatus } from "../../types/index.js";
interface Options {
  add?: string;
  show?: string;
  update?: string;
  delete?: string;
  name?: string;
  slug?: string;
  description?: string;
  status?: TaskListStatus;
  force?: boolean;
}
export function registerTaskListCommands(program: Command): void {
  program
    .command("lists")
    .aliases(["task-lists", "tl"])
    .description("List and manage shared task lists")
    .option("--add <name>", "Create a task list")
    .option("--show <id>", "Show a task list and all its tasks (up to 10,000)")
    .option("--update <id>", "Update a task list")
    .option("--name <name>", "Name (with --update)")
    .option("--slug <slug>", "Custom slug (with --add or --update)")
    .option("-d, --description <text>", "Description (with --add or --update)")
    .option(
      "--status <status>",
      "Filter lists or set status with --add/--update: active, completed, archived",
    )
    .option("--delete <id>", "Delete an empty task list")
    .option(
      "--force",
      "With --delete, detach linked tasks and plans while preserving their content and history",
    )
    .action(async (opts: Options) => {
      try {
        const global = program.opts();
        assertTaskListApiEnvironment();
        if (
          [opts.add, opts.show, opts.update, opts.delete].filter(
            (value) => value !== undefined,
          ).length > 1
        )
          throw new Error("Choose one of --add, --show, --update or --delete");
        for (const value of [
          opts.add,
          opts.show,
          opts.update,
          opts.delete,
          opts.name,
          opts.slug,
        ])
          if (value !== undefined && !value.trim())
            throw new Error("Task-list names and selectors must not be blank");
        if (global.project !== undefined && !String(global.project).trim())
          throw new Error("--project must not be blank");
        if (opts.slug !== undefined && !normalizeSlug(opts.slug))
          throw new Error("Task-list slug must contain letters or digits");
        if (opts.force && !opts.delete)
          throw new Error("--force requires --delete");
        if (
          opts.status !== undefined &&
          !["active", "completed", "archived"].includes(opts.status)
        )
          throw new Error(
            "Invalid task-list status; use active, completed or archived",
          );
        if (opts.status !== undefined && (opts.show || opts.delete))
          throw new Error("--status applies to listing, --add or --update");
        if (opts.name !== undefined && !opts.update)
          throw new Error("--name requires --update");
        if (
          (opts.slug !== undefined || opts.description !== undefined) &&
          !opts.add &&
          !opts.update
        )
          throw new Error("--slug and --description require --add or --update");
        const client = getTodosCloudClient();
        if (!client)
          throw new Error(
            "Task-list commands require the authenticated Todos API",
          );
        const projectId = global.project
          ? await cloudResolveProjectRef(client, global.project)
          : undefined;
        if (opts.add !== undefined) {
          const input = {
            name: opts.add.trim(),
            slug: normalizeSlug(opts.slug ?? opts.add),
            description: opts.description,
            project_id: projectId,
            status: opts.status,
          };
          if (!input.slug)
            throw new Error("Task-list slug must contain letters or digits");
          const list = await cloudCreateTaskList(client, input);
          assertTaskListReceipt(list, input);
          outputRecord(list, Boolean(global.json), "Task list created:");
          return;
        }
        if (opts.show !== undefined || opts.update !== undefined) {
          const id = await cloudResolveTaskListForUpdate(
            client,
            opts.show ?? opts.update!,
            projectId,
            opts.update !== undefined && projectId !== undefined,
          );
          if (!id) throw new Error("Task list not found or ambiguous");
          if (opts.show !== undefined) {
            const list = await cloudGetTaskList(client, id);
            assertTaskListReceipt(list, {}, id);
            const tasks = await cloudListTaskListTasks(client, id);
            if (global.json) output({ ...list, tasks }, true);
            else {
              outputRecord(list, false, "Task list:");
              console.log(`Tasks: ${tasks.length}`);
              for (const task of tasks)
                console.log(
                  `  ${task.status} [${task.priority}] ${task.title} (${task.id})`,
                );
            }
            return;
          }
          const patch = {
            ...(projectId !== undefined ? { project_id: projectId } : {}),
            ...(opts.name !== undefined ? { name: opts.name.trim() } : {}),
            ...(opts.slug !== undefined
              ? { slug: normalizeSlug(opts.slug) }
              : {}),
            ...(opts.description !== undefined
              ? { description: opts.description }
              : {}),
            ...(opts.status !== undefined ? { status: opts.status } : {}),
          };
          if (!Object.keys(patch).length)
            throw new Error(
              "lists --update requires --project, --name, --slug, --description or --status",
            );
          const list = await cloudUpdateTaskList(client, id, patch);
          assertTaskListReceipt(list, patch, id);
          outputRecord(list, Boolean(global.json), "Task list updated:");
          return;
        }
        if (opts.delete !== undefined) {
          const id = await cloudResolveTaskListRef(
            client,
            opts.delete,
            projectId,
          );
          if (!id) throw new Error("Task list not found or ambiguous");
          const receipt = await deleteSharedTaskList(
            client,
            id,
            opts.force === true,
          );
          outputRecord(
            receipt,
            Boolean(global.json),
            "Task-list deletion receipt:",
          );
          if (!receipt.deleted) process.exitCode = 1;
          return;
        }
        const lists = (await listSharedTaskLists(client, projectId)).filter(
          (list) =>
            opts.status === undefined ||
            (list.status ?? "active") === opts.status,
        );
        if (global.json) output(lists, true);
        else if (!lists.length)
          console.log(
            "No task lists. Use 'todos lists --add <name>' to create one.",
          );
        else
          for (const list of lists)
            console.log(
              `  ${list.id} [${list.status ?? "active"}] ${list.name} (${list.slug})`,
            );
      } catch (error) {
        handleError(error);
      }
    });
}
