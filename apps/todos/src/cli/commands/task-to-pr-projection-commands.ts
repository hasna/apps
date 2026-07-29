import type { Command } from "commander";
import { TODOS_OPERATION_MANIFEST_DIGEST } from "@hasna/contracts/todos";
import { createTaskToPrProjectionCloudReader } from "../../task-to-pr-projections/remote.js";
import type { TaskToPrProjectionListOptions } from "../../task-to-pr-projections/types.js";
import { handleError, output } from "../helpers.js";

function globalJson(program: Command): boolean {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.()["json"] === true || program.opts()["json"] === true;
}

function boundedLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("--limit must be an integer between 1 and 1000");
  }
  return limit;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function localStore() {
  const [{ getDatabase }, { SqliteTaskToPrProjectionStore }] = await Promise.all([
    import("../../db/database.js"),
    import("../../task-to-pr-projections/local-sqlite.js"),
  ]);
  return new SqliteTaskToPrProjectionStore(getDatabase());
}

export function registerTaskToPrProjectionCommands(program: Command): void {
  const projection = program
    .command("task-to-pr-projection")
    .description("Query or deterministically rebuild strict task-to-PR projections");

  projection
    .command("list")
    .description("List current task-to-PR projections")
    .option("--cursor <cursor>", "Continue an earlier page")
    .option("--limit <n>", "Maximum records (1-1000)", "100")
    .option("--project <id>", "Filter by project scope")
    .option("--task-list <id>", "Filter by task-list scope")
    .option("--plan <id>", "Filter by plan scope")
    .option("--agent <id>", "Filter by agent scope")
    .option("--status <status>", "Filter by source lifecycle status")
    .option("--changed-after <timestamp>", "Filter by contract derivation timestamp")
    .option("-j, --json", "Output as JSON")
    .action(async (options: Record<string, string | boolean | undefined>) => {
      try {
        const request: TaskToPrProjectionListOptions = {
          cursor: typeof options["cursor"] === "string" ? options["cursor"] : null,
          limit: boundedLimit(String(options["limit"] ?? "100")),
          projectId: typeof options["project"] === "string" ? options["project"] : null,
          taskListId: typeof options["taskList"] === "string" ? options["taskList"] : null,
          planId: typeof options["plan"] === "string" ? options["plan"] : null,
          agentId: typeof options["agent"] === "string" ? options["agent"] : null,
          status: typeof options["status"] === "string" ? options["status"] : null,
          changedAfter: typeof options["changedAfter"] === "string" ? options["changedAfter"] : null,
        };
        const remote = createTaskToPrProjectionCloudReader();
        const page = remote ? await remote.list(request) : (await localStore()).list(request);
        if (options["json"] === true || globalJson(program)) return output(page, true);
        for (const item of page.items) {
          console.log(`${item.id} task=${item.identity.taskRef.id} head=${item.head.branchHead.value}`);
        }
        if (page.nextCursor) console.log(`next cursor: ${page.nextCursor}`);
      } catch (error) {
        handleError(error);
      }
    });

  projection
    .command("get <ref>")
    .description("Get one projection by projection or task reference")
    .option("-j, --json", "Output as JSON")
    .action(async (ref: string, options: { json?: boolean }) => {
      try {
        const remote = createTaskToPrProjectionCloudReader();
        const item = remote ? await remote.get(ref) : (await localStore()).get(ref);
        if (!item) throw new Error(`Task-to-PR projection not found: ${ref}`);
        if (options.json || globalJson(program)) return output(item, true);
        console.log(`${item.id} task=${item.identity.taskRef.id} head=${item.head.branchHead.value}`);
      } catch (error) {
        handleError(error);
      }
    });

  projection
    .command("rebuild")
    .description("Deterministically rebuild local projections from the PR-group ledger")
    .option("--task <ref>", "Rebuild one task (repeatable)", collect, [])
    .option("--expected-manifest-digest <digest>", "Contract manifest precondition", TODOS_OPERATION_MANIFEST_DIGEST)
    .option("-j, --json", "Output as JSON")
    .action(async (options: { task: string[]; expectedManifestDigest: string; json?: boolean }) => {
      try {
        if (createTaskToPrProjectionCloudReader()) {
          throw new Error(
            "REMOTE_COMMAND_UNSUPPORTED: task-to-pr-projection rebuild is local topology only; " +
              "local SQLite fallback is disabled",
          );
        }
        const result = (await localStore()).rebuild({
          taskRefs: options.task,
          expectedManifestDigest: options.expectedManifestDigest,
        });
        if (options.json || globalJson(program)) return output(result, true);
        const changed = result.receipts.filter((receipt) => receipt.changed).length;
        console.log(`rebuilt ${result.receipts.length} projection receipt(s); changed=${changed}`);
      } catch (error) {
        handleError(error);
      }
    });
}

