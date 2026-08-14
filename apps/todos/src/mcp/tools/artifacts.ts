import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerArtifactTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("add_artifact")) {
    server.tool(
      "add_artifact",
      "Attach a local file as an artifact for a task, project, plan, run, verification, or handoff. Files stay local-only unless explicitly exported.",
      {
        entity_type: z.enum(["task", "project", "plan", "run", "verification", "handoff"]),
        entity_id: z.string(),
        source_path: z.string().describe("Local file path to attach"),
        name: z.string().optional(),
        storage_mode: z.enum(["reference", "copy"]).optional().describe("reference = keep original path; copy = store in .todos/artifacts"),
        redaction_status: z.enum(["none", "partial", "full"]).optional(),
      },
      async (params) => {
        try {
          const { addArtifact } = await import("../../db/artifacts.js");
          const entityId = params.entity_type === "task"
            ? (resolveId(params.entity_id, "tasks") ?? params.entity_id)
            : params.entity_id;
          const artifact = addArtifact({ ...params, entity_id: entityId });
          return {
            content: [{
              type: "text" as const,
              text: `Artifact ${artifact.id.slice(0, 8)} | ${artifact.name} | ${artifact.storage_mode} | hash:${artifact.content_hash.slice(0, 12)} | ${artifact.size_bytes} bytes`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_artifacts")) {
    server.tool(
      "list_artifacts",
      "List local artifacts for an entity.",
      {
        entity_type: z.enum(["task", "project", "plan", "run", "verification", "handoff"]).optional(),
        entity_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listArtifacts } = await import("../../db/artifacts.js");
          let entityId = params.entity_id;
          if (entityId && params.entity_type === "task") {
            entityId = resolveId(entityId, "tasks") ?? entityId;
          }
          const artifacts = listArtifacts({
            entity_type: params.entity_type,
            entity_id: entityId,
            limit: params.limit,
          });
          if (artifacts.length === 0) return { content: [{ type: "text" as const, text: "No artifacts found." }] };
          const text = artifacts.map((a) =>
            `${a.id.slice(0, 8)} | ${a.entity_type}:${a.entity_id.slice(0, 8)} | ${a.name} | ${a.storage_mode} | ${a.redaction_status} | ${a.size_bytes}b`,
          ).join("\n");
          return { content: [{ type: "text" as const, text: `${artifacts.length} artifact(s):\n${text}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_artifacts")) {
    server.tool(
      "export_artifacts",
      "Export a local artifacts manifest (JSON) for bridge/import workflows. Does not upload anywhere.",
      {
        entity_type: z.enum(["task", "project", "plan", "run", "verification", "handoff"]).optional(),
        entity_id: z.string().optional(),
      },
      async (params) => {
        try {
          const { exportArtifacts } = await import("../../db/artifacts.js");
          let entityId = params.entity_id;
          if (entityId && params.entity_type === "task") {
            entityId = resolveId(entityId, "tasks") ?? entityId;
          }
          const manifest = exportArtifacts({ entity_type: params.entity_type, entity_id: entityId });
          return { content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_artifact")) {
    server.tool(
      "delete_artifact",
      "Soft-delete a local artifact. Use cleanup_artifacts to purge expired deletions.",
      { id: z.string() },
      async ({ id }) => {
        try {
          const { softDeleteArtifact } = await import("../../db/artifacts.js");
          const deleted = softDeleteArtifact(id);
          return { content: [{ type: "text" as const, text: deleted ? "Artifact soft-deleted." : "Artifact not found." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("cleanup_artifacts")) {
    server.tool(
      "cleanup_artifacts",
      "Purge soft-deleted artifacts past retention period from local store.",
      { deleted_retention_days: z.number().optional().describe("Days to retain soft-deleted artifacts (default 30)") },
      async (params) => {
        try {
          const { cleanupArtifacts } = await import("../../db/artifacts.js");
          const purged = cleanupArtifacts({ deleted_retention_days: params.deleted_retention_days });
          return { content: [{ type: "text" as const, text: `Purged ${purged} expired artifact(s).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
