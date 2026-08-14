// Machine registry data access, resolved to the hosted `/v1/machines` API when
// the app is flipped to the API client, else the local SQLite `machine_registry`
// table. Both implementations share the {@link MachineRecord} shape the serve
// app returns, so `machines registry ...` behaves identically online/offline and
// a flip is fully reversible by unsetting HASNA_MACHINES_API_URL/_API_KEY.

import { getDb } from "../db.js";
import { resolveCloudStorage } from "./resolve.js";
import type { HasnaStorageClient } from "./storage.js";

export interface MachineRecord {
  id: string;
  friendlyName: string | null;
  platform: string | null;
  arch: string | null;
  status: string;
  labels: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMachineInput {
  id: string;
  friendlyName?: string | null;
  platform?: string | null;
  arch?: string | null;
  status?: string;
  labels?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ListMachinesOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface MachineRegistryStore {
  readonly backend: "cloud-http" | "local";
  readonly baseUrl: string | null;
  list(options?: ListMachinesOptions): Promise<MachineRecord[]>;
  get(id: string): Promise<MachineRecord | null>;
  upsert(input: UpsertMachineInput): Promise<MachineRecord>;
  remove(id: string): Promise<boolean>;
}

const RESOURCE = "machines";

/** Registry CRUD backed by the hosted `/v1/machines` API. */
class CloudMachineRegistryStore implements MachineRegistryStore {
  readonly backend = "cloud-http" as const;
  constructor(
    private readonly client: HasnaStorageClient,
    readonly baseUrl: string,
  ) {}

  async list(options: ListMachinesOptions = {}): Promise<MachineRecord[]> {
    const query: Record<string, string | number> = {};
    if (options.status) query.status = options.status;
    if (options.limit != null) query.limit = options.limit;
    if (options.offset != null) query.offset = options.offset;
    const result = await this.client.list<MachineRecord>(RESOURCE, { query });
    if (result.raw && typeof result.raw === "object" && Array.isArray((result.raw as { machines?: unknown }).machines)) {
      return (result.raw as { machines: MachineRecord[] }).machines;
    }
    return result.items;
  }

  async get(id: string): Promise<MachineRecord | null> {
    return (await this.client.get<MachineRecord>(RESOURCE, id)) ?? null;
  }

  async upsert(input: UpsertMachineInput): Promise<MachineRecord> {
    // The serve app's POST /v1/machines is an upsert keyed by id.
    return this.client.create<MachineRecord>(RESOURCE, input, { idempotencyKey: `machine:${input.id}` });
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.client.delete(RESOURCE, id);
    return true;
  }
}

interface RegistryRow {
  id: string;
  friendly_name: string | null;
  platform: string | null;
  arch: string | null;
  status: string;
  labels_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToMachine(row: RegistryRow): MachineRecord {
  return {
    id: row.id,
    friendlyName: row.friendly_name,
    platform: row.platform,
    arch: row.arch,
    status: row.status,
    labels: parseObject(row.labels_json),
    metadata: parseObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Registry CRUD backed by the local SQLite `machine_registry` table. */
class LocalMachineRegistryStore implements MachineRegistryStore {
  readonly backend = "local" as const;
  readonly baseUrl = null;

  async list(options: ListMachinesOptions = {}): Promise<MachineRecord[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = options.limit ?? 200;
    const offset = options.offset ?? 0;
    const rows = db
      .query(`SELECT * FROM machine_registry ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as RegistryRow[];
    return rows.map(rowToMachine);
  }

  async get(id: string): Promise<MachineRecord | null> {
    const db = getDb();
    const row = db.query("SELECT * FROM machine_registry WHERE id = ?").get(id) as RegistryRow | null;
    return row ? rowToMachine(row) : null;
  }

  async upsert(input: UpsertMachineInput): Promise<MachineRecord> {
    if (!input.id || !input.id.trim()) throw new Error("machine id is required");
    const db = getDb();
    const now = new Date().toISOString();
    db.query(
      `INSERT INTO machine_registry (id, friendly_name, platform, arch, status, labels_json, metadata_json, created_at, updated_at)
       VALUES ($id, $friendlyName, $platform, $arch, $status, $labels, $metadata, $now, $now)
       ON CONFLICT(id) DO UPDATE SET
         friendly_name = excluded.friendly_name,
         platform = excluded.platform,
         arch = excluded.arch,
         status = excluded.status,
         labels_json = excluded.labels_json,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).run({
      $id: input.id,
      $friendlyName: input.friendlyName ?? null,
      $platform: input.platform ?? null,
      $arch: input.arch ?? null,
      $status: input.status ?? "unknown",
      $labels: JSON.stringify(input.labels ?? {}),
      $metadata: JSON.stringify(input.metadata ?? {}),
      $now: now,
    });
    const record = await this.get(input.id);
    if (!record) throw new Error(`machine not found after upsert: ${input.id}`);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    const db = getDb();
    const res = db.query("DELETE FROM machine_registry WHERE id = ?").run(id);
    return res.changes > 0;
  }
}

/**
 * Resolve the machine registry store for the current environment: the hosted
 * `/v1/machines` API when flipped to the hosted API (HASNA_MACHINES_API_URL +
 * HASNA_MACHINES_API_KEY set), else the local SQLite table.
 */
export function resolveMachineRegistryStore(env: NodeJS.ProcessEnv = process.env): MachineRegistryStore {
  const resolution = resolveCloudStorage("machines", env as Record<string, string | undefined>);
  if (resolution.transport === "cloud-http") {
    return new CloudMachineRegistryStore(resolution.client, resolution.baseUrl);
  }
  return new LocalMachineRegistryStore();
}

export { CloudMachineRegistryStore, LocalMachineRegistryStore };
