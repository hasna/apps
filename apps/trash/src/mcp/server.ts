import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { TrashApi } from "../client.js";
import { HostedTrash } from "../hosted.js";
import { compactEntry, idSchema, labelSchema, listSchema, retentionSchema } from "../api/domain.js";
import { hostedDiagnostic } from "../cli/hosted.js";
import { OperationJournal } from "../journal.js";
import { getHomeDir } from "../paths.js";
import { VERSION } from "../version.js";

export function createTrashMcpServer(options: { api?: TrashApi; hosted?: HostedTrash; env?: NodeJS.ProcessEnv } = {}) {
  const server = new McpServer({ name: "trash", version: VERSION }, { instructions: "Use trash_put for reversible deletion. Start with trash_list (20 compact metadata rows); fetch one ID with trash_get. No file contents or permanent deletion tools are exposed. If an operation fails, inspect trash_pending and resume with trash_recover. Authentication failure preserves files." });
  const env = options.env ?? process.env;
  let api = options.api; let hosted = options.hosted;
  const client = () => api ??= new TrashApi({ env });
  const files = () => hosted ??= new HostedTrash({ api: client(), env });
  const journal = () => new OperationJournal(join(env.HASNA_HOME ?? join(getHomeDir(env), ".hasna"), "trash", "operations"));
  function tool<T extends z.ZodRawShape>(name: string, description: string, inputSchema: T, readOnly: boolean, run: (input: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>) {
    server.registerTool<z.ZodRawShape, z.ZodRawShape>(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true } }, async (input) => {
      try { return { content: [{ type: "text" as const, text: JSON.stringify(await run(z.object(inputSchema).parse(input))) }] }; }
      catch (error) { return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: hostedDiagnostic(error) }) }] }; }
    });
  }
  const id = { id: idSchema };
  const to = z.string().min(1).max(4096).optional();
  tool("trash_status", "Hosted API readiness, bound station and retention defaults.", {}, true, () => client().status());
  tool("trash_setup", "Register this detected station against its provisioned API credential.", {}, false, () => files().setup());
  tool("trash_list", "Search compact metadata; default 20, maximum 100. Use nextCursor for the next page. No payload content.", listSchema.shape, true, (query) => client().list(query));
  tool("trash_get", "Read one entry's full recovery metadata by ID; no payload or transfer credentials.", id, true, ({ id }) => client().get(id));
  tool("trash_put", "Safely remove one local path after verified remote capture. Default retention 90 days; null means never expire. Files, directories and symlinks supported.", { path: z.string().min(1).max(4096), retentionDays: retentionSchema.optional(), agent: labelSchema.optional() }, false,
    async ({ path, ...options }) => compactEntry(await files().put(path, options)));
  tool("trash_restore", "Restore one entry without overwriting an existing path. An explicit destination is required on another station.", { ...id, to }, false, async ({ id, to }) => {
    const result = await files().restore(id, { to }); return { ...compactEntry(result.entry), restoredTo: result.path };
  });
  tool("trash_hold", "Set or release a retention hold. Backup protection is independent and cannot be released with this tool.", { ...id, version: z.number().int().positive(), held: z.boolean() }, false,
    async ({ id, version, held }) => compactEntry(await client().hold(id, version, held)));
  tool("trash_retention", "Change retention from the deletion time: 1–3650 days, or null for never. Supply the current entry version.", { ...id, version: z.number().int().positive(), retentionDays: retentionSchema }, false,
    async ({ id, version, retentionDays }) => compactEntry(await client().retention(id, version, retentionDays)));
  tool("trash_backup", "Request Backup app handoff. Protects the Trash copy until the worker verifies and holds a restorable backup.", { ...id, version: z.number().int().positive() }, false,
    async ({ id, version }) => compactEntry(await client().backup(id, version)));
  tool("trash_pending", "List up to 100 unfinished filesystem operations on this station, default 20. Works without API credentials.", { limit: z.number().int().min(1).max(100).default(20) }, true, ({ limit }) => ({ items: options.hosted?.pending(limit) ?? journal().pending(limit) }));
  tool("trash_recover", "Resume a local interrupted operation by operation ID. Optional to preserves an incomplete restore and uses a new destination.", { ...id, to }, false, async ({ id, to }) => {
    const result = await files().recover(id, { to });
    return "entry" in result ? { ...compactEntry(result.entry), restoredTo: result.path, preservedPaths: result.preservedPaths } : compactEntry(result);
  });
  return server;
}
