import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Machine } from "../types/index.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

export const MACHINE_REGISTRY_VERSION = 2;
export type MachineAction = "register" | "heartbeat" | "set-primary" | "archive" | "unarchive" | "delete" | "import";
export interface MachineRegistryInput { action: MachineAction; name?: string; id?: string; options?: Record<string, unknown>; machines?: Machine[] }
export interface MachineRegistryReceipt { schema_version: 2; machines: Machine[]; machine?: Machine; inserted: number; skipped: number; deleted?: boolean }
export interface MachineRegistryStore { list(): Promise<Machine[]>; execute(input: MachineRegistryInput): Promise<MachineRegistryReceipt> }
export class MachineRegistryError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const fields = new Set(["id", "name", "hostname", "platform", "last_seen_at", "metadata", "created_at", "ssh_address", "is_primary", "archived_at"]);
export function validateMachines(value: unknown): Machine[] {
  if (!Array.isArray(value) || value.length > 10000) throw new MachineRegistryError("machines must be an array of at most 10000 complete records", 400);
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !fields.has(key))) throw new MachineRegistryError("Invalid machine record fields", 400);
    for (const key of ["id", "name", "last_seen_at", "created_at"]) if (typeof row[key] !== "string" || !row[key].trim() || row[key].length > 1024) throw new MachineRegistryError(`Invalid machine ${key}`, 400);
    for (const key of ["hostname", "platform", "ssh_address", "archived_at"]) if (row[key] !== null && typeof row[key] !== "string") throw new MachineRegistryError(`Invalid machine ${key}`, 400);
    for (const key of ["last_seen_at", "created_at", "archived_at"]) if (row[key] !== null && !Number.isFinite(Date.parse(row[key]))) throw new MachineRegistryError(`Invalid machine ${key}`, 400);
    if (typeof row.is_primary !== "boolean" || !row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) throw new MachineRegistryError("Invalid machine flags or metadata", 400);
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(row.metadata)), row.metadata)) throw new MachineRegistryError("Machine metadata must preserve JSON values exactly", 400);
    if (JSON.stringify(row.metadata).length > 262144) throw new MachineRegistryError("Machine metadata is too large", 400);
    if (row.is_primary && row.archived_at !== null) throw new MachineRegistryError("An archived machine cannot be primary", 400);
  }
  return value;
}
/** Strict migration: preserve every field, never merge machines by name or rewrite identity. */
export function planMachineImport(existing: Machine[], incoming: unknown): { rows: Machine[]; skipped: number } {
  const rows = validateMachines(incoming);
  const byId = new Map(existing.map(row => [row.id, row]));
  const byName = new Map(existing.map(row => [row.name, row.id]));
  const insert: Machine[] = [];
  let skipped = 0;
  for (const row of rows) {
    const prior = byId.get(row.id);
    if (prior && !isDeepStrictEqual(prior, row)) throw new MachineRegistryError("Machine migration conflicts with an existing identity; reconcile before retrying");
    if (byName.has(row.name) && byName.get(row.name) !== row.id) throw new MachineRegistryError("Machine name belongs to a different identity; migration was not applied");
    if (prior) skipped++;
    else { insert.push(row); byId.set(row.id, row); byName.set(row.name, row.id); }
  }
  if ([...byId.values()].filter(row => row.is_primary).length > 1) throw new MachineRegistryError("Machine migration would create multiple primary machines");
  return { rows: insert, skipped };
}

/** Same-connection transaction and a service-scoped lock serialize registry changes/imports. */
export function createPostgresMachineRegistry(client: TodosPostgresQueryClient, service: string, table: string, ensure: () => Promise<void>): MachineRegistryStore {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error("Invalid machine registry table");
  async function list(connection = client): Promise<Machine[]> {
    await ensure();
    const result = await connection.query<{ payload: Machine }>(`SELECT payload FROM ${table} WHERE service=$1 AND object_type='machines' AND deleted_at IS NULL ORDER BY object_id`, [service]);
    return validateMachines(result.rows.map(row => typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload));
  }
  return { list, async execute(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !["register", "heartbeat", "set-primary", "archive", "unarchive", "delete", "import"].includes(input.action)) throw new MachineRegistryError("Invalid machine operation", 400);
    if (Object.keys(input).some(key => !["action", "name", "id", "options", "machines"].includes(key))) throw new MachineRegistryError("Unknown machine operation fields", 400);
    if (input.options !== undefined && (!input.options || typeof input.options !== "object" || Array.isArray(input.options))) throw new MachineRegistryError("Invalid machine options", 400);
    await ensure();
    if (!client.transaction) throw new MachineRegistryError("Machine registry requires a transactional server backend", 501);
    return client.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${service}:machine-registry`]);
      const current = await list(tx);
      let changed: Machine[] = [];
      let skipped = 0;
      let machine: Machine | undefined;
      let deleted: boolean | undefined;
      const stamp = new Date().toISOString();
      if (input.action === "import") {
        const plan = planMachineImport(current, input.machines);
        // Deleted identities cannot be silently resurrected by a stale migration.
        const ids = plan.rows.map(row => row.id);
        if (ids.length) {
          const retired = await tx.query(`SELECT object_id FROM ${table} WHERE service=$1 AND object_type='machines' AND object_id IN (SELECT jsonb_array_elements_text($2::text::jsonb)) AND deleted_at IS NOT NULL`, [service, JSON.stringify(ids)]);
          if (retired.rows.length) throw new MachineRegistryError("Machine migration contains a retired identity");
        }
        changed = plan.rows; skipped = plan.skipped;
      } else {
        if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 1024) throw new MachineRegistryError("Machine name or ID is required", 400);
        const matches = current.filter(row => row.name === input.name || row.id === input.name);
        if (matches.length > 1) throw new MachineRegistryError("Machine selector is ambiguous between a name and another identity; use an unambiguous selector");
        const prior = matches[0];
        if (input.action === "register" || input.action === "heartbeat") {
          const opts = input.options ?? {};
          const allowed = new Set(["hostname", "platform", "ssh_address", "primary", "tailscale_name", "tailscale_ip", "lan_address", "workspace_path", "git_root", "arch"]);
          for (const [key, value] of Object.entries(opts)) {
            if (!allowed.has(key) || (key === "primary" ? typeof value !== "boolean" : typeof value !== "string" || value.length > 4096)) throw new MachineRegistryError("Invalid machine registration options", 400);
          }
          if (input.id !== undefined && (typeof input.id !== "string" || !input.id.trim() || input.id.length > 1024)) throw new MachineRegistryError("Invalid stable machine ID", 400);
          if (prior && input.id && input.id !== prior.id) throw new MachineRegistryError("Machine registration ID does not match existing identity");
          if (!prior && input.id && current.some(row => row.id === input.id)) throw new MachineRegistryError("Machine ID already belongs to another name");
          const metadata = { ...prior?.metadata };
          for (const key of ["tailscale_name", "tailscale_ip", "lan_address", "workspace_path", "git_root", "arch"]) if (opts[key] !== undefined) metadata[key] = opts[key];
          if (!prior && input.id) {
            const retired = await tx.query(`SELECT object_id FROM ${table} WHERE service=$1 AND object_type='machines' AND object_id=$2 AND deleted_at IS NOT NULL`, [service, input.id]);
            if (retired.rows.length) throw new MachineRegistryError("Machine identity has been retired");
          }
          machine = { id: prior?.id ?? input.id ?? randomUUID(), name: prior?.name ?? input.name, hostname: (opts.hostname as string | undefined) ?? prior?.hostname ?? null, platform: (opts.platform as string | undefined) ?? prior?.platform ?? null, ssh_address: (opts.ssh_address as string | undefined) ?? prior?.ssh_address ?? null, created_at: prior?.created_at ?? stamp, last_seen_at: stamp, archived_at: prior?.archived_at ?? null, is_primary: opts.primary === true || (prior?.is_primary ?? false), metadata };
          if (machine.archived_at && machine.is_primary) throw new MachineRegistryError("Cannot set archived machine as primary");
          changed = [machine];
          if (opts.primary === true) changed.push(...current.filter(row => row.is_primary && row.id !== machine!.id).map(row => ({ ...row, is_primary: false })));
        } else {
          if (!prior) throw new MachineRegistryError("Machine not found", 404);
          machine = { ...prior };
          if (input.action === "set-primary") {
            if (prior.archived_at) throw new MachineRegistryError("Cannot set archived machine as primary");
            machine.is_primary = true;
            changed = current.filter(row => row.is_primary && row.id !== prior.id).map(row => ({ ...row, is_primary: false }));
          } else if (input.action === "archive" || input.action === "delete") {
            if (prior.is_primary) throw new MachineRegistryError("Cannot archive or delete the primary machine");
            const refs = await tx.query(`SELECT object_id FROM ${table} WHERE service=$1 AND object_type<>'machines' AND deleted_at IS NULL AND payload->>'machine_id'=$2 AND ($3='delete' OR (object_type='tasks' AND payload->>'status' IN ('pending','in_progress'))) LIMIT 1`, [service, prior.id, input.action]);
            if (refs.rows.length) throw new MachineRegistryError("Machine still has referenced records or active tasks");
            machine.archived_at = stamp;
            deleted = input.action === "delete" ? true : undefined;
          } else if (input.action === "unarchive") machine.archived_at = null;
          else throw new MachineRegistryError("Unknown machine action", 400);
          changed.push(machine);
        }
      }
      for (const row of changed) {
        await tx.query(`INSERT INTO ${table} (service,object_type,object_id,payload,updated_at,deleted_at,version) VALUES ($1,'machines',$2,$3::text::jsonb,$4,$5,1) ON CONFLICT (service,object_type,object_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at,version=COALESCE(${table}.version,0)+1`, [service, row.id, JSON.stringify(row), stamp, deleted && row.id === machine?.id ? stamp : null]);
      }
      const machines = await list(tx);
      return { schema_version: 2, machines, ...(machine ? { machine } : {}), inserted: changed.filter(row => !current.some(old => old.id === row.id)).length, skipped, ...(deleted ? { deleted } : {}) };
    });
  } };
}
