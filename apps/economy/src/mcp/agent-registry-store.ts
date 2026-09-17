/**
 * @hasna/economy — the agent-lifecycle registry's SQL engine.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Split out of `./agent-registry.ts` so the MCP bundle never carries a
 * `bun:sqlite` reference: `agent-registry.ts` reaches this module through ONE
 * awaited dynamic import on first tool use, and `build:mcp` (with
 * `--splitting`) emits it to `dist/chunks/` instead of `dist/mcp`
 * (fleet-alignment ruling d, 2026-09-11; hasna/apps#1720).
 *
 * A HOSTED client gets the process-local `:memory:` database — no file is
 * created under the app home — and only the explicit local opt-in
 * (`HASNA_ECONOMY_LOCAL=1`) persists `agent-registry.db` beside economy's own
 * store. That decision is made by `resolveRegistryDbPath()` in
 * `./agent-registry.ts`; this module only opens what it is handed.
 */
import { Database } from 'bun:sqlite'
import { dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'

/** bun:sqlite's in-memory database: no file, process-local. */
export const MEMORY_REGISTRY_PATH = ':memory:'

/** The get/all/run/exec surface the registry logic is written against. */
export interface SqlLike {
  get(sql: string, ...params: unknown[]): Record<string, unknown> | null
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>
  run(sql: string, ...params: unknown[]): { changes: number }
  exec(sql: string): void
}

/**
 * Minimal bun:sqlite wrapper exposing the get/all/run/exec surface the
 * registry uses. `Database` itself only has run/exec/query/prepare on bun
 * 1.3.x — the deleted @hasna/agent-registry package got get/all from the
 * storage kit's own sqlite wrapper; this keeps the same call shape without
 * the kit.
 */
export class RegistryDb implements SqlLike {
  private db: Database;

  constructor(path: string) {
    if (path !== MEMORY_REGISTRY_PATH && dirname(path) && !existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 10000");
  }

  get(sql: string, ...params: unknown[]): Record<string, unknown> | null {
    return this.db.prepare(sql).get(...(params as any[])) as Record<string, unknown> | null;
  }

  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    return this.db.prepare(sql).run(...(params as any[]));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
