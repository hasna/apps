#!/usr/bin/env bun
import type { BearerPrincipal } from "../auth";
import { parseBearerPrincipals, serve } from "../server";
import { ComputersService } from "../service";
import { SQLiteStorage } from "../storage";
import { createLocalProviderPortsFromConfigFile } from "../local";
import { resolve } from "node:path";

function principalsFromEnvironment(): BearerPrincipal[] {
  const raw = Bun.env.COMPUTERS_AUTH;
  if (raw === undefined) return [];
  return parseBearerPrincipals(raw);
}

try {
  const principals = principalsFromEnvironment();
  const port = Number(Bun.env.COMPUTERS_PORT ?? "7788");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
  const allowedOrigins = Bun.env.COMPUTERS_ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [];
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid origin");
  }
  const storage = new SQLiteStorage(Bun.env.COMPUTERS_DB ?? "./computers.db");
  storage.migrate();
  const development = Bun.env.COMPUTERS_DEV_MODE === "loopback";
  const hostname = Bun.env.COMPUTERS_HOST ?? "127.0.0.1";
  const localConfig = Bun.env.COMPUTERS_LOCAL_CONFIG;
  const service = new ComputersService(storage, localConfig === undefined ? {} : { providers: createLocalProviderPortsFromConfigFile(resolve(localConfig)) });
  const server = serve(service, {
    hostname, port, principals, loopbackDevelopmentMode: development, allowedOrigins,
  });
  process.stdout.write(`Computers ${server.url.toString()}\n`);
  const stop = (): void => { server.stop(true); storage.close(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
} catch {
  process.stderr.write(`${JSON.stringify({ error: { code: "configuration_error", message: "Controller configuration is invalid" } })}\n`);
  process.exitCode = 1;
}
