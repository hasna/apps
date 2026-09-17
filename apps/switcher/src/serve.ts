#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { startServer } from "./server";
import { VERSION, Fault } from "./domain";
import { Store } from "./store";
export async function main(args = process.argv.slice(2)) {
  const {values,positionals} = parseArgs({args, allowPositionals:true, options: {
    host: {type: "string"}, port: {type: "string"}, "data-dir": {type: "string"},
    sqlite: {type: "string"}, json: {type: "boolean"}, version: {type: "boolean"}, help: {type: "boolean"},
  }});
  if (values.version) { console.log(VERSION); return; }
  if (values.help) { console.log("switcher-serve [migrate] --sqlite PATH | --data-dir DIR | inject HASNA_SWITCHER_DATABASE_URL\n  --host HOST (127.0.0.1) --port PORT (8080; 0 allocates a port) --json --version\nLocal/self-hosted auth: HASNA_SWITCHER_API_KEY (24+ characters). Hosted Postgres auth: HASNA_SWITCHER_API_SIGNING_KEY (32+ characters).\nThe migrate command requires PostgreSQL and exits after applying the schema. Provider credentials: SWITCHER_PROVIDER_* environment references."); return; }
  if (positionals.length > 1 || (positionals[0] && positionals[0] !== "migrate")) throw new Fault(400,"invalid_request","Use switcher-serve, or switcher-serve migrate.");
  const port = Number(values.port ?? process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Fault(400, "invalid_port", "Port must be an integer between 0 and 65535.");
  // hasna-credential-seam-waiver: inbound service verifiers, never outbound client credentials; restart the service to rotate either value.
  const apiKey = process.env.HASNA_SWITCHER_API_KEY;
  const signingSecret = process.env.HASNA_SWITCHER_API_SIGNING_KEY ?? process.env.HASNA_API_SIGNING_KEY ?? process.env.API_KEY_SIGNING_SECRET;
  const databaseUrl = process.env.HASNA_SWITCHER_DATABASE_URL;
  if (values.sqlite && values["data-dir"]) throw new Fault(400, "storage_config", "Choose --sqlite or --data-dir.");
  if (positionals[0] === "migrate") {
    if (!databaseUrl) throw new Fault(500,"storage_config","switcher-serve migrate requires HASNA_SWITCHER_DATABASE_URL.");
    if (values.sqlite || values["data-dir"] || process.env.HASNA_SWITCHER_SQLITE_PATH) throw new Fault(400,"storage_config","switcher-serve migrate accepts only the PostgreSQL backend.");
    const store = await Store.open({databaseUrl});
    try { await store.ready(); }
    finally { await store.close(); }
    console.log(JSON.stringify({event:"migrated",version:VERSION,storage:"postgresql"}));
    return;
  }
  const server = await startServer({...apiKey?{apiKey}:{},...signingSecret?{signingSecret}:{}, hostname: values.host ?? "127.0.0.1", port,
    databaseUrl,
    sqlitePath: values.sqlite ?? (values["data-dir"] ? join(values["data-dir"], "switcher.db") : process.env.HASNA_SWITCHER_SQLITE_PATH)});
  console.log(JSON.stringify({event: "listening", version: VERSION, url: server.url, storage: server.storage}));
  const stop = () => { void server.close().catch(() => { console.error("Server shutdown failed."); process.exitCode = 1; }); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
if (import.meta.main) main().catch(error => { console.error(JSON.stringify({error: error instanceof Fault ? error.message : "Server startup failed; check configuration."})); process.exitCode = 1; });
