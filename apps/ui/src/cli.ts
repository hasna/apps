#!/usr/bin/env bun
// ui (@hasna/ui) CLI — offline replacement for the ui.sh MCP fetch tool.
//
//   ui fetch uidotsh://ui
//   ui fetch uidotsh://ui/design-guidelines/buttons uidotsh://ui/ideas
//   ui list                 # list all mirrored resource URIs
//   ui serve [port]         # start the local preview/picker server
//
// Reads from the mirrored content/ tree — no network, no remote picker.

import { join } from "node:path";
import { handleCompactEventsCli } from "./compact-events-cli.ts";
import { assertContentMirror, resolveContentDir } from "./content.ts";
import { fetchResource } from "./fetch.ts";
import { harvest } from "./harvest.ts";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

async function runSharedEventCli(args: string[]): Promise<boolean> {
  if (args[0] !== "events" && args[0] !== "webhooks") return false;
  if (await handleCompactEventsCli(args)) return true;
  const [{ Command }, { registerEventsCommands }] = await Promise.all([
    import("commander"),
    import("@hasna/events/commander"),
  ]);
  const program = new Command().name("ui");
  registerEventsCommands(program, { source: "ui" });
  await program.parseAsync(["node", "ui", ...args]);
  return true;
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

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--limit must be a positive integer");
  return Math.min(parsed, max);
}

async function listUris(): Promise<string[]> {
  const contentDir = resolveContentDir();
  await assertContentMirror(contentDir);
  const idx = (await Bun.file(join(contentDir, "index.json")).json()) as Record<string, string>;
  return Object.keys(idx).sort();
}

async function printUriList(rest: string[]): Promise<void> {
  const args = [...rest];
  const json = takeFlag(args, "--json", "-j");
  const verbose = takeFlag(args, "--verbose", "-v");
  const limitOption = takeOption(args, "--limit");
  const cursorOption = takeOption(args, "--cursor");
  const limit = parseLimit(limitOption, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const cursor = Number(cursorOption ?? 0);
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("--cursor must be a non-negative integer");
  if (args.length) throw new Error(`Unknown list option(s): ${args.join(" ")}`);

  const uris = await listUris();
  const rows = uris.slice(cursor, cursor + limit);
  if (json) {
    console.log(JSON.stringify(limitOption !== undefined || cursorOption !== undefined ? rows : uris, null, 2));
    return;
  }

  console.log(rows.join("\n"));
  const hints = [`${rows.length} of ${uris.length} resources`];
  if (cursor + rows.length < uris.length) hints.push(`use --cursor ${cursor + rows.length} --limit ${limit} for more`);
  hints.push(verbose ? "use ui fetch <uri> for full content" : "use --verbose for detail hints or ui fetch <uri>");
  console.error(`\n${hints.join("; ")}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (await runSharedEventCli([cmd, ...rest].filter((arg): arg is string => typeof arg === "string"))) return;
  switch (cmd) {
    case "fetch": {
      if (!rest.length) {
        console.error("usage: ui fetch <uidotsh://...> [more uris]");
        process.exit(1);
      }
      const out = rest.length === 1 ? await fetchResource({ uri: rest[0] }) : await fetchResource({ uris: rest });
      console.log(out);
      break;
    }
    case "list": {
      await printUriList(rest);
      break;
    }
    case "harvest": {
      await harvest({ contentDir: rest[0] });
      break;
    }
    case "serve": {
      const port = rest[0] ? Number(rest[0]) : 5173;
      process.env.UI_LOCAL_PORT = String(port);
      await import("./server.ts");
      break;
    }
    default:
      console.error("ui (@hasna/ui) — offline ui.sh\n  commands: fetch <uri...>, list [--limit n] [--cursor n] [--json], harvest [content-dir], serve [port], events, webhooks");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
