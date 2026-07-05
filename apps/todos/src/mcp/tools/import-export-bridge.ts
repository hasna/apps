import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerImportExportBridgeTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("export_local_bundle")) {
    server.tool(
      "export_local_bundle",
      "Export local projects/tasks/plans/deps/templates/comments/evidence as a stable JSON bundle for local bridge transfer. No cloud calls.",
      {
        project_id: z.string().optional(),
        bundle_type: z.enum(["full_export", "tasks", "partial"]).optional(),
        profile: z.enum(["redacted", "encrypted", "plaintext"]).optional(),
        acknowledge_plaintext: z.boolean().optional(),
      },
      async ({ project_id, ...rest }) => {
        try {
          const { exportLocalBundle } = await import("../../lib/import-export-bridge.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const bundle = exportLocalBundle({ project_id: projectId, ...rest });
          return { content: [{ type: "text" as const, text: JSON.stringify(bundle, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("import_local_bundle")) {
    server.tool(
      "import_local_bundle",
      "Import a local JSON bundle with merge strategy and conflict metadata. No cloud calls.",
      {
        bundle_json: z.string().describe("JSON bundle string or path is not supported here — pass raw JSON"),
        strategy: z.enum(["skip_existing", "remote_wins", "local_wins", "newest_wins"]).optional(),
        dry_run: z.boolean().optional(),
      },
      async ({ bundle_json, strategy, dry_run }) => {
        try {
          const { importBundle, validateBundle } = await import("../../lib/import-export-bridge.js");
          const parsed = JSON.parse(bundle_json) as unknown;
          const validation = validateBundle(parsed);
          if (!validation.valid) {
            return { content: [{ type: "text" as const, text: `Invalid bundle: ${validation.errors.join("; ")}` }], isError: true };
          }
          const result = importBundle(parsed as import("../../lib/import-export-bridge.js").ImportExportBundle, { strategy, dry_run });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("preview_bundle_sync")) {
    server.tool(
      "preview_bundle_sync",
      "Preview sync conflicts between a JSON bundle and local database.",
      {
        bundle_json: z.string(),
        strategy: z.enum(["skip_existing", "remote_wins", "local_wins", "newest_wins"]).optional(),
      },
      async ({ bundle_json, strategy }) => {
        try {
          const { previewSync, validateBundle } = await import("../../lib/import-export-bridge.js");
          const parsed = JSON.parse(bundle_json) as unknown;
          const validation = validateBundle(parsed);
          if (!validation.valid) {
            return { content: [{ type: "text" as const, text: `Invalid bundle: ${validation.errors.join("; ")}` }], isError: true };
          }
          const preview = previewSync(parsed as import("../../lib/import-export-bridge.js").ImportExportBundle, strategy);
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("validate_bundle")) {
    server.tool(
      "validate_bundle",
      "Validate a todos.bundle.v1 JSON bundle structure.",
      { bundle_json: z.string() },
      async ({ bundle_json }) => {
        try {
          const { validateBundle } = await import("../../lib/import-export-bridge.js");
          const parsed = JSON.parse(bundle_json) as unknown;
          const result = validateBundle(parsed);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
