// Machine registry data-access layer for the machines control-plane service.
//
// The registry is the canonical fleet inventory: the set of machines the
// control plane knows about, plus their reported heartbeats. This module is the
// real CRUD surface the /v1 API and SDK wrap — no stubs. Every call hits RDS
// directly through the vendored storage kit's typed client (Amendment A1).

import type { TypedQueryClient } from "../generated/storage-kit/query.js";

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

export interface HeartbeatRecord {
  machineId: string;
  pid: number;
  status: string;
  updatedAt: string;
  daemonVersion: string | null;
  agentMode: string | null;
  platform: string | null;
  arch: string | null;
  uptimeSeconds: number | null;
  observedAt: string | null;
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

export interface UpdateMachineInput {
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

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function rowToMachine(row: Row): MachineRecord {
  return {
    id: String(row.id),
    friendlyName: row.friendly_name === null || row.friendly_name === undefined ? null : String(row.friendly_name),
    platform: row.platform === null || row.platform === undefined ? null : String(row.platform),
    arch: row.arch === null || row.arch === undefined ? null : String(row.arch),
    status: String(row.status),
    labels: toJsonObject(row.labels),
    metadata: toJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToHeartbeat(row: Row): HeartbeatRecord {
  return {
    machineId: String(row.machine_id),
    pid: Number(row.pid),
    status: String(row.status),
    updatedAt: toIso(row.updated_at),
    daemonVersion: row.daemon_version === null || row.daemon_version === undefined ? null : String(row.daemon_version),
    agentMode: row.agent_mode === null || row.agent_mode === undefined ? null : String(row.agent_mode),
    platform: row.platform === null || row.platform === undefined ? null : String(row.platform),
    arch: row.arch === null || row.arch === undefined ? null : String(row.arch),
    uptimeSeconds: row.uptime_seconds === null || row.uptime_seconds === undefined ? null : Number(row.uptime_seconds),
    observedAt: toIsoOrNull(row.observed_at),
  };
}

/** Thrown for caller-facing validation errors (mapped to HTTP 400). */
export class RegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryValidationError";
  }
}

function requireId(id: unknown): string {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new RegistryValidationError("machine id is required and must be a non-empty string");
  }
  if (id.length > 256) {
    throw new RegistryValidationError("machine id must be at most 256 characters");
  }
  return id.trim();
}

export class MachineRegistry {
  constructor(private readonly client: TypedQueryClient) {}

  async list(options: ListMachinesOptions = {}): Promise<MachineRecord[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (options.status) {
      params.push(options.status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const offset = Math.max(options.offset ?? 0, 0);
    params.push(limit);
    const limitClause = `LIMIT $${params.length}`;
    params.push(offset);
    const offsetClause = `OFFSET $${params.length}`;
    const rows = await this.client.many<Row>(
      `SELECT * FROM machines ${where} ORDER BY updated_at DESC ${limitClause} ${offsetClause}`,
      params,
    );
    return rows.map(rowToMachine);
  }

  async get(id: string): Promise<MachineRecord | null> {
    const cleanId = requireId(id);
    const row = await this.client.get<Row>(`SELECT * FROM machines WHERE id = $1`, [cleanId]);
    return row ? rowToMachine(row) : null;
  }

  /** Register (insert-or-update) a machine. Returns the persisted record. */
  async upsert(input: UpsertMachineInput): Promise<MachineRecord> {
    const id = requireId(input.id);
    const row = await this.client.one<Row>(
      `INSERT INTO machines (id, friendly_name, platform, arch, status, labels, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         friendly_name = EXCLUDED.friendly_name,
         platform      = EXCLUDED.platform,
         arch          = EXCLUDED.arch,
         status        = EXCLUDED.status,
         labels        = EXCLUDED.labels,
         metadata      = EXCLUDED.metadata,
         updated_at    = now()
       RETURNING *`,
      [
        id,
        input.friendlyName ?? null,
        input.platform ?? null,
        input.arch ?? null,
        input.status ?? "unknown",
        JSON.stringify(input.labels ?? {}),
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return rowToMachine(row);
  }

  /** Partial update. Returns null when the machine does not exist. */
  async update(id: string, patch: UpdateMachineInput): Promise<MachineRecord | null> {
    const cleanId = requireId(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.friendlyName !== undefined) push("friendly_name", patch.friendlyName);
    if (patch.platform !== undefined) push("platform", patch.platform);
    if (patch.arch !== undefined) push("arch", patch.arch);
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.labels !== undefined) push("labels", JSON.stringify(patch.labels), "::jsonb");
    if (patch.metadata !== undefined) push("metadata", JSON.stringify(patch.metadata), "::jsonb");
    if (sets.length === 0) {
      // No-op patch: return the current record unchanged rather than a fake write.
      return this.get(cleanId);
    }
    sets.push(`updated_at = now()`);
    params.push(cleanId);
    const row = await this.client.get<Row>(
      `UPDATE machines SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return row ? rowToMachine(row) : null;
  }

  /** Deregister a machine. Returns true when a row was removed. */
  async remove(id: string): Promise<boolean> {
    const cleanId = requireId(id);
    const result = await this.client.query(`DELETE FROM machines WHERE id = $1`, [cleanId]);
    return result.rowCount > 0;
  }

  async count(status?: string): Promise<number> {
    const row = status
      ? await this.client.get<Row>(`SELECT count(*)::int AS c FROM machines WHERE status = $1`, [status])
      : await this.client.get<Row>(`SELECT count(*)::int AS c FROM machines`);
    return row ? Number(row.c) : 0;
  }

  async listHeartbeats(machineId?: string, limit = 200): Promise<HeartbeatRecord[]> {
    const clamped = Math.min(Math.max(limit, 1), 1000);
    const rows = machineId
      ? await this.client.many<Row>(
          `SELECT * FROM agent_heartbeats WHERE machine_id = $1 ORDER BY updated_at DESC LIMIT $2`,
          [requireId(machineId), clamped],
        )
      : await this.client.many<Row>(
          `SELECT * FROM agent_heartbeats ORDER BY updated_at DESC LIMIT $1`,
          [clamped],
        );
    return rows.map(rowToHeartbeat);
  }
}
