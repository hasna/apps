#!/usr/bin/env bun
import { resolveDatabaseUrl, resolveStorageMode, scrubDatabaseUrlFromEnv } from "../config.js";
import { assertServeSafety, authRequired, buildApp, getBindHost, getPort } from "./app.js";

// Boot the Hono serve tier. Fail-closed on unsafe config; scrub the DSN after
// the store connects so child processes cannot read it via /proc or docker inspect.

function main(): void {
  const mode = resolveStorageMode();
  assertServeSafety();

  if (mode === "cloud") {
    // Cloud-ready seam: resolve the DSN (file mount preferred), then scrub it.
    const dsn = resolveDatabaseUrl();
    if (dsn) scrubDatabaseUrlFromEnv();
  }

  const app = buildApp();
  const port = getPort();
  const hostname = getBindHost();

  Bun.serve({ port, hostname, fetch: app.fetch });

  console.log(`@hasna/workforce serve on http://${hostname}:${port} (mode=${mode})`);
  console.log(`API auth ${authRequired() ? "enabled" : "disabled (loopback + local, no credentials)"}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { buildApp } from "./app.js";
