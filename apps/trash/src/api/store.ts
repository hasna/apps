import { SQL } from "bun";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { apiKeyMigrations, type AuthQueryClient } from "@hasna/contracts/auth";
import { ApiError, compactEntry, requestDigest, type Entry, type ListQuery, type Station, type StationInput } from "./domain.js";

export type Transaction = Pick<SQL, "unsafe">;
const DOMAIN_SCHEMA = `
CREATE TABLE trash_stations (
  tenant TEXT NOT NULL, id UUID NOT NULL, name TEXT NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY (tenant, id), UNIQUE (tenant, name)
);
CREATE TABLE trash_station_keys (
  tenant TEXT NOT NULL, kid TEXT NOT NULL, station_id UUID NOT NULL,
  PRIMARY KEY (tenant, kid), FOREIGN KEY (tenant, station_id) REFERENCES trash_stations (tenant, id)
);
CREATE TABLE trash_entries (
  tenant TEXT NOT NULL, id UUID NOT NULL, station_id UUID NOT NULL, version INTEGER NOT NULL,
  state TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ,
  held BOOLEAN NOT NULL, backup TEXT NOT NULL, kind TEXT NOT NULL,
  original_path TEXT NOT NULL, agent_name TEXT NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY (tenant, id), FOREIGN KEY (tenant, station_id) REFERENCES trash_stations (tenant, id)
);
CREATE INDEX trash_entries_page ON trash_entries (tenant, captured_at DESC, id DESC);
CREATE INDEX trash_entries_station_page ON trash_entries (tenant, station_id, captured_at DESC, id DESC);
CREATE INDEX trash_entries_expiry ON trash_entries (expires_at) WHERE state = 'trashed' AND held = false;
CREATE TABLE trash_idempotency (
  tenant TEXT NOT NULL, principal TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
  digest TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, principal, operation, key)
);
`;
const migrations = () => [
  { id: "trash_domain_0001", sql: DOMAIN_SCHEMA },
  ...apiKeyMigrations(),
].map((migration) => ({ ...migration, checksum: createHash("sha256").update(migration.sql).digest("hex") }));

type Cursor = { v: 1; tenant: string; filter: string; before: [string, string]; until: number };

export class PgTrashStore {
  readonly sql: SQL;
  #cursorSecret: Buffer;

  private constructor(sql: SQL, cursorSecret: string | undefined) {
    this.sql = sql;
    this.#cursorSecret = cursorSecret ? createHash("sha256").update(`trash-pagination-v1\0${cursorSecret}`).digest() : randomBytes(32);
  }

  static async open(databaseUrl: string, options: { migrate?: boolean; cursorSecret?: string } = {}) {
    if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new ApiError(500, "storage_config", "Trash requires a PostgreSQL database URL.");
    const sql = new SQL(databaseUrl, { max: 10, connectionTimeout: 10, idleTimeout: 20 });
    const store = new PgTrashStore(sql, options.cursorSecret);
    try {
      if (options.migrate) await store.migrate();
      await store.verifySchema();
      return store;
    } catch {
      await sql.close().catch(() => {});
      throw new ApiError(503, "storage_unavailable", "Trash database initialization failed; check connectivity and migrations.");
    }
  }

  private async migrate() {
    await this.sql.begin(async (tx) => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(781830612)");
      await tx.unsafe("CREATE TABLE IF NOT EXISTS trash_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL)");
      const completed = await tx.unsafe("SELECT id, checksum FROM trash_migrations ORDER BY id");
      const known = new Map(migrations().map((migration) => [migration.id, migration.checksum]));
      for (const row of completed) if (known.get(row.id) !== row.checksum) throw new Error("Unknown or changed migration");
      const applied = new Set(completed.map((row: { id: string }) => String(row.id)));
      for (const migration of migrations()) {
        if (applied.has(migration.id)) continue;
        await tx.unsafe(migration.sql);
        await tx.unsafe("INSERT INTO trash_migrations (id, checksum) VALUES ($1, $2)", [migration.id, migration.checksum]);
      }
    });
  }

  private async verifySchema() {
    const rows = await this.sql.unsafe("SELECT id, checksum FROM trash_migrations ORDER BY id");
    const actual = new Map(rows.map((row: { id: string; checksum: string }) => [String(row.id), String(row.checksum)]));
    const expected = migrations();
    if (actual.size !== expected.length || expected.some((item) => actual.get(item.id) !== item.checksum)) throw new Error("Unsupported schema");
  }

  async ready() { await this.sql.unsafe("SELECT 1 AS ok"); }
  async close() { await this.sql.close(); }

  authQueryClient(connection: Transaction = this.sql): AuthQueryClient {
    return {
      many: async <T extends Record<string, unknown>>(query: string, parameters: readonly unknown[] = []): Promise<T[]> => await connection.unsafe(query, [...parameters]) as T[],
      get: async <T extends Record<string, unknown>>(query: string, parameters: readonly unknown[] = []): Promise<T | null> => (await connection.unsafe(query, [...parameters]) as T[])[0] ?? null,
      execute: async (query, parameters = []) => { await connection.unsafe(query, [...parameters]); },
    };
  }

  /** The receipt and domain writes commit together. A failed action leaves neither. */
  async mutate<T>(tenant: string, principal: string, operation: string, key: string, request: unknown, action: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, "idempotency_required", "Supply an Idempotency-Key of 8–128 identity characters.");
    const digest = requestDigest(request);
    return await this.sql.begin(async (tx) => {
      const inserted = await tx.unsafe(`INSERT INTO trash_idempotency (tenant, principal, operation, key, digest, response)
        VALUES ($1, $2, $3, $4, $5, 'null'::jsonb) ON CONFLICT DO NOTHING RETURNING key`, [tenant, principal, operation, key, digest]);
      if (!inserted.length) {
        const rows = await tx.unsafe("SELECT digest, response FROM trash_idempotency WHERE tenant=$1 AND principal=$2 AND operation=$3 AND key=$4", [tenant, principal, operation, key]);
        if (rows[0]?.digest !== digest) throw new ApiError(409, "idempotency_conflict", "This idempotency key belongs to a different request.");
        return rows[0]!.response as T;
      }
      const response = await action(tx);
      await tx.unsafe("UPDATE trash_idempotency SET response=$5::text::jsonb WHERE tenant=$1 AND principal=$2 AND operation=$3 AND key=$4", [tenant, principal, operation, key, JSON.stringify(response)]);
      return response;
    }) as T;
  }

  async registerStation(tenant: string, kid: string, input: StationInput, transaction?: Transaction): Promise<Station> {
    const register = async (tx: Transaction) => {
      // Registration is rare; serialize name/key binding decisions per tenant.
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`trash-stations:${tenant}`]);
      const bound = await tx.unsafe("SELECT station_id FROM trash_station_keys WHERE tenant=$1 AND kid=$2", [tenant, kid]);
      const named = await tx.unsafe("SELECT payload FROM trash_stations WHERE tenant=$1 AND name=$2", [tenant, input.name]);
      if (bound.length && (!named.length || bound[0]!.station_id !== named[0]!.payload.id)) {
        throw new ApiError(409, "station_conflict", "This key is already bound to another station.");
      }
      const now = new Date().toISOString();
      const station: Station = { ...input, id: named[0]?.payload.id ?? randomUUID(), createdAt: named[0]?.payload.createdAt ?? now, updatedAt: now };
      await tx.unsafe(`INSERT INTO trash_stations (tenant,id,name,payload) VALUES ($1,$2,$3,$4::text::jsonb)
        ON CONFLICT (tenant,id) DO UPDATE SET payload=EXCLUDED.payload`, [tenant, station.id, station.name, JSON.stringify(station)]);
      await tx.unsafe("INSERT INTO trash_station_keys (tenant,kid,station_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tenant, kid, station.id]);
      return station;
    };
    return transaction ? await register(transaction) : await this.sql.begin(register) as Station;
  }

  async stationForKey(tenant: string, kid: string, tx: Transaction = this.sql): Promise<Station> {
    const rows = await tx.unsafe(`SELECT s.payload FROM trash_stations s JOIN trash_station_keys k ON s.tenant=k.tenant AND s.id=k.station_id
      WHERE k.tenant=$1 AND k.kid=$2`, [tenant, kid]);
    if (!rows.length) throw new ApiError(409, "station_setup_required", "Register this station before capturing files.");
    return rows[0]!.payload as Station;
  }

  async entry(tenant: string, id: string, tx: Transaction = this.sql, lock = false): Promise<Entry> {
    const rows = await tx.unsafe(`SELECT payload FROM trash_entries WHERE tenant=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [tenant, id]);
    if (!rows.length) throw new ApiError(404, "not_found", "Trash entry was not found.");
    return rows[0]!.payload as Entry;
  }

  async insertEntry(tenant: string, entry: Entry, tx: Transaction): Promise<Entry> {
    const rows = await tx.unsafe(`INSERT INTO trash_entries
      (tenant,id,station_id,version,state,captured_at,expires_at,held,backup,kind,original_path,agent_name,payload)
      VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13::text::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`, [tenant, entry.id, entry.stationId, entry.version, entry.state, entry.capturedAt,
      entry.expiresAt, entry.held, entry.backup, entry.kind, entry.originalPath, entry.agent.name, JSON.stringify(entry)]);
    if (!rows.length) throw new ApiError(409, "entry_exists", "This capture identity already exists; inspect it before retrying.");
    return entry;
  }

  async replaceEntry(tenant: string, entry: Entry, version: number, tx: Transaction): Promise<Entry> {
    const next = { ...entry, version: version + 1 };
    const rows = await tx.unsafe(`UPDATE trash_entries SET version=$3,state=$4,expires_at=$5::timestamptz,held=$6,backup=$7,payload=$8::text::jsonb
      WHERE tenant=$1 AND id=$2 AND version=$9 RETURNING id`, [tenant, next.id, next.version, next.state, next.expiresAt, next.held, next.backup, JSON.stringify(next), version]);
    if (!rows.length) throw new ApiError(409, "version_conflict", "The entry changed; reload before retrying.");
    return next;
  }

  private cursorSignature(encoded: string): Buffer { return createHmac("sha256", this.#cursorSecret).update(encoded).digest(); }

  private readCursor(value: string, tenant: string, filter: string): Cursor {
    try {
      const parts = value.split(".");
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) throw new Error();
      if (!timingSafeEqual(this.cursorSignature(parts[0]!), Buffer.from(parts[1]!, "base64url"))) throw new Error();
      const cursor = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Cursor;
      if (cursor.v !== 1 || cursor.tenant !== tenant || cursor.filter !== filter || !Number.isSafeInteger(cursor.until) || cursor.until < Date.now() ||
        !Array.isArray(cursor.before) || cursor.before.length !== 2 || !Number.isFinite(Date.parse(cursor.before[0])) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(cursor.before[1])) throw new Error();
      return cursor;
    } catch { throw new ApiError(400, "invalid_cursor", "The cursor is invalid, expired, or belongs to different filters."); }
  }

  async list(tenant: string, query: ListQuery) {
    const { cursor: encoded, limit, ...filters } = query;
    const filter = requestDigest(filters);
    const cursor = encoded ? this.readCursor(encoded, tenant, filter) : undefined;
    const values: unknown[] = [tenant];
    const clauses = ["e.tenant=$1"];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (filters.station) clauses.push(`s.name=${parameter(filters.station)}`);
    if (filters.agent) clauses.push(`e.agent_name=${parameter(filters.agent)}`);
    if (filters.path) clauses.push(`e.original_path ILIKE ${parameter(`%${filters.path.replace(/[!%_]/g, (char) => `!${char}`)}%`)} ESCAPE '!'`);
    if (filters.kind) clauses.push(`e.kind=${parameter(filters.kind)}`);
    if (filters.state) clauses.push(`e.state=${parameter(filters.state)}`);
    else clauses.push("e.state NOT IN ('restored','expired')");
    if (filters.backup) clauses.push(`e.backup=${parameter(filters.backup)}`);
    if (filters.held) clauses.push(`e.held=${parameter(filters.held === "true")}`);
    if (cursor) clauses.push(`(e.captured_at,e.id) < (${parameter(cursor.before[0])}::timestamptz,${parameter(cursor.before[1])}::uuid)`);
    const rows = await this.sql.unsafe(`SELECT e.payload FROM trash_entries e JOIN trash_stations s ON e.tenant=s.tenant AND e.station_id=s.id
      WHERE ${clauses.join(" AND ")} ORDER BY e.captured_at DESC,e.id DESC LIMIT ${parameter(limit + 1)}`, values);
    const entries = rows.slice(0, limit).map((row: { payload: Entry }) => row.payload);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = entries.at(-1)!;
      const next: Cursor = { v: 1, tenant, filter, before: [last.capturedAt, last.id], until: cursor?.until ?? Date.now() + 3_600_000 };
      const body = Buffer.from(JSON.stringify(next)).toString("base64url");
      nextCursor = `${body}.${this.cursorSignature(body).toString("base64url")}`;
    }
    return { items: entries.map(compactEntry), nextCursor };
  }
}
