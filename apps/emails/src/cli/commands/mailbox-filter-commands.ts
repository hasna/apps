import type { Command } from "commander";
import { confirmDestructiveAction, handleError } from "../utils.js";
import { resolveMailDataSource } from "../../lib/mail-data-source.js";
import type { MailboxFilterInput } from "../../lib/mailbox-filters.js";

interface FilterOptions {
  mailbox?: string;
  folder?: string;
  search?: string;
  from?: string;
  to?: string;
  domain?: string;
  address?: string;
  subject?: string;
  label?: string;
  read?: boolean;
  unread?: boolean;
  starred?: boolean;
  archived?: boolean;
  since?: string;
  until?: string;
  yes?: boolean;
}

function criteriaFromOptions(options: FilterOptions): MailboxFilterInput["criteria"] {
  return {
    search: options.search,
    from: options.from,
    to: options.to,
    domain: options.domain,
    address: options.address,
    subject: options.subject,
    label: options.label,
    read: options.read,
    unread: options.unread,
    starred: options.starred,
    archived: options.archived,
    since: options.since,
    until: options.until,
  };
}

function criteriaPatchFromOptions(options: FilterOptions): MailboxFilterInput["criteria"] {
  return Object.fromEntries(
    Object.entries(criteriaFromOptions(options) ?? {}).filter(([, value]) => value !== undefined),
  ) as MailboxFilterInput["criteria"];
}

/** Register the backend-neutral saved-filter CLI family on `emails inbox`. */
export function registerMailboxFilterCommands(
  inboxCmd: Command,
  output: (data: unknown, formatted: string) => void,
): void {
  const filterCmd = inboxCmd
    .command("filter")
    .description("Manage persisted saved inbox filters")
    .option("-j, --json", "Print JSON output", false);

  filterCmd
    .command("list")
    .description("List saved inbox filters")
    .option("-j, --json", "Print JSON output", false)
    .option("--limit <n>", "Maximum filters to show", "100")
    .option("--offset <n>", "Number of filters to skip", "0")
    .action(async (options: { limit?: string; offset?: string }) => {
      try {
        const ds = resolveMailDataSource();
        const items = await ds.listMailboxFilters({
          limit: Math.min(1000, Math.max(1, Number.parseInt(options.limit ?? "100", 10) || 100)),
          offset: Math.max(0, Number.parseInt(options.offset ?? "0", 10) || 0),
        });
        output({ items }, items.map((item) => `${item.name}\t${item.mailbox}`).join("\n") || "No saved filters.");
      } catch (error) {
        handleError(error);
      }
    });

  filterCmd
    .command("add <name>")
    .description("Create a saved inbox filter")
    .option("-j, --json", "Print JSON output", false)
    .option("--mailbox <folder>", "Mailbox folder", "inbox")
    .option("--folder <folder>", "Alias for --mailbox")
    .option("--search <query>", "Search subject/from/to/body")
    .option("--from <text>", "From contains")
    .option("--to <text>", "To contains")
    .option("--domain <domain>", "Recipient domain")
    .option("--address <address>", "Sender or recipient address")
    .option("--subject <text>", "Subject contains")
    .option("--label <label>", "Message label")
    .option("--read", "Only read messages")
    .option("--unread", "Only unread messages")
    .option("--starred", "Only starred messages")
    .option("--archived", "Only archived messages")
    .option("--since <date>", "Received at or after this date")
    .option("--until <date>", "Received at or before this date")
    .action(async (name: string, options: FilterOptions) => {
      try {
        const filter = await resolveMailDataSource().createMailboxFilter({
          name,
          mailbox: options.folder ?? options.mailbox,
          criteria: criteriaFromOptions(options),
        });
        output(filter, `${filter.name} (${filter.mailbox})`);
      } catch (error) {
        handleError(error);
      }
    });

  filterCmd
    .command("update <name-or-id>")
    .description("Update a saved inbox filter")
    .option("-j, --json", "Print JSON output", false)
    .option("--name <name>", "New display name")
    .option("--mailbox <folder>", "Mailbox folder")
    .option("--folder <folder>", "Alias for --mailbox")
    .option("--search <query>", "Search subject/from/to/body")
    .option("--from <text>", "From contains")
    .option("--to <text>", "To contains")
    .option("--domain <domain>", "Recipient domain")
    .option("--address <address>", "Sender or recipient address")
    .option("--subject <text>", "Subject contains")
    .option("--label <label>", "Message label")
    .option("--read", "Only read messages")
    .option("--unread", "Only unread messages")
    .option("--starred", "Only starred messages")
    .option("--archived", "Only archived messages")
    .option("--since <date>", "Received at or after this date")
    .option("--until <date>", "Received at or before this date")
    .action(async (identifier: string, options: FilterOptions & { name?: string }) => {
      try {
        const filter = await resolveMailDataSource().updateMailboxFilter(identifier, {
          name: options.name,
          mailbox: options.folder ?? options.mailbox,
          criteria: criteriaPatchFromOptions(options),
        });
        output(filter, `${filter.name} (${filter.mailbox})`);
      } catch (error) {
        handleError(error);
      }
    });

  filterCmd
    .command("show <name-or-id>")
    .description("Show one saved inbox filter")
    .option("-j, --json", "Print JSON output", false)
    .action(async (identifier: string) => {
      try {
        const filter = await resolveMailDataSource().getMailboxFilter(identifier);
        if (!filter) throw new Error(`mailbox filter not found: ${identifier}`);
        output(filter, JSON.stringify(filter, null, 2));
      } catch (error) {
        handleError(error);
      }
    });

  filterCmd
    .command("remove <name-or-id>")
    .description("Remove one saved inbox filter")
    .option("-j, --json", "Print JSON output", false)
    .option("--yes", "Confirm removal without prompting", false)
    .action(async (identifier: string, options: { yes?: boolean }) => {
      try {
        await confirmDestructiveAction(`Remove saved mailbox filter ${identifier}?`, options.yes);
        await resolveMailDataSource().deleteMailboxFilter(identifier);
        output({ deleted: true, id: identifier }, `Removed saved filter ${identifier}.`);
      } catch (error) {
        handleError(error);
      }
    });
}
