#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { Store } from "./store";
import { createHandler } from "./service";
import { VERSION, Fault } from "./domain";
export async function main(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {
    host: {type: "string"}, port: {type: "string"}, "data-dir": {type: "string"},
    sqlite: {type: "string"}, json: {type: "boolean"}, version: {type: "boolean"}, help: {type: "boolean"},
  }});
  if (values.version) { console.log(VERSION); return; }
  if (values.help) { console.log("switcher-serve --sqlite PATH | --data-dir DIR | inject HASNA_SWITCHER_DATABASE_URL\n  --host HOST (127.0.0.1) --port PORT (8080; 0 allocates a port) --json --version\nRequires HASNA_SWITCHER_API_KEY (24+ characters). Provider credentials: SWITCHER_PROVIDER_* environment references."); return; }
  const port = Number(values.port ?? process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Fault(400, "invalid_port", "Port must be an integer between 0 and 65535.");
  // hasna-credential-seam-waiver: inbound service verifier, never an outbound client credential; restart the service to rotate this operator token.
  const apiKey = process.env.HASNA_SWITCHER_API_KEY ?? "";
  if (apiKey.length < 24) throw new Fault(500, "auth_config", "Set HASNA_SWITCHER_API_KEY to a random token of at least 24 characters.");
  if (values.sqlite && values["data-dir"]) throw new Fault(400, "storage_config", "Choose --sqlite or --data-dir.");
  const store = await Store.open({databaseUrl: process.env.HASNA_SWITCHER_DATABASE_URL, sqlitePath: values.sqlite ?? (values["data-dir"] ? join(values["data-dir"], "switcher.db") : process.env.HASNA_SWITCHER_SQLITE_PATH)});
  const server = Bun.serve({hostname: values.host ?? "127.0.0.1", port, maxRequestBodySize: 1024 * 1024, idleTimeout: 60, fetch: createHandler(store, apiKey)});
  console.log(JSON.stringify({event: "listening", version: VERSION, url: server.url.href, storage: store.engine}));
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await server.stop(); await store.close(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
if (import.meta.main) main().catch(error => { console.error(JSON.stringify({error: error instanceof Fault ? error.message : "Server startup failed; check configuration."})); process.exitCode = 1; });
