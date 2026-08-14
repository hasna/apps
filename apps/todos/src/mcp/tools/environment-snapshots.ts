import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerEnvironmentSnapshotTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("capture_environment_snapshot")) {
    server.tool(
      "capture_environment_snapshot",
      "Capture a local reproducible environment snapshot with Bun/node versions, package-manager state, git status, config hashes, command metadata, and redacted manifests. Optionally attach it to a local task or run.",
      {
        root: z.string().optional(),
        task_id: z.string().optional(),
        run_id: z.string().optional(),
        agent_id: z.string().optional(),
        command: z.string().optional(),
        output_path: z.string().optional(),
        include_env_values: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { recordEnvironmentSnapshot } = await import("../../lib/environment-snapshots.js");
          const result = recordEnvironmentSnapshot(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("compare_environment_snapshots")) {
    server.tool(
      "compare_environment_snapshots",
      "Compare two local environment snapshot JSON files and report runtime, git, manifest, lockfile, and config hash drift.",
      {
        left_path: z.string(),
        right_path: z.string(),
      },
      async ({ left_path, right_path }) => {
        try {
          const { compareEnvironmentSnapshotFiles } = await import("../../lib/environment-snapshots.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(compareEnvironmentSnapshotFiles(left_path, right_path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
