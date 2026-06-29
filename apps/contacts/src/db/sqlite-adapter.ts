import { Database as BunDatabase } from "bun:sqlite";

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

export class SqliteAdapter {
  readonly raw: BunDatabase;

  constructor(path: string) {
    this.raw = new BunDatabase(path);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    return this.raw.prepare(sql);
  }

  query(sql: string) {
    return this.raw.prepare(sql);
  }

  run(sql: string, ...params: unknown[]): unknown {
    return this.raw.prepare(sql).run(...(normalizeParams(params) as any[]));
  }

  all(sql: string, ...params: unknown[]): unknown[] {
    return this.raw.prepare(sql).all(...(normalizeParams(params) as any[]));
  }

  get(sql: string, ...params: unknown[]): unknown {
    return this.raw.prepare(sql).get(...(normalizeParams(params) as any[]));
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  close(): void {
    this.raw.close();
  }
}

export function bindParams(params: unknown[]): unknown[] {
  return normalizeParams(params);
}
