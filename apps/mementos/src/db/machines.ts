import { hostname, platform } from "os";
import { SqliteAdapter as Database } from "../storage.js";
import { getDatabase, now, uuid } from "./database.js";
import { isApiMode, apiJson } from "./api-mode.js";

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  is_primary: boolean;
  created_at: string;
  last_seen_at: string;
}

interface RawMachineRow extends Omit<Machine, "is_primary"> {
  is_primary?: number | boolean | null;
}

function parseMachine(row: RawMachineRow | null): Machine | null {
  if (!row) return null;
  return {
    ...row,
    is_primary: Boolean(row.is_primary),
  };
}

/** Normalize hostname by stripping common suffixes like .local */
function normalizeHostname(host: string): string {
  return host.replace(/\.(local|lan|home|internal)$/i, "");
}

/** The calling machine's own identity. Never observable on the server. */
export interface RegisterMachineInput {
  name?: string;
  hostname: string;
  platform: string;
}

/**
 * Write the machine row. Takes the identity EXPLICITLY because the server
 * executes this on behalf of a remote client: inside the container
 * `hostname()` is the task id, so a server-side `hostname()` would register
 * the wrong machine. The local arm of {@link registerMachine} passes its own.
 */
export function registerMachineRecord(input: RegisterMachineInput, db?: Database): Machine {
  const d = db || getDatabase();
  const host = normalizeHostname(input.hostname);
  const machineName = input.name?.trim() || host;

  // Idempotent by hostname: return existing if same hostname is already registered
  const existing = parseMachine(
    d.query("SELECT * FROM machines WHERE hostname = ?").get(host) as RawMachineRow | null
  );
  if (existing) {
    d.run("UPDATE machines SET last_seen_at = ? WHERE id = ?", [now(), existing.id]);
    return parseMachine(
      d.query("SELECT * FROM machines WHERE id = ?").get(existing.id) as RawMachineRow | null
    ) as Machine;
  }

  // Ensure name uniqueness by appending suffix if needed
  let finalName = machineName;
  let suffix = 2;
  while (d.query("SELECT id FROM machines WHERE name = ?").get(finalName)) {
    finalName = `${machineName}-${suffix++}`;
  }

  const id = uuid();
  d.run(
    "INSERT INTO machines (id, name, hostname, platform) VALUES (?, ?, ?, ?)",
    [id, finalName, host, input.platform]
  );
  return parseMachine(
    d.query("SELECT * FROM machines WHERE id = ?").get(id) as RawMachineRow | null
  ) as Machine;
}

export function registerMachine(name?: string, db?: Database): Machine {
  const host = normalizeHostname(hostname());
  const plat = platform();
  if (!db && isApiMode()) {
    // The request carries THIS machine's identity; the server is idempotent by
    // hostname exactly like the local arm.
    const { data } = apiJson<Machine>("POST", "/machines", {
      name: name?.trim() || undefined,
      hostname: host,
      platform: plat,
    });
    return data;
  }
  return registerMachineRecord({ name, hostname: host, platform: plat }, db);
}

export function listMachines(db?: Database): Machine[] {
  if (!db && isApiMode()) {
    const { data } = apiJson<{ machines: Machine[] }>("GET", "/machines");
    return data?.machines ?? [];
  }
  const d = db || getDatabase();
  const rows = d.query(
    "SELECT * FROM machines ORDER BY is_primary DESC, last_seen_at DESC, created_at ASC"
  ).all() as RawMachineRow[];
  return rows.map((row) => parseMachine(row) as Machine);
}

export function getMachine(id: string, db?: Database): Machine | null {
  if (!db && isApiMode()) {
    const { status, data } = apiJson<Machine>(
      "GET",
      `/machines/${encodeURIComponent(id)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404 || !data) return null;
    return data;
  }
  const d = db || getDatabase();
  return parseMachine(
    d.query("SELECT * FROM machines WHERE id = ? OR name = ?").get(id, id) as RawMachineRow | null
  );
}

export function renameMachine(id: string, newName: string, db?: Database): Machine {
  if (!db && isApiMode()) {
    const { data } = apiJson<Machine>("PATCH", `/machines/${encodeURIComponent(id)}`, {
      name: newName,
    });
    return data;
  }
  const d = db || getDatabase();
  const m = parseMachine(
    d.query("SELECT * FROM machines WHERE id = ?").get(id) as RawMachineRow | null
  );
  if (!m) throw new Error(`Machine not found: ${id}`);
  const clash = d.query("SELECT id FROM machines WHERE name = ? AND id != ?").get(newName, id);
  if (clash) throw new Error(`Machine name already taken: ${newName}`);
  d.run("UPDATE machines SET name = ?, last_seen_at = ? WHERE id = ?", [newName, now(), id]);
  return parseMachine(
    d.query("SELECT * FROM machines WHERE id = ?").get(id) as RawMachineRow | null
  ) as Machine;
}

export function getPrimaryMachine(db?: Database): Machine | null {
  if (!db && isApiMode()) {
    // GET /v1/machines orders primary first and carries is_primary, so the
    // list answers this without a second route.
    return listMachines().find((m) => m.is_primary) ?? null;
  }
  const d = db || getDatabase();
  return parseMachine(
    d.query("SELECT * FROM machines WHERE is_primary = 1 LIMIT 1").get() as RawMachineRow | null
  );
}

export function getPrimaryMachineCandidate(db?: Database): Machine | null {
  if (!db && isApiMode()) {
    const machines = listMachines();
    if (machines.some((m) => m.is_primary)) return null;
    // Same tie-break as the SQL below: oldest first, then id.
    return (
      [...machines].sort(
        (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      )[0] ?? null
    );
  }
  const d = db || getDatabase();
  if (getPrimaryMachine(d)) return null;
  return parseMachine(
    d.query("SELECT * FROM machines ORDER BY created_at ASC, id ASC LIMIT 1").get() as RawMachineRow | null
  );
}

export function setPrimaryMachine(id: string, db?: Database): Machine {
  if (!db && isApiMode()) {
    const { data } = apiJson<Machine>("POST", `/machines/${encodeURIComponent(id)}/primary`);
    return data;
  }
  const d = db || getDatabase();
  const machine = getMachine(id, d);
  if (!machine) throw new Error(`Machine not found: ${id}`);

  const updatedAt = now();
  d.run(
    "UPDATE machines SET is_primary = 0, last_seen_at = ? WHERE is_primary = 1 AND id != ?",
    [updatedAt, machine.id]
  );
  d.run(
    "UPDATE machines SET is_primary = 1, last_seen_at = ? WHERE id = ?",
    [updatedAt, machine.id]
  );

  return getMachine(machine.id, d) as Machine;
}

export function deleteMachine(id: string, db?: Database): void {
  if (!db && isApiMode()) {
    apiJson<{ deleted: boolean }>("DELETE", `/machines/${encodeURIComponent(id)}`);
    return;
  }
  const d = db || getDatabase();
  const machine = getMachine(id, d);
  if (!machine) throw new Error(`Machine not found: ${id}`);
  if (machine.is_primary) {
    throw new Error(`Primary machine cannot be deleted: ${machine.name}`);
  }
  d.run("DELETE FROM machines WHERE id = ?", [machine.id]);
}

export function getFallbackSyncTargetMachine(db?: Database): Machine | null {
  return getPrimaryMachine(db);
}

export function getPrimaryMachineStartupWarning(db?: Database): string | null {
  if (getPrimaryMachine(db)) return null;

  const candidate = getPrimaryMachineCandidate(db);
  if (!candidate) {
    return "No primary machine configured. Fallback sync target is unset because no machines are registered yet.";
  }

  return `No primary machine configured. Fallback sync target is unset. Candidate: ${candidate.name} (${candidate.id.slice(0, 8)} / ${candidate.hostname}). Confirm it with set_primary_machine.`;
}

export function touchMachine(id: string, db?: Database): void {
  if (!db && isApiMode()) {
    apiJson<{ touched: boolean }>("POST", `/machines/${encodeURIComponent(id)}/touch`);
    return;
  }
  const d = db || getDatabase();
  d.run("UPDATE machines SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

/**
 * The hosted machine id, resolved once per process.
 *
 * `getCurrentMachineId` is on hot paths — `memory_save`, `memory_inject`, the
 * machine-visibility filter behind every `projects` / `context` read — where
 * the local arm was a single indexed SELECT. Its hosted equivalent is a
 * request, and an unmemoized one would put a WRITE (the idempotent register)
 * in front of every read. The identity of the machine a process runs on cannot
 * change while that process lives, so resolve it once and reuse it.
 */
let _hostedMachineId: string | null = null;

/** Test seam: drop the per-process hosted machine id. */
export function resetCurrentMachineIdCache(): void {
  _hostedMachineId = null;
}

/** Get or auto-register the current machine and return its ID. */
export function getCurrentMachineId(db?: Database): string {
  if (!db && isApiMode()) {
    if (_hostedMachineId) return _hostedMachineId;
    // POST /v1/machines is idempotent by hostname and refreshes last_seen_at,
    // so one authoritative call replaces the local lookup-then-touch pair.
    _hostedMachineId = registerMachine().id;
    return _hostedMachineId;
  }
  const d = db || getDatabase();
  const host = normalizeHostname(hostname());
  const m = d.query("SELECT id FROM machines WHERE hostname = ?").get(host) as { id: string } | null;
  if (m) {
    touchMachine(m.id, d);
    return m.id;
  }
  return registerMachine(undefined, d).id;
}
