import { resolveMailDataSource } from "../../lib/mail-data-source.js";
import type { MailboxFilterInput } from "../../lib/mailbox-filters.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type MailboxFilterToolName =
  | "list_mailbox_filters"
  | "create_mailbox_filter"
  | "update_mailbox_filter"
  | "delete_mailbox_filter"
  | "apply_mailbox_filter";

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failed(error: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
  };
}

function pageValue(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.trunc(parsed);
  if (integer < 0) return fallback;
  return max === undefined ? integer : Math.min(max, integer);
}

export async function runMailboxFilterTool(
  name: MailboxFilterToolName,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const ds = resolveMailDataSource();
    if (name === "list_mailbox_filters") {
      const items = await ds.listMailboxFilters({
        limit: pageValue(input.limit, 100, 1000),
        offset: pageValue(input.offset, 0),
      });
      return ok({ items });
    }
    if (name === "create_mailbox_filter") {
      const result = await ds.createMailboxFilter({
        name: String(input.name ?? ""),
        mailbox: String(input.mailbox ?? "inbox"),
        criteria: input.criteria as MailboxFilterInput["criteria"],
      });
      return ok(result);
    }
    const identifier = String(input.id ?? "").trim();
    if (!identifier) return failed(new Error("filter id is required"));
    if (name === "update_mailbox_filter") {
      const result = await ds.updateMailboxFilter(identifier, {
        name: input.name === undefined ? undefined : String(input.name),
        mailbox: input.mailbox === undefined ? undefined : String(input.mailbox),
        criteria: input.criteria as MailboxFilterInput["criteria"],
      });
      return ok(result);
    }
    if (name === "delete_mailbox_filter") {
      await ds.deleteMailboxFilter(identifier);
      return ok({ deleted: true, id: identifier });
    }
    const result = await ds.applyMailboxFilter(identifier, {
      limit: pageValue(input.limit, 100, 1000),
      offset: pageValue(input.offset, 0),
    });
    return ok(result);
  } catch (error) {
    return failed(error);
  }
}
