#!/usr/bin/env bun
import { ApiError } from "../api/domain.js";
import { PgTrashStore } from "../api/store.js";
import { createTrashHandler } from "../api/service.js";
import { createS3Objects } from "../api/s3.js";
import { sweepExpired } from "../api/retention.js";
import { VERSION } from "../version.js";
import { serverConfig } from "./config.js";

export async function main(args = process.argv.slice(2)) {
  const config = serverConfig(args);
  if (config.command === "version") { console.log(VERSION); return; }
  if (config.command === "help") {
    console.log("trash-serve [migrate] [--host 0.0.0.0] [--port 8080]\nRuntime: HASNA_TRASH_DATABASE_URL, HASNA_TRASH_API_SIGNING_KEY, HASNA_TRASH_S3_BUCKET, HASNA_TRASH_S3_REGION.\nMigrations require only HASNA_TRASH_DATABASE_URL and exit after verification."); return;
  }
  if (config.command === "migrate") {
    const store = await PgTrashStore.open(config.databaseUrl, { migrate: true });
    try { await store.ready(); } finally { await store.close(); }
    console.log(JSON.stringify({ event: "migrated", app: "trash", version: VERSION, storage: "postgresql" })); return;
  }
  const store = await PgTrashStore.open(config.databaseUrl, { cursorSecret: config.signingSecret });
  try {
    const objects = createS3Objects(config.s3);
    await objects.ready();
    const server = Bun.serve({ hostname: config.hostname, port: config.port, maxRequestBodySize: 64 * 1024, idleTimeout: 180,
      fetch: createTrashHandler(store, objects, { signingSecret: config.signingSecret }),
    });
    let stopping = false; let running: Promise<void> | null = null;
    const tick = () => {
      if (stopping || running) return;
      running = sweepExpired(store, objects).then((result) => {
        if (result.expired || result.failed) console.log(JSON.stringify({ event: "retention", ...result }));
      }).catch(() => { console.error(JSON.stringify({ event: "retention_failed", retry: "next_tick" })); })
        .finally(() => { running = null; });
    };
    const timer = setInterval(tick, 60_000); tick();
    console.log(JSON.stringify({ event: "listening", app: "trash", version: VERSION, hostname: config.hostname, port: server.port, storage: "postgresql" }));
    const stop = async () => {
      if (stopping) return; stopping = true; clearInterval(timer);
      await server.stop(false); await running; await store.close();
    };
    const shutdown = () => { void stop().catch(() => { console.error("Trash shutdown failed."); process.exitCode = 1; }); };
    process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  } catch (error) { await store.close(); throw error; }
}

if (import.meta.main) main().catch((error) => {
  console.error(JSON.stringify({ error: { code: error instanceof ApiError ? error.code : "startup_failed", message: "Trash startup failed; check runtime configuration and migrations." } }));
  process.exitCode = 1;
});
