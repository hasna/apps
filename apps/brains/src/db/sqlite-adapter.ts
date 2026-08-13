import { Database as BunDatabase } from "bun:sqlite";

export class SqliteAdapter {
  readonly raw: BunDatabase;

  constructor(path: string) {
    this.raw = new BunDatabase(path);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): any {
    return this.raw.prepare(sql);
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return this.raw.prepare(sql).run(...(values as any[]));
  }

  all(sql: string, ...params: unknown[]): unknown[] {
    const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return this.raw.prepare(sql).all(...(values as any[]));
  }

  get(sql: string, ...params: unknown[]): unknown {
    const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return this.raw.prepare(sql).get(...(values as any[]));
  }

  close(): void {
    this.raw.close();
  }
}
