import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerJsonSchemaTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_json_schemas")) {
    server.tool(
      "list_json_schemas",
      "List versioned JSON schemas for tasks, projects, plans, runs, evidence, handoffs, bundles, and MCP responses.",
      {},
      async () => {
        try {
          const { listJsonSchemas } = await import("../../lib/json-schemas.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(listJsonSchemas(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_json_schema")) {
    server.tool(
      "get_json_schema",
      "Get JSON Schema definition for an entity type.",
      {
        entity: z.enum(["task", "project", "plan", "agent_run", "run_record", "verification_evidence", "handoff", "import_export_bundle", "mcp_response"]),
      },
      async ({ entity }) => {
        try {
          const { getJsonSchema } = await import("../../lib/json-schemas.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getJsonSchema(entity), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("validate_schema_payload")) {
    server.tool(
      "validate_schema_payload",
      "Validate a JSON payload against a published todos schema.",
      {
        entity: z.enum(["task", "project", "plan", "agent_run", "run_record", "verification_evidence", "handoff", "import_export_bundle", "mcp_response"]),
        payload: z.record(z.unknown()),
      },
      async ({ entity, payload }) => {
        try {
          const { validateSchemaPayload } = await import("../../lib/json-schemas.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(validateSchemaPayload(entity, payload), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_schema_compatibility")) {
    server.tool(
      "check_schema_compatibility",
      "Check semver/schema compatibility between two schema_version values.",
      {
        entity: z.enum(["task", "project", "plan", "agent_run", "run_record", "verification_evidence", "handoff", "import_export_bundle", "mcp_response"]),
        from_version: z.string(),
        to_version: z.string(),
      },
      async ({ entity, from_version, to_version }) => {
        try {
          const { checkSchemaCompatibility } = await import("../../lib/json-schemas.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(checkSchemaCompatibility(entity, from_version, to_version), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://json-schemas",
    "JSON schema catalog and semver guidance",
    async () => {
      const { getSchemaSemverGuidance, listJsonSchemas } = await import("../../lib/json-schemas.js");
      const text = `${getSchemaSemverGuidance()}\n\n## Catalog\n\n\`\`\`json\n${JSON.stringify(listJsonSchemas(), null, 2)}\n\`\`\``;
      return { contents: [{ uri: "todos://json-schemas", mimeType: "text/markdown", text }] };
    },
  );
}
