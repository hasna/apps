import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerEnvironmentSnapshotTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("capture_env_snapshot")) {
    server.tool(
      "capture_env_snapshot",
      "Capture reproducible local environment snapshot (command versions, env shape, git ref). Secrets redacted.",
      {
        cwd: z.string().optional(),
        run_record_id: z.string().optional(),
        agent_run_id: z.string().optional(),
        commands: z.array(z.string()).optional(),
      },
      async (params) => {
        try {
          const { captureEnvSnapshot } = await import("../../lib/environment-snapshots.js");
          const record = captureEnvSnapshot(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_env_snapshot")) {
    server.tool(
      "get_env_snapshot",
      "Get a stored environment snapshot by id.",
      { id: z.string() },
      async (params) => {
        try {
          const { getEnvSnapshot } = await import("../../lib/environment-snapshots.js");
          const id = resolveId(params.id, "env_snapshots") ?? params.id;
          const record = getEnvSnapshot(id);
          if (!record) return { content: [{ type: "text" as const, text: `Snapshot not found: ${params.id}` }], isError: true };
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_env_snapshots")) {
    server.tool(
      "list_env_snapshots",
      "List stored environment snapshots, optionally filtered by run_record_id.",
      {
        run_record_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listEnvSnapshots } = await import("../../lib/environment-snapshots.js");
          const records = listEnvSnapshots(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_env_snapshot")) {
    server.tool(
      "check_env_snapshot",
      "Compare current environment against a stored snapshot and report drift.",
      {
        id: z.string(),
        cwd: z.string().optional(),
      },
      async (params) => {
        try {
          const { checkEnvSnapshot } = await import("../../lib/environment-snapshots.js");
          const id = resolveId(params.id, "env_snapshots") ?? params.id;
          const result = checkEnvSnapshot(id, params.cwd);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
