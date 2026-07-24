#!/usr/bin/env bun
import { resolveConfig } from "../lib/config.js";
import { createAuthStorage } from "../lib/storage/index.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { createApp } from "./app.js";

/** `personalnotes-serve` — start the multi-tenancy backend HTTP API. */
export async function startServer(port = Number(process.env.PORT ?? 3366)): Promise<void> {
  const config = resolveConfig();
  const storage = await createAuthStorage(config);
  const app = createApp({ storage, config });

  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(
    `[personalnotes] multi-tenancy backend v${PACKAGE_VERSION} listening on http://localhost:${server.port} ` +
      `(mode=${config.mode}, storage=${storage.backend})`,
  );

  const shutdown = async () => {
    await storage.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  startServer().catch((err) => {
    console.error("[personalnotes] failed to start", err);
    process.exit(1);
  });
}

export { createApp } from "./app.js";
export type { App, AppOptions } from "./app.js";
