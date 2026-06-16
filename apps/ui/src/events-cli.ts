import {
  EventsClient,
  sanitizeChannelForOutput,
  sanitizeChannelsForOutput,
  type ChannelConfig,
  type EventFilter,
  type EventInput,
  type TransportKind,
} from "@hasna/events";

interface ParsedArgs {
  args: string[];
  json: boolean;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function parseArgs(input: string[]): ParsedArgs {
  const args = [...input];
  const json = takeFlag(args, "--json") || takeFlag(args, "-j");
  return { args, json };
}

function parseJsonObject(value: string | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
  return parsed as Record<string, unknown>;
}

function parseFilter(options: { source?: string; type?: string; subject?: string; severity?: string }): EventFilter[] | undefined {
  const filter: EventFilter = {};
  if (options.source) filter.source = options.source;
  if (options.type) filter.type = options.type;
  if (options.subject) filter.subject = options.subject;
  if (options.severity) filter.severity = options.severity;
  return Object.keys(filter).length > 0 ? [filter] : undefined;
}

function print(value: unknown, json: boolean, text: string): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(text);
}

function parseEventInput(type: string, args: string[]): EventInput {
  return {
    source: takeOption(args, "--source") ?? "ui",
    type,
    subject: takeOption(args, "--subject"),
    severity: (takeOption(args, "--severity") as EventInput["severity"]) ?? "info",
    message: takeOption(args, "--message"),
    dedupeKey: takeOption(args, "--dedupe-key"),
    data: parseJsonObject(takeOption(args, "--data"), {}),
    metadata: parseJsonObject(takeOption(args, "--metadata"), {}),
  };
}

export async function handleEventsCli(group: "events" | "webhooks", argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const [command, ...tail] = parsed.args;
  const client = new EventsClient();

  if (group === "events") {
    await handleEvents(client, command, tail, parsed.json);
    return;
  }

  await handleWebhooks(client, command, tail, parsed.json);
}

async function handleEvents(client: EventsClient, command: string | undefined, tail: string[], json: boolean): Promise<void> {
  if (command === "emit") {
    const args = [...tail];
    const type = args.shift();
    if (!type) throw new Error("usage: ui events emit <type> [--data <json>] [--json]");
    const noDeliver = takeFlag(args, "--no-deliver");
    const result = await client.emit(parseEventInput(type, args), { deliver: !noDeliver });
    print(result, json, `emitted ${result.event.type}`);
    return;
  }

  if (command === "list") {
    const events = await client.listEvents();
    print(events, json, events.length ? events.map((event) => `${event.time}\t${event.source}\t${event.type}`).join("\n") : "No events recorded.");
    return;
  }

  if (command === "replay") {
    const args = [...tail];
    const dryRun = takeFlag(args, "--dry-run");
    const result = await client.replay({
      eventId: takeOption(args, "--id"),
      source: takeOption(args, "--source"),
      type: takeOption(args, "--type"),
      dryRun,
    });
    print(result, json, `replayed ${result.events.length} event(s)`);
    return;
  }

  throw new Error("usage: ui events emit|list|replay");
}

async function handleWebhooks(client: EventsClient, command: string | undefined, tail: string[], json: boolean): Promise<void> {
  if (command === "add") {
    const args = [...tail];
    const target = args.shift();
    const id = takeOption(args, "--id");
    if (!target || !id) throw new Error("usage: ui webhooks add <target> --id <id> [--type <pattern>] [--json]");
    const transport = (takeOption(args, "--transport") ?? "webhook") as TransportKind;
    const now = new Date().toISOString();
    const channel: ChannelConfig = {
      id,
      enabled: !takeFlag(args, "--disabled"),
      transport,
      filters: parseFilter({
        source: takeOption(args, "--source"),
        type: takeOption(args, "--type"),
        subject: takeOption(args, "--subject"),
        severity: takeOption(args, "--severity"),
      }),
      createdAt: now,
      updatedAt: now,
    };
    if (transport === "command") channel.command = { command: target, args };
    else if (transport === "webhook") channel.webhook = { url: target, secret: takeOption(args, "--secret") };
    else throw new Error(`Unsupported transport: ${transport}`);
    const saved = await client.addChannel(channel);
    print(sanitizeChannelForOutput(saved), json, `added ${saved.transport} channel ${saved.id}`);
    return;
  }

  if (command === "list") {
    const channels = await client.listChannels();
    print(sanitizeChannelsForOutput(channels), json, channels.length ? channels.map((channel) => `${channel.id}\t${channel.transport}`).join("\n") : "No channels configured.");
    return;
  }

  if (command === "remove") {
    const id = tail[0];
    if (!id) throw new Error("usage: ui webhooks remove <id>");
    const removed = await client.removeChannel(id);
    print({ removed }, json, removed ? `removed ${id}` : `channel not found: ${id}`);
    return;
  }

  if (command === "test") {
    const args = [...tail];
    const id = args.shift();
    if (!id) throw new Error("usage: ui webhooks test <id> [--json]");
    const result = await client.testChannel(id, {
      source: takeOption(args, "--source") ?? "ui",
      type: takeOption(args, "--type") ?? "events.test",
      subject: takeOption(args, "--subject") ?? id,
      data: parseJsonObject(takeOption(args, "--data"), { test: true }),
    });
    print(result, json, `${result.status}: ${result.channelId}`);
    return;
  }

  throw new Error("usage: ui webhooks add|list|remove|test");
}
