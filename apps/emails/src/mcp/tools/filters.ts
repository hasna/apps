import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const MAX_FILTER_LIMIT = 1000;
const mailboxSchema = z.enum(["inbox", "unread", "starred", "sent", "archived", "spam", "trash"]);
const criteriaSchema = z.object({
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  domain: z.string().optional(),
  address: z.string().optional(),
  subject: z.string().optional(),
  label: z.string().optional(),
  read: z.boolean().optional(),
  unread: z.boolean().optional(),
  starred: z.boolean().optional(),
  archived: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
}).optional();

type MailboxFilterToolName =
  | "list_mailbox_filters"
  | "create_mailbox_filter"
  | "update_mailbox_filter"
  | "delete_mailbox_filter"
  | "apply_mailbox_filter";

async function run(name: MailboxFilterToolName, input: Record<string, unknown>) {
  const { runMailboxFilterTool } = await import("./filters-impl.js");
  return runMailboxFilterTool(name, input);
}

function handler(name: MailboxFilterToolName) {
  return async (input: unknown) => run(name, input as Record<string, unknown>);
}

export function registerMailboxFilterTools(server: McpServer): void {
  server.tool(
    "list_mailbox_filters",
    "List persisted saved mailbox filters for the current tenant.",
    {
      limit: z.number().int().positive().max(MAX_FILTER_LIMIT).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    handler("list_mailbox_filters"),
  );
  server.tool(
    "create_mailbox_filter",
    "Create a normalized, tenant-scoped saved mailbox filter.",
    {
      name: z.string().min(1),
      mailbox: mailboxSchema,
      criteria: criteriaSchema,
    },
    handler("create_mailbox_filter"),
  );
  server.tool(
    "update_mailbox_filter",
    "Update and re-normalize a saved mailbox filter.",
    {
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      mailbox: mailboxSchema.optional(),
      criteria: criteriaSchema,
    },
    handler("update_mailbox_filter"),
  );
  server.tool(
    "delete_mailbox_filter",
    "Delete one saved mailbox filter by name or id.",
    { id: z.string().min(1) },
    handler("delete_mailbox_filter"),
  );
  server.tool(
    "apply_mailbox_filter",
    "Apply one saved mailbox filter using server-side matching and pagination.",
    {
      id: z.string().min(1),
      limit: z.number().int().positive().max(MAX_FILTER_LIMIT).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    handler("apply_mailbox_filter"),
  );
}
