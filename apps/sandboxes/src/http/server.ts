#!/usr/bin/env bun
/**
 * Self-hosted sandboxes HTTP server (bin: sandboxes-serve).
 *
 * Serve path targets Postgres (control plane) + S3 (checkpoint blobs). Falls
 * back to an in-memory store only when no DATABASE_URL is configured (local /
 * test). Public GET /health is unauthenticated (ALB target-group health check);
 * everything under /v1 is fail-closed authed + tenant-scoped.
 *
 *   sandboxes-serve            start the server
 *   sandboxes-serve migrate    apply idempotent control-plane migrations, exit
 */
import { authConfigFromEnv } from "./auth.js";
import { blobStoreFromEnv } from "./blobstore.js";
import { handleRequest, type RouteDeps } from "./routes.js";
import { InMemoryControlPlaneStore } from "./store-memory.js";
import { PostgresControlPlaneStore } from "./store-postgres.js";
import type { AdapterId, ControlPlaneStore } from "./store.js";

export const SERVER_VERSION = "1.0.0-rc.1";

function envFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function buildStore(env: Record<string, string | undefined> = process.env): ControlPlaneStore {
  const url = env["HASNA_SANDBOXES_DATABASE_URL"];
  if (url) return new PostgresControlPlaneStore(url);
  return new InMemoryControlPlaneStore();
}

export function liveAdaptersFromEnv(env: Record<string, string | undefined> = process.env): Set<AdapterId> {
  const live = new Set<AdapterId>();
  if (env["HASNA_SANDBOXES_E2B_API_KEY"]) live.add("e2b");
  if (env["HASNA_SANDBOXES_DAYTONA_API_KEY"]) live.add("daytona_cloud");
  return live;
}

export function buildDeps(store: ControlPlaneStore, env: Record<string, string | undefined> = process.env): RouteDeps {
  return {
    store,
    blobStore: blobStoreFromEnv(env),
    auth: authConfigFromEnv(env),
    version: SERVER_VERSION,
    liveAdapters: liveAdaptersFromEnv(env),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: sandboxes-serve [migrate] [--port <port>]\n");
    return;
  }

  const store = buildStore();

  if (argv[0] === "migrate") {
    await store.migrate();
    const health = await store.health();
    process.stdout.write(`migrated backend=${health.backend} tenants=${health.tenants}\n`);
    await store.close();
    return;
  }

  // Memory store always seeds; postgres migrates only when explicitly asked
  // (change-window discipline for the shared RDS) or AUTO_MIGRATE is set.
  if (store.backend === "memory" || envFlag(process.env["HASNA_SANDBOXES_AUTO_MIGRATE"])) {
    await store.migrate();
  }

  const deps = buildDeps(store);
  const port = Number(process.env["PORT"] ?? "8080");
  const hostname = process.env["HOST"] ?? "0.0.0.0";

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 30,
    fetch: (req) => handleRequest(req, deps),
  });

  process.stdout.write(
    `sandboxes-serve listening on http://${hostname}:${server.port} backend=${store.backend} blobs=${deps.blobStore.kind}\n`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.stop();
      void store.close().finally(() => process.exit(0));
    });
  }
}

if (import.meta.main) {
  void main();
}
