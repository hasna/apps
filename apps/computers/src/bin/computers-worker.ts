#!/usr/bin/env bun
import { createProviderPorts } from "../providers";
import { SQLiteStorage } from "../storage";
import { OperationWorker } from "../worker";
import { validateId } from "../validation";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : Bun.argv[index + 1];
}

try {
  const allowed = new Set(["--db", "--tenant"]);
  for (let index = 2; index < Bun.argv.length; index += 2) if (!allowed.has(Bun.argv[index] ?? "") || Bun.argv[index + 1] === undefined) throw new Error("invalid arguments");
  const rawPath = option("db") ?? Bun.env.COMPUTERS_DB ?? "./computers.db";
  if (rawPath.includes("\0")) throw new Error("invalid path");
  const path = rawPath === ":memory:" ? rawPath : resolve(rawPath);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const storage = new SQLiteStorage(path);
  storage.migrate();
  const worker = new OperationWorker(storage, createProviderPorts());
  const handled = await worker.runTenant(validateId(option("tenant") ?? Bun.env.COMPUTERS_TENANT ?? "tenant_local", "tenant"));
  process.stdout.write(`${JSON.stringify({ handled, providerAdaptersConfigured: false })}\n`);
  storage.close();
} catch { process.stderr.write(`${JSON.stringify({ error: { code: "worker_error", message: "Worker execution failed" } })}\n`); process.exitCode = 1; }
