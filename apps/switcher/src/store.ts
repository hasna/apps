import { SQL } from "bun";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Fault } from "./domain";

type Connection = Pick<SQL, "unsafe">;
export type Resource = "providers" | "profiles" | "runs" | "catalogs";
export type RecordValue = {id: string; version: number; updatedAt: string; [key: string]: unknown};
export class Store {
  private tail: Promise<unknown> = Promise.resolve();
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.engine !== "sqlite") return action();
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => {});
    return next;
  }
  readonly sql: SQL;
  readonly engine: "sqlite" | "postgresql";
  private constructor(sql: SQL, engine: "sqlite" | "postgresql") { this.sql = sql; this.engine = engine; }
  static async open(config: {databaseUrl?: string; sqlitePath?: string}) {
    if (!!config.databaseUrl === !!config.sqlitePath) throw new Fault(500, "storage_config", "Choose exactly one PostgreSQL URL or SQLite path.");
    const engine = config.databaseUrl ? "postgresql" : "sqlite";
    if (config.databaseUrl && !/^postgres(ql)?:\/\//.test(config.databaseUrl))
      throw new Fault(500, "storage_config", "Database URL must use PostgreSQL.");
    const file = config.sqlitePath;
    if (engine === "sqlite" && file !== ":memory:") await mkdir(dirname(resolve(file!)), {recursive: true, mode: 0o700});
    const deadline = Date.now() + 10_000;
    for (let attempt = 0; ; attempt++) {
      let sql: SQL | undefined;
      try {
        sql = engine === "postgresql" ? new SQL(config.databaseUrl!) : new SQL({adapter: "sqlite", filename: file!});
        if (engine === "sqlite") {
          // Bun opens SQLite lazily on the first query; that connection itself
          // can encounter SQLITE_BUSY before busy_timeout has taken effect.
          await sql.unsafe("PRAGMA busy_timeout = 5000");
          await sql.unsafe("PRAGMA foreign_keys = ON");
          await sql.unsafe("PRAGMA journal_mode = WAL");
          if (file !== ":memory:") await chmod(file!, 0o600);
        }
        const store = new Store(sql, engine);
        await store.migrate();
        return store;
      } catch (error) {
        await sql?.close().catch(() => {});
        const code = (error as {code?: string})?.code;
        if (engine === "sqlite" && ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED"].includes(code ?? "") && Date.now() < deadline) {
          // Retry a fresh connection after the failed transaction is closed.
          // Never retry arbitrary configuration, permission or schema failures.
          await new Promise(resolve => setTimeout(resolve, Math.min(200, 20 * (attempt + 1))));
          continue;
        }
        throw new Fault(500, "storage_unavailable", "Database startup failed; check configuration, permissions and other database users.");
      }
    }
  }
  private async migrate() {
    await this.sql.begin(async tx => {
      if (this.engine === "postgresql") await tx.unsafe("SELECT pg_advisory_xact_lock(782034215)");
      await tx.unsafe("CREATE TABLE IF NOT EXISTS switcher_migrations (version INTEGER PRIMARY KEY)");
      const versions = await tx.unsafe("SELECT version FROM switcher_migrations ORDER BY version");
      if (versions.some((v: any) => v.version > 1)) throw new Error("Newer database schema");
      if (versions.length) return;
      await tx.unsafe("CREATE TABLE switcher_providers (id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)");
      await tx.unsafe("CREATE TABLE switcher_profiles (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES switcher_providers(id), version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)");
      await tx.unsafe("CREATE TABLE switcher_catalogs (id TEXT PRIMARY KEY REFERENCES switcher_providers(id) ON DELETE CASCADE, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)");
      await tx.unsafe("CREATE TABLE switcher_runs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES switcher_profiles(id), version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)");
      await tx.unsafe("CREATE TABLE switcher_idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)");
      await tx.unsafe("INSERT INTO switcher_migrations(version) VALUES (1)");
    });
  }
  async ready() { await this.exclusive(async () => { await this.sql.unsafe("SELECT 1"); }); }
  async close() { await this.tail; await this.sql.close(); }
  async get<T>(kind: Resource, id: string, db: Connection = this.sql): Promise<T> {
    if (db === this.sql && this.engine === "sqlite") return this.exclusive(() => this.read<T>(kind, id, db));
    return this.read<T>(kind, id, db);
  }
  private async read<T>(kind: Resource, id: string, db: Connection): Promise<T> {
    const rows = await db.unsafe(`SELECT payload FROM switcher_${kind} WHERE id = $1`, [id]);
    if (!rows.length) throw new Fault(404, "not_found", `${kind} entry was not found.`);
    return JSON.parse(rows[0].payload) as T;
  }
  async list<T>(kind: Resource, {limit = 100, offset = 0, search = ""} = {}): Promise<{data: T[]; total: number; limit: number; offset: number}> {
    return this.exclusive(async () => {
    const name = this.engine === "sqlite" ? "json_extract(payload, '$.name')" : "payload::jsonb->>'name'";
    const pattern = `%${search.toLowerCase().replace(/[!%_]/g, c => "!" + c)}%`;
    const where = `LOWER(id) LIKE $1 ESCAPE '!' OR LOWER(COALESCE(${name}, '')) LIKE $1 ESCAPE '!'`;
    const total = await this.sql.unsafe(`SELECT COUNT(*) AS total FROM switcher_${kind} WHERE ${where}`, [pattern]);
    const rows = await this.sql.unsafe(`SELECT payload FROM switcher_${kind} WHERE ${where} ORDER BY id LIMIT $2 OFFSET $3`, [pattern, limit, offset]);
    return {data: rows.map((r: any) => JSON.parse(r.payload)), total: Number(total[0].total), limit, offset};
    });
  }
  async put(kind: Resource, input: Record<string, any>, expectedVersion: number | undefined, db: Connection): Promise<any> {
    const now = new Date().toISOString();
    const value = {...input, version: expectedVersion === undefined ? 1 : expectedVersion + 1, updatedAt: now};
    if (expectedVersion === undefined) {
      const extraColumn = kind === "profiles" ? ", provider_id" : kind === "runs" ? ", profile_id" : "";
      const extraValue = kind === "profiles" ? input.providerId : kind === "runs" ? input.profileId : undefined;
      await db.unsafe(`INSERT INTO switcher_${kind} (id, version, updated_at, payload${extraColumn}) VALUES ($1, $2, $3, $4${extraColumn ? ", $5" : ""})`,
        [input.id, value.version, now, JSON.stringify(value), ...(extraColumn ? [extraValue] : [])]);
    } else {
      const extra = kind === "profiles" ? ", provider_id = $4" : "";
      // Keep placeholders in lexical order: Bun's SQLite adapter binds by
      // occurrence whereas PostgreSQL respects the numeric parameter label.
      const rows = await db.unsafe(`UPDATE switcher_${kind} SET version = $1, updated_at = $2, payload = $3${extra} WHERE id = $${extra ? 5 : 4} AND version = $${extra ? 6 : 5} RETURNING id`,
        [value.version, now, JSON.stringify(value), ...(extra ? [input.providerId] : []), input.id, expectedVersion]);
      if (!rows.length) throw new Fault(409, "version_conflict", "Entry changed or is missing; reload before retrying.");
    }
    return value;
  }
  async remove(kind: "providers" | "profiles", id: string, version: number, db: Connection) {
    const rows = await db.unsafe(`DELETE FROM switcher_${kind} WHERE id = $1 AND version = $2 RETURNING id`, [id, version]);
    if (!rows.length) throw new Fault(409, "version_conflict", "Entry changed or is missing; reload before retrying.");
    return {deleted: id};
  }
  async mutate<T>(key: string, fingerprint: string, action: (db: Connection) => Promise<T>): Promise<T> {
    return this.exclusive(() => this.transaction(key, fingerprint, action));
  }
  async replay(key: string, fingerprint: string): Promise<{found: false} | {found: true; value: unknown}> {
    return this.exclusive(async () => {
      const rows = await this.sql.unsafe("SELECT fingerprint, payload FROM switcher_idempotency WHERE key = $1", [key]);
      if (!rows.length) return {found: false};
      if (rows[0].fingerprint !== fingerprint) throw new Fault(409, "idempotency_conflict", "Idempotency key was already used for a different request.");
      return {found: true, value: JSON.parse(rows[0].payload)};
    });
  }
  private async transaction<T>(key: string, fingerprint: string, action: (db: Connection) => Promise<T>): Promise<T> {
    try {
      return await this.sql.begin(async tx => {
        const inserted = await tx.unsafe("INSERT INTO switcher_idempotency (key, fingerprint, payload, created_at) VALUES ($1, $2, '', $3) ON CONFLICT (key) DO NOTHING RETURNING key", [key, fingerprint, new Date().toISOString()]);
        if (!inserted.length) {
          const rows = await tx.unsafe("SELECT fingerprint, payload FROM switcher_idempotency WHERE key = $1", [key]);
          if (rows[0].fingerprint !== fingerprint) throw new Fault(409, "idempotency_conflict", "Idempotency key was already used for a different request.");
          return JSON.parse(rows[0].payload) as T;
        }
        const value = await action(tx);
        await tx.unsafe("UPDATE switcher_idempotency SET payload = $1 WHERE key = $2", [JSON.stringify(value), key]);
        return value;
      });
    } catch (error) {
      if (error instanceof Fault) throw error;
      // Database messages may contain DSNs or payload values. Never expose them.
      const code = String(this.engine === "postgresql" ? (error as any)?.errno : (error as any)?.code);
      if (["23505", "23503", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_FOREIGNKEY"].includes(code))
        throw new Fault(409, "conflict", "Duplicate entry or an entry still referenced by another resource.");
      throw new Fault(503, "storage_unavailable", "Storage operation failed.");
    }
  }
}
