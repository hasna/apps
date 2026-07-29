import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TODOS_OPERATION_MANIFEST_DIGEST } from "@hasna/contracts/todos";
import { createTaskToPrProjectionCloudReader } from "../../task-to-pr-projections/remote.js";

interface Helpers {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (error: unknown) => string;
}

async function localStore() {
  const [{ getDatabase }, { SqliteTaskToPrProjectionStore }] = await Promise.all([
    import("../../db/database.js"),
    import("../../task-to-pr-projections/local-sqlite.js"),
  ]);
  return new SqliteTaskToPrProjectionStore(getDatabase());
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerTaskToPrProjectionTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("todos_task_to_pr_projection_list")) {
    server.tool(
      "todos_task_to_pr_projection_list",
      "List strict task-to-PR projections from the selected Todos authority.",
      {
        cursor: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(1_000).optional(),
        project_id: z.string().nullable().optional(),
        task_list_id: z.string().nullable().optional(),
        plan_id: z.string().nullable().optional(),
        agent_id: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        changed_after: z.string().datetime().nullable().optional(),
      },
      async (params) => {
        try {
          const options = {
            cursor: params.cursor ?? null,
            limit: params.limit ?? 100,
            projectId: params.project_id ?? null,
            taskListId: params.task_list_id ?? null,
            planId: params.plan_id ?? null,
            agentId: params.agent_id ?? null,
            status: params.status ?? null,
            changedAfter: params.changed_after ?? null,
          };
          const remote = createTaskToPrProjectionCloudReader();
          return text(remote ? await remote.list(options) : (await localStore()).list(options));
        } catch (error) {
          return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("todos_task_to_pr_projection_get")) {
    server.tool(
      "todos_task_to_pr_projection_get",
      "Get one strict task-to-PR projection by projection or task reference.",
      { ref: z.string().min(1) },
      async ({ ref }) => {
        try {
          const remote = createTaskToPrProjectionCloudReader();
          const projection = remote ? await remote.get(ref) : (await localStore()).get(ref);
          if (!projection) throw new Error(`Task-to-PR projection not found: ${ref}`);
          return text(projection);
        } catch (error) {
          return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("todos_task_to_pr_projection_rebuild")) {
    server.tool(
      "todos_task_to_pr_projection_rebuild",
      "Deterministically rebuild local task-to-PR projections from the PR-group ledger.",
      {
        task_refs: z.array(z.string().min(1)).max(10_000).optional(),
        expected_manifest_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      },
      async ({ task_refs, expected_manifest_digest }) => {
        try {
          if (createTaskToPrProjectionCloudReader()) {
            throw new Error(
              "REMOTE_COMMAND_UNSUPPORTED: projection rebuild is local topology only; " +
                "local SQLite fallback is disabled",
            );
          }
          return text((await localStore()).rebuild({
            taskRefs: task_refs ?? [],
            expectedManifestDigest: expected_manifest_digest ?? TODOS_OPERATION_MANIFEST_DIGEST,
          }));
        } catch (error) {
          return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
        }
      },
    );
  }
}

