import { userInfo } from "os";
import { getDb } from "./db.js";
import type {
  AddMachineOptions,
  MachineArch,
  MachineEntry,
  MachineInstaller,
  MachinePlatform,
} from "../types.js";

function parseRow(row: Record<string, unknown>): MachineEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    host: row.host as string,
    username: row.username as string,
    port: Number(row.port ?? 22),
    platform: row.platform as MachinePlatform,
    arch: row.arch as MachineArch,
    bun_path: (row.bun_path as string) ?? null,
    npm_path: (row.npm_path as string) ?? null,
    installer: row.installer as MachineInstaller,
    ssh_key_path: (row.ssh_key_path as string) ?? null,
    enabled: Number(row.enabled ?? 1) === 1,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_seen_at: (row.last_seen_at as string) ?? null,
    last_error: (row.last_error as string) ?? null,
  };
}

function generateId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDefaultUser(): string {
  const envUser = normalizeText(process.env.USER) ?? normalizeText(process.env.LOGNAME);
  if (envUser) return envUser;
  try {
    return normalizeText(userInfo().username) ?? "hasna";
  } catch {
    return "hasna";
  }
}

function toSqlBool(value: boolean | undefined, fallback = true): number {
  return (value ?? fallback) ? 1 : 0;
}

export function listMachines(): MachineEntry[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM machines ORDER BY name ASC").all() as Record<string, unknown>[];
  return rows.map(parseRow);
}

export function getMachine(id: string): MachineEntry | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM machines WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseRow(row) : null;
}

export function addMachine(opts: AddMachineOptions): MachineEntry {
  const db = getDb();
  const host = normalizeText(opts.host);
  if (!host) throw new Error("Machine host is required");

  const name = normalizeText(opts.name) ?? host;
  const id = generateId(normalizeText(opts.id) ?? name);
  if (!id) throw new Error("Unable to generate a valid machine ID");

  const row = db
    .prepare(
      `INSERT INTO machines (
        id, name, host, username, port, platform, arch, bun_path, npm_path, installer, ssh_key_path, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .get(
      id,
      name,
      host,
      normalizeText(opts.username) ?? resolveDefaultUser(),
      opts.port ?? 22,
      opts.platform ?? "unknown",
      opts.arch ?? "unknown",
      normalizeText(opts.bun_path) ?? null,
      normalizeText(opts.npm_path) ?? null,
      opts.installer ?? "auto",
      normalizeText(opts.ssh_key_path) ?? null,
      toSqlBool(opts.enabled, true),
    ) as Record<string, unknown>;

  return parseRow(row);
}

export function upsertMachine(opts: AddMachineOptions): MachineEntry {
  const db = getDb();
  const host = normalizeText(opts.host);
  if (!host) throw new Error("Machine host is required");

  const name = normalizeText(opts.name) ?? host;
  const id = generateId(normalizeText(opts.id) ?? name);
  if (!id) throw new Error("Unable to generate a valid machine ID");

  const row = db
    .prepare(
      `INSERT INTO machines (
        id, name, host, username, port, platform, arch, bun_path, npm_path, installer, ssh_key_path, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        host = excluded.host,
        username = excluded.username,
        port = excluded.port,
        platform = excluded.platform,
        arch = excluded.arch,
        bun_path = excluded.bun_path,
        npm_path = excluded.npm_path,
        installer = excluded.installer,
        ssh_key_path = excluded.ssh_key_path,
        enabled = excluded.enabled,
        updated_at = datetime('now')
      RETURNING *`
    )
    .get(
      id,
      name,
      host,
      normalizeText(opts.username) ?? resolveDefaultUser(),
      opts.port ?? 22,
      opts.platform ?? "unknown",
      opts.arch ?? "unknown",
      normalizeText(opts.bun_path) ?? null,
      normalizeText(opts.npm_path) ?? null,
      opts.installer ?? "auto",
      normalizeText(opts.ssh_key_path) ?? null,
      toSqlBool(opts.enabled, true),
    ) as Record<string, unknown>;

  return parseRow(row);
}

export function updateMachine(
  id: string,
  updates: Partial<
    Pick<
      MachineEntry,
      | "name"
      | "host"
      | "username"
      | "port"
      | "platform"
      | "arch"
      | "bun_path"
      | "npm_path"
      | "installer"
      | "ssh_key_path"
      | "enabled"
      | "last_seen_at"
      | "last_error"
    >
  >,
): MachineEntry {
  const db = getDb();
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(normalizeText(updates.name) ?? "");
  }
  if (updates.host !== undefined) {
    sets.push("host = ?");
    values.push(normalizeText(updates.host) ?? "");
  }
  if (updates.username !== undefined) {
    sets.push("username = ?");
    values.push(normalizeText(updates.username) ?? resolveDefaultUser());
  }
  if (updates.port !== undefined) {
    sets.push("port = ?");
    values.push(updates.port);
  }
  if (updates.platform !== undefined) {
    sets.push("platform = ?");
    values.push(updates.platform);
  }
  if (updates.arch !== undefined) {
    sets.push("arch = ?");
    values.push(updates.arch);
  }
  if (updates.bun_path !== undefined) {
    sets.push("bun_path = ?");
    values.push(normalizeText(updates.bun_path) ?? null);
  }
  if (updates.npm_path !== undefined) {
    sets.push("npm_path = ?");
    values.push(normalizeText(updates.npm_path) ?? null);
  }
  if (updates.installer !== undefined) {
    sets.push("installer = ?");
    values.push(updates.installer);
  }
  if (updates.ssh_key_path !== undefined) {
    sets.push("ssh_key_path = ?");
    values.push(normalizeText(updates.ssh_key_path) ?? null);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.last_seen_at !== undefined) {
    sets.push("last_seen_at = ?");
    values.push(updates.last_seen_at);
  }
  if (updates.last_error !== undefined) {
    sets.push("last_error = ?");
    values.push(updates.last_error);
  }

  sets.push("updated_at = datetime('now')");
  values.push(id);

  const row = db
    .prepare(`UPDATE machines SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .get(...values) as Record<string, unknown> | null;

  if (!row) throw new Error(`Machine "${id}" not found`);
  return parseRow(row);
}

export function removeMachine(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM machines WHERE id = ?").run(id);
}

export const DEFAULT_MACHINE_SEEDS: AddMachineOptions[] = [
  {
    id: "spark01",
    name: "spark01",
    host: "spark01",
    platform: "linux",
    arch: "arm64",
  },
  {
    id: "spark02",
    name: "spark02",
    host: "spark02",
    platform: "linux",
    arch: "arm64",
  },
  {
    id: "apple01",
    name: "apple01",
    host: "apple01",
    platform: "darwin",
    arch: "arm64",
  },
  {
    id: "apple03",
    name: "apple03",
    host: "apple03",
    platform: "darwin",
    arch: "arm64",
  },
];

export function seedDefaultMachines(): MachineEntry[] {
  return DEFAULT_MACHINE_SEEDS.map((machine) => upsertMachine(machine));
}
