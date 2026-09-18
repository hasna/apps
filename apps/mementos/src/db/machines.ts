import { createHash } from "node:crypto";
import { hostname, platform } from "node:os";
import { getDatabase, now, uuid } from "./database.js";
import { getApiConfig, isApiMode, apiJson } from "./api-mode.js";
import {
  MementosApiProtocolError,
  expectArray,
  expectBoolean,
  expectNonNegativeInteger,
  expectObject,
  expectString,
  type JsonObject,
} from "./api-response-contract.js";

export const MACHINE_REGISTRATION_CONTRACT = "mementos.machine-registration.v1" as const;
export const MACHINE_LIST_CONTRACT = "mementos.machines.v1" as const;
export const MACHINE_MUTATION_CONTRACT = "mementos.machine-mutation.v1" as const;
export const MACHINE_TOUCH_CONTRACT = "mementos.machine-touch.v1" as const;

type MachineDatabase = ReturnType<typeof getDatabase>;

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  is_primary: boolean;
  created_at: string;
  last_seen_at: string;
}

interface RawMachineRow {
  id?: unknown;
  name?: unknown;
  hostname?: unknown;
  platform?: unknown;
  is_primary?: unknown;
  created_at?: unknown;
  last_seen_at?: unknown;
  registration_created?: unknown;
}

export interface RegisterMachineInput {
  name?: string;
  hostname: string;
  platform: string;
}

export interface MachineRegistrationResult {
  machine: Machine;
  created: boolean;
}

export class MachineRegistryError extends Error {
  constructor(
    public readonly code:
      | "MACHINE_INVALID_INPUT"
      | "MACHINE_NOT_FOUND"
      | "MACHINE_NAME_CONFLICT"
      | "MACHINE_PRIMARY_DELETE_REFUSED"
      | "MACHINE_REGISTRATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MachineRegistryError";
  }
}

const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function canonicalTimestamp(value: unknown, operation: string, field: string): string {
  const stringValue = value instanceof Date ? value.toISOString() : value;
  if (typeof stringValue !== "string" || !ISO_UTC_TIMESTAMP.test(stringValue)) {
    throw new MementosApiProtocolError(operation, `expected '${field}' to be a canonical UTC ISO-8601 timestamp`);
  }
  const parsed = new Date(stringValue);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== stringValue) {
    throw new MementosApiProtocolError(operation, `expected '${field}' to be a real calendar timestamp`);
  }
  return stringValue;
}

function machineFromDb(row: RawMachineRow | null, operation = "machine database row"): Machine | null {
  if (!row) return null;
  if (
    typeof row.id !== "string" || !row.id ||
    typeof row.name !== "string" || !row.name || row.name.length > 128 || /[\u0000-\u001f\u007f]/.test(row.name) ||
    typeof row.hostname !== "string" || !row.hostname ||
    typeof row.platform !== "string" || !row.platform
  ) {
    throw new Error(`${operation} is missing or violates required machine identity fields`);
  }
  const canonicalHostname = normalizeMachineHostname(row.hostname);
  const canonicalPlatform = normalizeMachinePlatform(row.platform);
  if (canonicalHostname !== row.hostname || canonicalPlatform !== row.platform) {
    throw new Error(`${operation} contains noncanonical hostname or platform data`);
  }
  if (!["boolean", "number"].includes(typeof row.is_primary)) {
    throw new Error(`${operation} has an invalid is_primary value`);
  }
  const createdValue = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at ?? ""));
  const lastSeenValue = row.last_seen_at instanceof Date ? row.last_seen_at : new Date(String(row.last_seen_at ?? ""));
  if (!Number.isFinite(createdValue.getTime()) || !Number.isFinite(lastSeenValue.getTime())) {
    throw new Error(`${operation} has an invalid timestamp`);
  }
  const createdAt = createdValue.toISOString();
  const lastSeenAt = lastSeenValue.toISOString();
  if (lastSeenAt < createdAt) throw new Error(`${operation} has last_seen_at before created_at`);
  return {
    id: row.id,
    name: row.name,
    hostname: canonicalHostname,
    platform: canonicalPlatform,
    is_primary: Boolean(row.is_primary),
    created_at: createdAt,
    last_seen_at: lastSeenAt,
  };
}

function decodeMachine(value: unknown, operation: string): Machine {
  const object = expectObject(value, operation);
  const name = expectString(object, "name", operation);
  if (name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new MementosApiProtocolError(operation, "machine.name is outside the public contract");
  }
  const rawHost = expectString(object, "hostname", operation);
  const rawPlatform = expectString(object, "platform", operation);
  let machineHostname: string;
  let machinePlatform: string;
  try {
    machineHostname = normalizeMachineHostname(rawHost);
    machinePlatform = normalizeMachinePlatform(rawPlatform);
  } catch {
    throw new MementosApiProtocolError(operation, "machine hostname or platform is not canonical");
  }
  if (machineHostname !== rawHost || machinePlatform !== rawPlatform) {
    throw new MementosApiProtocolError(operation, "machine hostname or platform is not canonical");
  }
  const createdAt = canonicalTimestamp(object["created_at"], operation, "created_at");
  const lastSeenAt = canonicalTimestamp(object["last_seen_at"], operation, "last_seen_at");
  if (lastSeenAt < createdAt) {
    throw new MementosApiProtocolError(operation, "last_seen_at precedes created_at");
  }
  return {
    id: expectString(object, "id", operation),
    name,
    hostname: machineHostname,
    platform: machinePlatform,
    is_primary: expectBoolean(object, "is_primary", operation),
    created_at: createdAt,
    last_seen_at: lastSeenAt,
  };
}

function expectContract(object: JsonObject, contract: string, operation: string): void {
  if (object["contract"] !== contract) {
    throw new MementosApiProtocolError(operation, `expected contract '${contract}'`);
  }
}

function decodeRegistration(value: unknown, expected: RegisterMachineInput): MachineRegistrationResult {
  const operation = "POST /v1/machines";
  const object = expectObject(value, operation);
  expectContract(object, MACHINE_REGISTRATION_CONTRACT, operation);
  const machine = decodeMachine(object["machine"], operation);
  const created = expectBoolean(object, "created", operation);
  const identity = expectObject(object["identity"], operation);
  if (identity["idempotency_key"] !== "normalized_hostname") {
    throw new MementosApiProtocolError(operation, "expected normalized-hostname identity semantics");
  }
  if (expectString(identity, "stable_id", operation) !== machine.id) {
    throw new MementosApiProtocolError(operation, "identity stable_id does not match machine.id");
  }
  const expectedHostname = normalizeMachineHostname(expected.hostname);
  const expectedPlatform = normalizeMachinePlatform(expected.platform);
  if (machine.hostname !== expectedHostname || machine.platform !== expectedPlatform) {
    throw new MementosApiProtocolError(operation, "registration receipt does not match the requested hostname/platform");
  }
  if (created && machine.name !== normalizeMachineName(expected.name, expectedHostname)) {
    throw new MementosApiProtocolError(operation, "created registration receipt does not match the requested name");
  }
  return { machine, created };
}

function decodeMachineList(value: unknown): Machine[] {
  const operation = "GET /v1/machines";
  const object = expectObject(value, operation);
  expectContract(object, MACHINE_LIST_CONTRACT, operation);
  const values = expectArray(object["machines"], operation, "machines");
  const count = expectNonNegativeInteger(object, "count", operation);
  if (count !== values.length) {
    throw new MementosApiProtocolError(operation, "count does not match machines.length");
  }
  if (object["complete"] !== true) {
    throw new MementosApiProtocolError(operation, "expected complete=true");
  }
  const machines = values.map((entry, index) => decodeMachine(entry, `${operation} machines[${index}]`));
  const ids = new Set<string>();
  const hosts = new Set<string>();
  const names = new Set<string>();
  let primaryCount = 0;
  for (const machine of machines) {
    if (ids.has(machine.id)) throw new MementosApiProtocolError(operation, `duplicate machine id '${machine.id}'`);
    if (hosts.has(machine.hostname)) throw new MementosApiProtocolError(operation, `duplicate machine hostname '${machine.hostname}'`);
    if (names.has(machine.name)) throw new MementosApiProtocolError(operation, `duplicate machine name '${machine.name}'`);
    ids.add(machine.id);
    hosts.add(machine.hostname);
    names.add(machine.name);
    if (machine.is_primary) primaryCount += 1;
  }
  if (primaryCount > 1) throw new MementosApiProtocolError(operation, "more than one machine is primary");
  return machines;
}

function decodeMachineMutation(value: unknown, operation: string, expectedId: string): Machine {
  const object = expectObject(value, operation);
  expectContract(object, MACHINE_MUTATION_CONTRACT, operation);
  const machine = decodeMachine(object["machine"], operation);
  if (machine.id !== expectedId) {
    throw new MementosApiProtocolError(operation, "returned machine id does not match the requested stable id");
  }
  return machine;
}

/**
 * Hostname is the account-local registration idempotency key, not an
 * authorization boundary. The server-assigned machine `id` is the stable
 * identity used by mutations and memory attribution. Renaming changes only the
 * human display name; re-registering the same normalized hostname never takes
 * over or renames an existing row.
 */
export function normalizeMachineHostname(host: string): string {
  const normalized = host.trim().replace(/\.+$/, "").toLowerCase();
  if (!normalized || normalized.length > 253 || /[\u0000-\u001f\u007f/\\\s]/.test(normalized)) {
    throw new MachineRegistryError("MACHINE_INVALID_INPUT", "Machine hostname must be a non-empty hostname of at most 253 characters");
  }
  return normalized;
}

function normalizeMachinePlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 64 || !/^[a-z0-9._-]+$/.test(normalized)) {
    throw new MachineRegistryError("MACHINE_INVALID_INPUT", "Machine platform must contain 1-64 lowercase letters, digits, dots, underscores, or hyphens");
  }
  return normalized;
}

function normalizeMachineName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new MachineRegistryError("MACHINE_INVALID_INPUT", "Machine name must contain 1-128 printable characters");
  }
  return normalized;
}

export function getMachineById(id: string, db: MachineDatabase): Machine | null {
  return machineFromDb(db.query("SELECT * FROM machines WHERE id = ?").get(id) as RawMachineRow | null);
}

/**
 * Atomically register a machine using the database-enforced unique hostname
 * invariant. The insert happens before any lookup; concurrent callers either
 * create one row or observe/update that same row after `ON CONFLICT` resolves.
 */
export function registerMachineRecord(input: RegisterMachineInput, db?: MachineDatabase): MachineRegistrationResult {
  const d = db ?? getDatabase();
  const host = normalizeMachineHostname(input.hostname);
  const machineName = normalizeMachineName(input.name, host);
  const machinePlatform = normalizeMachinePlatform(input.platform);
  const proposedId = uuid();
  const seenAt = now();

  try {
    const row = d.query(
      `INSERT INTO machines (id, name, hostname, platform, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(hostname) DO UPDATE SET
         platform = excluded.platform,
         last_seen_at = CASE
           WHEN machines.last_seen_at > excluded.last_seen_at THEN machines.last_seen_at
           ELSE excluded.last_seen_at
         END
       RETURNING *, id = ? AS registration_created`,
    ).get(proposedId, machineName, host, machinePlatform, seenAt, seenAt, proposedId) as RawMachineRow | null;
    const machine = machineFromDb(row, "machine registration upsert");
    if (!machine || typeof row?.registration_created !== "boolean" && typeof row?.registration_created !== "number") {
      throw new MachineRegistryError("MACHINE_REGISTRATION_CONFLICT", "Machine registration returned no stable identity receipt");
    }
    return { machine, created: Boolean(row.registration_created) };
  } catch (error) {
    if (error instanceof MachineRegistryError) throw error;
    const details = error && typeof error === "object" ? error as { message?: unknown; constraint?: unknown } : {};
    const diagnostic = `${String(details.constraint ?? "")} ${String(details.message ?? "")}`;
    if (/machines(?:_|\.)name|machines_name_key/i.test(diagnostic)) {
      throw new MachineRegistryError("MACHINE_NAME_CONFLICT", `Machine name already taken: ${machineName}`);
    }
    throw error;
  }
}

export function registerMachine(name?: string, db?: MachineDatabase): Machine {
  const host = normalizeMachineHostname(hostname());
  const plat = normalizeMachinePlatform(platform());
  if (!db && isApiMode()) {
    const input: RegisterMachineInput = { name: name?.trim() || undefined, hostname: host, platform: plat };
    const { data } = apiJson<unknown>("POST", "/machines", input);
    return decodeRegistration(data, input).machine;
  }
  return registerMachineRecord({ name, hostname: host, platform: plat }, db).machine;
}

export function listMachines(db?: MachineDatabase): Machine[] {
  if (!db && isApiMode()) {
    const { data } = apiJson<unknown>("GET", "/machines");
    return decodeMachineList(data);
  }
  const d = db ?? getDatabase();
  const rows = d.query("SELECT * FROM machines ORDER BY is_primary DESC, last_seen_at DESC, created_at ASC, id ASC").all() as RawMachineRow[];
  return rows.map((row) => machineFromDb(row) as Machine);
}

/** Read by stable id or display name for backward-compatible discovery only. */
export function getMachine(idOrName: string, db?: MachineDatabase): Machine | null {
  if (!db && isApiMode()) {
    const { status, data } = apiJson<unknown>("GET", `/machines/${encodeURIComponent(idOrName)}`, undefined, { allow404: true });
    if (status === 404) return null;
    return decodeMachineMutation(data, "GET /v1/machines/:id", idOrName);
  }
  const d = db ?? getDatabase();
  return machineFromDb(d.query("SELECT * FROM machines WHERE id = ? OR name = ?").get(idOrName, idOrName) as RawMachineRow | null);
}

export function renameMachine(id: string, newName: string, db?: MachineDatabase): Machine {
  const normalizedName = normalizeMachineName(newName, "");
  if (!db && isApiMode()) {
    const { data } = apiJson<unknown>("PATCH", `/machines/${encodeURIComponent(id)}`, { name: normalizedName });
    const machine = decodeMachineMutation(data, "PATCH /v1/machines/:id", id);
    if (machine.name !== normalizedName) {
      throw new MementosApiProtocolError("PATCH /v1/machines/:id", "returned name does not match the requested rename");
    }
    return machine;
  }
  const d = db ?? getDatabase();
  if (!getMachineById(id, d)) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
  try {
    const updated = machineFromDb(
      d.query("UPDATE machines SET name = ? WHERE id = ? RETURNING *").get(normalizedName, id) as RawMachineRow | null,
    );
    if (!updated) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
    return updated;
  } catch (error) {
    if (error instanceof MachineRegistryError) throw error;
    const clash = d.query("SELECT id FROM machines WHERE name = ? AND id != ?").get(normalizedName, id);
    if (clash) throw new MachineRegistryError("MACHINE_NAME_CONFLICT", `Machine name already taken: ${normalizedName}`);
    throw error;
  }
}

export function getPrimaryMachine(db?: MachineDatabase): Machine | null {
  if (!db && isApiMode()) return listMachines().find((machine) => machine.is_primary) ?? null;
  const d = db ?? getDatabase();
  return machineFromDb(d.query("SELECT * FROM machines WHERE is_primary = 1 LIMIT 1").get() as RawMachineRow | null);
}

export function getPrimaryMachineCandidate(db?: MachineDatabase): Machine | null {
  if (!db && isApiMode()) {
    const machines = listMachines();
    if (machines.some((machine) => machine.is_primary)) return null;
    return [...machines].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0] ?? null;
  }
  const d = db ?? getDatabase();
  if (getPrimaryMachine(d)) return null;
  return machineFromDb(d.query("SELECT * FROM machines ORDER BY created_at ASC, id ASC LIMIT 1").get() as RawMachineRow | null);
}

export function setPrimaryMachine(id: string, db?: MachineDatabase): Machine {
  if (!db && isApiMode()) {
    const { data } = apiJson<unknown>("POST", `/machines/${encodeURIComponent(id)}/primary`);
    const machine = decodeMachineMutation(data, "POST /v1/machines/:id/primary", id);
    if (!machine.is_primary) {
      throw new MementosApiProtocolError("POST /v1/machines/:id/primary", "returned machine is not primary");
    }
    return machine;
  }
  const d = db ?? getDatabase();
  return d.transaction(() => {
    if (!getMachineById(id, d)) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
    d.run("UPDATE machines SET is_primary = 0 WHERE is_primary = 1 AND id != ?", id);
    const updated = machineFromDb(
      d.query("UPDATE machines SET is_primary = 1 WHERE id = ? RETURNING *").get(id) as RawMachineRow | null,
    );
    if (!updated) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
    return updated;
  });
}

export function deleteMachine(id: string, db?: MachineDatabase): void {
  if (!db && isApiMode()) {
    const operation = "DELETE /v1/machines/:id";
    const { data } = apiJson<unknown>("DELETE", `/machines/${encodeURIComponent(id)}`);
    const object = expectObject(data, operation);
    expectContract(object, MACHINE_MUTATION_CONTRACT, operation);
    if (expectString(object, "id", operation) !== id || object["deleted"] !== true) {
      throw new MementosApiProtocolError(operation, "expected deleted=true for the requested stable id");
    }
    if (hostedMachineCache?.id === id) hostedMachineCache = null;
    return;
  }
  const d = db ?? getDatabase();
  const machine = getMachineById(id, d);
  if (!machine) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
  if (machine.is_primary) throw new MachineRegistryError("MACHINE_PRIMARY_DELETE_REFUSED", `Primary machine cannot be deleted: ${machine.name}`);
  d.run("DELETE FROM machines WHERE id = ?", id);
}

export function getFallbackSyncTargetMachine(db?: MachineDatabase): Machine | null {
  return getPrimaryMachine(db);
}

export function getPrimaryMachineStartupWarning(db?: MachineDatabase): string | null {
  if (getPrimaryMachine(db)) return null;
  const candidate = getPrimaryMachineCandidate(db);
  if (!candidate) return "No primary machine configured. Fallback sync target is unset because no machines are registered yet.";
  return `No primary machine configured. Fallback sync target is unset. Candidate: ${candidate.name} (${candidate.id.slice(0, 8)} / ${candidate.hostname}). Confirm it with set_primary_machine.`;
}

export function touchMachine(id: string, db?: MachineDatabase): Machine {
  if (!db && isApiMode()) {
    const operation = "POST /v1/machines/:id/touch";
    const { data } = apiJson<unknown>("POST", `/machines/${encodeURIComponent(id)}/touch`);
    const object = expectObject(data, operation);
    expectContract(object, MACHINE_TOUCH_CONTRACT, operation);
    if (object["touched"] !== true || expectString(object, "id", operation) !== id) {
      throw new MementosApiProtocolError(operation, "expected touched=true for the requested stable id");
    }
    const machine = decodeMachine(object["machine"], operation);
    const touchedAt = canonicalTimestamp(object["touched_at"], operation, "touched_at");
    if (machine.id !== id || machine.last_seen_at !== touchedAt) {
      throw new MementosApiProtocolError(operation, "touch receipt does not match the returned machine");
    }
    return machine;
  }
  const d = db ?? getDatabase();
  const touchedAt = now();
  const machine = machineFromDb(
    d.query("UPDATE machines SET last_seen_at = ? WHERE id = ? RETURNING *").get(touchedAt, id) as RawMachineRow | null,
  );
  if (!machine || machine.id !== id) throw new MachineRegistryError("MACHINE_NOT_FOUND", `Machine not found: ${id}`);
  return machine;
}

let hostedMachineCache: { key: string; id: string } | null = null;

export function resetCurrentMachineIdCache(): void {
  hostedMachineCache = null;
}

/** Get or auto-register the current machine and return its stable server id. */
export function getCurrentMachineId(db?: MachineDatabase): string {
  if (!db && isApiMode()) {
    const host = normalizeMachineHostname(hostname());
    const plat = normalizeMachinePlatform(platform());
    const configBefore = getApiConfig();
    if (!configBefore) throw new Error("mementos hosted machine identity requires a resolved API authority");
    const credentialFingerprint = createHash("sha256").update(configBefore.apiKey).digest("hex");
    const key = `${configBefore.baseUrl}\u0000${credentialFingerprint}\u0000${host}\u0000${plat}`;
    if (hostedMachineCache?.key === key) return hostedMachineCache.id;
    const id = registerMachine().id;
    const configAfter = getApiConfig();
    const fingerprintAfter = configAfter
      ? createHash("sha256").update(configAfter.apiKey).digest("hex")
      : null;
    if (!configAfter || configAfter.baseUrl !== configBefore.baseUrl || fingerprintAfter !== credentialFingerprint) {
      throw new Error("MEMENTOS_AUTHORITY_CHANGED: the machine registry authority or credential changed while resolving the stable machine identity");
    }
    hostedMachineCache = { key, id };
    return id;
  }
  const d = db ?? getDatabase();
  return registerMachine(undefined, d).id;
}
