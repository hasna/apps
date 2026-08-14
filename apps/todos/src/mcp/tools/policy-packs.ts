import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerPolicyTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("validate_policy_pack")) {
    server.tool(
      "validate_policy_pack",
      "Validate a task against a local policy pack (done gates). Use dry_run to explain without blocking.",
      {
        task_id: z.string(),
        pack: z.string().optional().describe("Policy pack name (default: default)"),
        dry_run: z.boolean().optional(),
      },
      async ({ task_id, pack, dry_run }) => {
        try {
          const { validateTaskAgainstPolicyPack } = await import("../../lib/policy-packs.js");
          const id = resolveId(task_id, "tasks") ?? task_id;
          const result = validateTaskAgainstPolicyPack(id, pack ?? "default", { dry_run });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_policy_packs")) {
    server.tool(
      "list_policy_packs",
      "List locally configured policy packs for task done gates.",
      {},
      async () => {
        try {
          const { loadPolicyPacks } = await import("../../lib/policy-packs.js");
          const packs = loadPolicyPacks();
          const text = packs.map((p) => `${p.name} v${p.version}: ${p.description || ""} (${p.rules.length} rules)`).join("\n");
          return { content: [{ type: "text" as const, text: text || "No policy packs." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
