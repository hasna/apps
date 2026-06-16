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
import { fetchResource } from "./fetch.ts";
import { handleEventsCli } from "./events-cli.ts";
import { runEventsCli } from "@hasna/events/cli";

const CONTENT_DIR = join(import.meta.dir, "..", "content");

async function listUris(): Promise<string[]> {
  const idxFile = Bun.file(join(CONTENT_DIR, "index.json"));
  if (await idxFile.exists()) {
    const idx = (await idxFile.json()) as Record<string, string>;
    return Object.keys(idx).sort();
  }
  return [];
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "events":
    case "webhooks": {
      await runEventsCli(process.argv.slice(2), { source: "ui", programName: "ui" });
      break;
    }
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
      const uris = await listUris();
      console.log(uris.join("\n"));
      console.error(`\n${uris.length} resources`);
      break;
    }
    case "serve": {
      const port = rest[0] ? Number(rest[0]) : 5173;
      process.env.UI_LOCAL_PORT = String(port);
      await import("./server.ts");
      break;
    }
    case "events":
    case "webhooks": {
      await handleEventsCli(cmd, rest);
      break;
    }
    default:
      console.error("ui (@hasna/ui) — offline ui.sh\n  commands: fetch <uri...>, list, serve [port], events, webhooks, webhooks, events");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
