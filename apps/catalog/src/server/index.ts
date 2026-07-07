#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { AppLifecycleSchema, ReleaseChannelSchema } from "../contracts.js";
import { CatalogStore } from "../store.js";
import type { CatalogStoreLike } from "../types.js";
import { VERSION } from "../version.js";

export interface CatalogApiOptions {
  store?: CatalogStoreLike;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Minimal read-only HTTP handler:
 *   GET /health
 *   GET /v1/apps?lifecycle=&channel=&limit=&offset=
 *   GET /v1/apps/:appId
 *   GET /v1/search?q=
 */
export function createCatalogHandler(options: CatalogApiOptions = {}): (request: Request) => Response {
  const store = options.store ?? new CatalogStore();
  return (request: Request): Response => {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return json({ error: "catalog is a read model; only GET is supported" }, 405);
    }
    if (url.pathname === "/health") {
      return json({ status: "ok", service: "catalog", version: VERSION, apps: store.countApps() });
    }
    if (url.pathname === "/v1/apps") {
      const lifecycle = AppLifecycleSchema.safeParse(url.searchParams.get("lifecycle") ?? undefined);
      const channel = ReleaseChannelSchema.safeParse(url.searchParams.get("channel") ?? undefined);
      const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
      const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
      const apps = store.listApps({
        lifecycle: lifecycle.success ? lifecycle.data : undefined,
        channel: channel.success ? channel.data : undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
      });
      return json({ apps, count: apps.length });
    }
    const appMatch = url.pathname.match(/^\/v1\/apps\/([a-z0-9-]+)$/);
    if (appMatch) {
      const app = store.getApp(appMatch[1]!);
      if (!app) return json({ error: `app not found: ${appMatch[1]}` }, 404);
      return json({ app });
    }
    if (url.pathname === "/v1/search") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (!query) return json({ error: "missing query parameter: q" }, 400);
      const apps = store.searchApps(query);
      return json({ apps, count: apps.length, query });
    }
    return json({ error: "not found" }, 404);
  };
}

export interface StartCatalogServerOptions extends CatalogApiOptions {
  host?: string;
  port?: number;
}

export function startCatalogServer(options: StartCatalogServerOptions = {}): ReturnType<typeof Bun.serve> {
  const host = options.host ?? process.env["CATALOG_HOST"] ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env["CATALOG_PORT"] ?? "8797", 10);
  const handler = createCatalogHandler(options);
  return Bun.serve({ hostname: host, port, fetch: handler });
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
    },
    allowPositionals: false,
  });
  const server = startCatalogServer({
    host: parsed.values.host,
    port: parsed.values.port ? Number.parseInt(parsed.values.port, 10) : undefined,
  });
  console.log(`Open Catalog API listening on http://${server.hostname}:${server.port}`);
}

if (import.meta.main) {
  await main();
}
