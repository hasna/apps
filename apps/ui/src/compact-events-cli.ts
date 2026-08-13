import {
  EventsClient,
  redactSensitiveKeys,
  sanitizeChannelForOutput,
  sanitizeChannelsForOutput,
  type ChannelConfig,
  type DeliveryResult,
  type EventEnvelope,
} from "@hasna/events";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const ID_WIDTH = 8;

interface ParsedFlags {
  args: string[];
  json: boolean;
  verbose: boolean;
  limit?: number;
  cursor?: number;
}

function takeFlag(args: string[], ...names: string[]): boolean {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) {
      args.splice(index, 1);
      return true;
    }
  }
  return false;
}

function takeOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inlineIndex = args.findIndex((arg) => arg.startsWith(prefix));
  if (inlineIndex !== -1) {
    const [value] = args.splice(inlineIndex, 1);
    const parsed = value.slice(prefix.length);
    if (!parsed) throw new Error(`${name} requires a value`);
    return parsed;
  }
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function parseNumberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseFlags(input: string[]): ParsedFlags {
  const args = [...input];
  const json = takeFlag(args, "--json", "-j");
  const verbose = takeFlag(args, "--verbose", "-v");
  const limit = parseNumberOption(takeOption(args, "--limit"), "--limit");
  const cursor = parseNumberOption(takeOption(args, "--cursor"), "--cursor");
  return { args, json, verbose, limit, cursor };
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function shortId(id: string): string {
  return id.length <= ID_WIDTH ? id : id.slice(0, ID_WIDTH);
}

function truncate(value: unknown, max: number): string {
  const text = value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function jsonSummary(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  return truncate(JSON.stringify(value), max);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function eventForOutput(event: EventEnvelope): EventEnvelope {
  return redactSensitiveKeys(event);
}

function replayForOutput(result: { events: EventEnvelope[]; deliveries: DeliveryResult[] }): {
  events: EventEnvelope[];
  deliveries: DeliveryResult[];
} {
  return { ...result, events: result.events.map(eventForOutput) };
}

function pageRows<T>(rows: T[], flags: ParsedFlags): { rows: T[]; start: number; limit: number } {
  const limit = clampLimit(flags.limit);
  const start = flags.cursor ?? Math.max(rows.length - limit, 0);
  return { rows: rows.slice(start, start + limit), start, limit };
}

function printHint(total: number, shown: number, start: number, limit: number, detail: string): void {
  const parts = [`Showing ${shown} of ${total}.`];
  if (start > 0) parts.push(`Use --cursor ${Math.max(0, start - limit)} --limit ${limit} for previous results.`);
  if (start + shown < total) parts.push(`Use --cursor ${start + shown} --limit ${limit} for next results.`);
  parts.push(detail);
  console.error(parts.join(" "));
}

function filterEvents(events: EventEnvelope[], args: string[]): EventEnvelope[] {
  const source = takeOption(args, "--source");
  const type = takeOption(args, "--type");
  let rows = events;
  if (source) rows = rows.filter((event) => event.source === source);
  if (type) rows = rows.filter((event) => event.type === type);
  if (args.length) throw new Error(`Unknown events list option(s): ${args.join(" ")}`);
  return rows;
}

function findEvent(events: EventEnvelope[], id: string): EventEnvelope | undefined {
  return events.find((event) => event.id === id) ?? events.find((event) => event.id.startsWith(id));
}

function eventLine(event: EventEnvelope, verbose: boolean): string {
  const output = eventForOutput(event);
  const cols = [
    output.time,
    shortId(output.id),
    truncate(output.source, 14),
    truncate(output.type, 32),
    output.severity,
  ];
  if (verbose) {
    cols.push(truncate(output.subject, 24), truncate(output.message, 48), jsonSummary(output.data, 64));
  }
  return cols.join("\t");
}

function printEventDetail(event: EventEnvelope, verbose: boolean): void {
  const redacted = eventForOutput(event);
  console.log(`id: ${event.id}`);
  console.log(`time: ${event.time}`);
  console.log(`source: ${event.source}`);
  console.log(`type: ${event.type}`);
  console.log(`severity: ${event.severity}`);
  if (event.subject) console.log(`subject: ${event.subject}`);
  if (event.message) console.log(`message: ${event.message}`);
  if (event.dedupeKey) console.log(`dedupeKey: ${event.dedupeKey}`);
  if (verbose || Object.keys(redacted.data ?? {}).length) console.log(`data: ${jsonSummary(redacted.data, verbose ? 2000 : 240)}`);
  if (verbose || Object.keys(redacted.metadata ?? {}).length) console.log(`metadata: ${jsonSummary(redacted.metadata, verbose ? 2000 : 240)}`);
}

function channelTarget(channel: ChannelConfig): string {
  return channel.webhook?.url ?? channel.command?.command ?? channel.transport;
}

function channelFilters(channel: ChannelConfig): string {
  if (!channel.filters?.length) return "-";
  return truncate(channel.filters.map((filter) => JSON.stringify(filter)).join("; "), 80);
}

function findChannel(channels: ChannelConfig[], id: string): ChannelConfig | undefined {
  return channels.find((channel) => channel.id === id);
}

function channelLine(channel: ChannelConfig, verbose: boolean): string {
  const cols = [
    truncate(channel.id, 28),
    channel.enabled ? "enabled" : "disabled",
    channel.transport,
    truncate(channelTarget(channel), 48),
  ];
  if (verbose) cols.push(channelFilters(channel));
  return cols.join("\t");
}

function printChannelDetail(channel: ChannelConfig, verbose: boolean): void {
  const sanitized = sanitizeChannelForOutput(channel);
  console.log(`id: ${sanitized.id}`);
  if (sanitized.name) console.log(`name: ${sanitized.name}`);
  console.log(`status: ${sanitized.enabled ? "enabled" : "disabled"}`);
  console.log(`transport: ${sanitized.transport}`);
  console.log(`target: ${channelTarget(sanitized)}`);
  if (sanitized.filters?.length) console.log(`filters: ${jsonSummary(sanitized.filters, verbose ? 2000 : 240)}`);
  if (sanitized.retry) console.log(`retry: ${jsonSummary(sanitized.retry, verbose ? 2000 : 240)}`);
  if (sanitized.redact) console.log(`redact: ${jsonSummary(sanitized.redact, verbose ? 2000 : 240)}`);
  if (verbose) console.log(`raw: ${JSON.stringify(sanitized, null, 2)}`);
}

function printEventsHelp(): void {
  console.log(`ui events

Usage:
  ui events emit <type> [options]
  ui events list [--source <source>] [--type <type>] [--limit <n>] [--cursor <n>] [--verbose] [--json]
  ui events show <id> [--verbose] [--json]
  ui events inspect <id> [--verbose] [--json]
  ui events replay [--id <event-id>] [--source <source>] [--type <type>] [--dry-run] [--json]

Defaults:
  list shows the latest ${DEFAULT_LIMIT} compact rows. Use show/inspect for one full record or --json for machine-readable output.`);
}

function printWebhooksHelp(): void {
  console.log(`ui webhooks

Usage:
  ui webhooks add <url|command> --id <id> [options]
  ui webhooks list [--limit <n>] [--cursor <n>] [--verbose] [--json]
  ui webhooks show <id> [--verbose] [--json]
  ui webhooks inspect <id> [--verbose] [--json]
  ui webhooks remove <id>
  ui webhooks test <id> [--type <type>] [--subject <subject>] [--data <json>] [--json]

Defaults:
  list shows up to ${DEFAULT_LIMIT} compact rows. Use show/inspect for one channel or --json for machine-readable output.`);
}

async function handleEventList(tail: string[]): Promise<void> {
  const flags = parseFlags(tail);
  const events = filterEvents(await new EventsClient().listEvents(), flags.args);
  if (flags.json) {
    const rows = flags.limit !== undefined || flags.cursor !== undefined ? pageRows(events, flags).rows : events;
    printJson(rows.map(eventForOutput));
    return;
  }
  if (!events.length) {
    console.log("No events recorded.");
    return;
  }
  const page = pageRows(events, flags);
  for (const event of page.rows) console.log(eventLine(event, flags.verbose));
  printHint(events.length, page.rows.length, page.start, page.limit, "Use ui events show <id> for details, --verbose for more columns, or --json for full records.");
}

async function handleEventShow(command: string, tail: string[]): Promise<void> {
  const flags = parseFlags(tail);
  const id = flags.args[0];
  if (!id) throw new Error(`usage: ui events ${command} <id> [--verbose|--json]`);
  if (flags.args.length > 1) throw new Error(`Unknown events ${command} argument(s): ${flags.args.slice(1).join(" ")}`);
  const event = findEvent(await new EventsClient().listEvents(), id);
  if (!event) throw new Error(`Event not found: ${id}`);
  if (flags.json) printJson(eventForOutput(event));
  else printEventDetail(event, flags.verbose);
}

async function handleEventReplay(tail: string[]): Promise<void> {
  const flags = parseFlags(tail);
  const args = [...flags.args];
  const dryRun = takeFlag(args, "--dry-run");
  const result = await new EventsClient().replay({
    eventId: takeOption(args, "--id"),
    source: takeOption(args, "--source"),
    type: takeOption(args, "--type"),
    dryRun,
  });
  if (args.length) throw new Error(`Unknown events replay option(s): ${args.join(" ")}`);
  if (flags.json) printJson(replayForOutput(result));
  else console.log(`Replayed ${result.events.length} event(s), ${result.deliveries.length} delivery result(s)`);
}

async function handleWebhookList(tail: string[]): Promise<void> {
  const flags = parseFlags(tail);
  if (flags.args.length) throw new Error(`Unknown webhooks list option(s): ${flags.args.join(" ")}`);
  const channels = await new EventsClient().listChannels();
  if (flags.json) {
    const rows = flags.limit !== undefined || flags.cursor !== undefined ? pageRows(channels, flags).rows : channels;
    printJson(sanitizeChannelsForOutput(rows));
    return;
  }
  if (!channels.length) {
    console.log("No channels configured.");
    return;
  }
  const page = pageRows(channels, flags);
  for (const channel of page.rows) console.log(channelLine(channel, flags.verbose));
  printHint(channels.length, page.rows.length, page.start, page.limit, "Use ui webhooks show <id> for details, --verbose for filters, or --json for full records.");
}

async function handleWebhookShow(command: string, tail: string[]): Promise<void> {
  const flags = parseFlags(tail);
  const id = flags.args[0];
  if (!id) throw new Error(`usage: ui webhooks ${command} <id> [--verbose|--json]`);
  if (flags.args.length > 1) throw new Error(`Unknown webhooks ${command} argument(s): ${flags.args.slice(1).join(" ")}`);
  const channel = findChannel(await new EventsClient().listChannels(), id);
  if (!channel) throw new Error(`Webhook channel not found: ${id}`);
  if (flags.json) printJson(sanitizeChannelForOutput(channel));
  else printChannelDetail(channel, flags.verbose);
}

export async function handleCompactEventsCli(argv: string[]): Promise<boolean> {
  const [group, command, ...tail] = argv;
  if (group === "events") {
    if (!command || command === "--help" || command === "-h") {
      printEventsHelp();
      return true;
    }
    if (command === "list") {
      await handleEventList(tail);
      return true;
    }
    if (command === "show" || command === "inspect") {
      await handleEventShow(command, tail);
      return true;
    }
    if (command === "replay") {
      await handleEventReplay(tail);
      return true;
    }
  }
  if (group === "webhooks") {
    if (!command || command === "--help" || command === "-h") {
      printWebhooksHelp();
      return true;
    }
    if (command === "list") {
      await handleWebhookList(tail);
      return true;
    }
    if (command === "show" || command === "inspect") {
      await handleWebhookShow(command, tail);
      return true;
    }
  }
  return false;
}
