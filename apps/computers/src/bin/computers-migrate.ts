#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SQLiteStorage } from "../storage";

try {
  const args = Bun.argv.slice(2);
  if (args.length > 2 || (args.length > 0 && (args[0] !== "--db" || args[1] === undefined))) throw new Error("invalid arguments");
  const rawPath = Bun.env.COMPUTERS_DB ?? args[1] ?? "./computers.db";
  if (rawPath.includes("\0")) throw new Error("invalid path");
  const path = rawPath === ":memory:" ? rawPath : resolve(rawPath);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const storage = new SQLiteStorage(path);
  storage.migrate();
  const schemaVersion = (storage.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version;
  process.stdout.write(`${JSON.stringify({ migrated: true, database: path, schemaVersion })}\n`);
  storage.close();
} catch { process.stderr.write(`${JSON.stringify({ error: { code: "migration_error", message: "Database migration failed" } })}\n`); process.exitCode = 1; }
