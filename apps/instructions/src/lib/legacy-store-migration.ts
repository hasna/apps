import { Database } from "bun:sqlite";
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export type LegacyStoreMergePolicy = "preserve-destination";

export interface LegacyStoreMigrationOptions {
  sourcePath?: string;
  destinationPath?: string;
  backupPath?: string;
  dryRun?: boolean;
  mergePolicy?: LegacyStoreMergePolicy;
  /** Required acknowledgement that this is an explicit on-box operator action. */
  operatorConfirmed: boolean;
}

export interface LegacyStoreMigrationCounts {
  configs: number;
  snapshots: number;
  profiles: number;
  profileConfigs: number;
  machines: number;
}

export interface LegacyStoreMigrationResult {
  dryRun: boolean;
  source: LegacyStoreMigrationCounts;
  migrated: LegacyStoreMigrationCounts;
  skipped: LegacyStoreMigrationCounts;
  conflicts: number;
  snapshotsCreated: number;
  backupCreated: boolean;
  sourcePath: string;
  destinationPath: string;
  backupPath: string | null;
}

export class LegacyStoreMigrationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LegacyStoreMigrationError";
    this.code = code;
  }
}

type Row = Record<string, unknown>;
type PlannedRow = { table: keyof LegacyStoreMigrationCounts; values: Row };

const COUNT_KEYS: Array<keyof LegacyStoreMigrationCounts> = [
  "configs", "snapshots", "profiles", "profileConfigs", "machines",
];

function emptyCounts(): LegacyStoreMigrationCounts {
  return { configs: 0, snapshots: 0, profiles: 0, profileConfigs: 0, machines: 0 };
}

export function legacyInstructionsStorePaths(home = process.env.HOME || homedir()): {
  sourcePath: string;
  destinationPath: string;
} {
  return {
    sourcePath: join(home, ".hasna", "configs", "configs.db"),
    destinationPath: join(home, ".hasna", "instructions", "instructions.db"),
  };
}

function tableExists(db: Database, table: string): boolean {
  return db.query<{ present: number }, [string]>(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table)?.present === 1;
}

function columns(db: Database, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  return new Set(db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function rows(db: Database, table: string): Row[] {
  if (!tableExists(db, table)) return [];
  return db.query<Row, []>(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function value(row: Row, name: string, fallback: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(row, name) && row[name] !== undefined
    ? row[name]
    : fallback;
}

function normalizeJson(valueToNormalize: unknown, fallback: string): string {
  if (typeof valueToNormalize !== "string") return fallback;
  try {
    JSON.parse(valueToNormalize);
    return valueToNormalize;
  } catch {
    return fallback;
  }
}

function compatibleConfig(row: Row): Row {
  return {
    id: value(row, "id", ""),
    name: value(row, "name", ""),
    slug: value(row, "slug", ""),
    kind: value(row, "kind", "file"),
    category: value(row, "category", "rules"),
    agent: value(row, "agent", "global"),
    target_path: value(row, "target_path", null),
    outputs: normalizeJson(value(row, "outputs", "[]"), "[]"),
    format: value(row, "format", "text"),
    content: value(row, "content", ""),
    description: value(row, "description", null),
    tags: normalizeJson(value(row, "tags", "[]"), "[]"),
    is_template: value(row, "is_template", 0),
    version: value(row, "version", 1),
    created_at: value(row, "created_at", "1970-01-01T00:00:00.000Z"),
    updated_at: value(row, "updated_at", value(row, "created_at", "1970-01-01T00:00:00.000Z")),
    synced_at: value(row, "synced_at", null),
  };
}

function compatibleProfile(row: Row): Row {
  return {
    id: value(row, "id", ""), name: value(row, "name", ""), slug: value(row, "slug", ""),
    description: value(row, "description", null),
    selectors: normalizeJson(value(row, "selectors", "{}"), "{}"),
    variables: normalizeJson(value(row, "variables", "{}"), "{}"),
    created_at: value(row, "created_at", "1970-01-01T00:00:00.000Z"),
    updated_at: value(row, "updated_at", value(row, "created_at", "1970-01-01T00:00:00.000Z")),
  };
}

function compatibleMachine(row: Row): Row {
  return {
    id: value(row, "id", ""), hostname: value(row, "hostname", ""), os: value(row, "os", null),
    arch: value(row, "arch", null), last_applied_at: value(row, "last_applied_at", null),
    created_at: value(row, "created_at", "1970-01-01T00:00:00.000Z"),
  };
}

function stableSnapshotId(config: Row): string {
  const digest = createHash("sha256")
    .update(String(config.id)).update("\0")
    .update(String(config.version)).update("\0")
    .update(String(config.content))
    .digest("hex").slice(0, 32);
  return `legacy-current-${digest}`;
}

function countDestinationRows(db: Database): number {
  return ["configs", "config_snapshots", "profiles", "profile_configs", "machines"]
    .reduce((total, table) => {
      if (!tableExists(db, table)) return total;
      return total + (db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
    }, 0);
}

function requireCurrentSchema(db: Database): void {
  const required: Record<string, string[]> = {
    configs: ["id", "slug", "kind", "outputs", "content", "version"],
    config_snapshots: ["id", "config_id", "content", "version"],
    profiles: ["id", "slug", "selectors", "variables"],
    profile_configs: ["profile_id", "config_id", "binding"],
    machines: ["id", "hostname", "arch"],
  };
  for (const [table, names] of Object.entries(required)) {
    const actual = columns(db, table);
    if (names.some((name) => !actual.has(name))) {
      throw new LegacyStoreMigrationError(
        "DESTINATION_SCHEMA_INCOMPATIBLE",
        `instructions legacy migration: destination is not a current Instructions SQLite database (incompatible ${table} table)`,
      );
    }
  }
}

function sameConfig(a: Row, b: Row): boolean {
  const keys = ["id", "name", "slug", "kind", "category", "agent", "target_path", "outputs", "format", "content", "description", "tags", "is_template", "version", "created_at", "updated_at", "synced_at"];
  return keys.every((key) => String(a[key] ?? "") === String(b[key] ?? ""));
}

function buildPlan(source: Database, destination: Database, mergePolicy?: LegacyStoreMergePolicy): {
  source: LegacyStoreMigrationCounts;
  migrated: LegacyStoreMigrationCounts;
  skipped: LegacyStoreMigrationCounts;
  conflicts: number;
  snapshotsCreated: number;
  rows: PlannedRow[];
} {
  const sourceCounts = emptyCounts();
  const migrated = emptyCounts();
  const skipped = emptyCounts();
  const planned: PlannedRow[] = [];
  let conflicts = 0;
  let snapshotsCreated = 0;

  const sourceConfigs = rows(source, "configs").map(compatibleConfig);
  const sourceSnapshots = rows(source, "config_snapshots");
  const sourceProfiles = rows(source, "profiles").map(compatibleProfile);
  const sourceProfileConfigs = rows(source, "profile_configs");
  const sourceMachines = rows(source, "machines").map(compatibleMachine);
  sourceCounts.configs = sourceConfigs.length;
  sourceCounts.snapshots = sourceSnapshots.length;
  sourceCounts.profiles = sourceProfiles.length;
  sourceCounts.profileConfigs = sourceProfileConfigs.length;
  sourceCounts.machines = sourceMachines.length;

  const acceptedConfigIds = new Set<string>();
  for (const config of sourceConfigs) {
    const id = String(config.id);
    const existing = destination.query<Row, [string, string]>(
      "SELECT * FROM configs WHERE id = ? OR slug = ? LIMIT 1",
    ).get(id, String(config.slug));
    if (existing) {
      skipped.configs++;
      if (!sameConfig(existing, config)) conflicts++;
      if (mergePolicy === "preserve-destination" && String(existing.id) === id && sameConfig(existing, config)) {
        acceptedConfigIds.add(id);
      }
      continue;
    }
    acceptedConfigIds.add(id);
    planned.push({ table: "configs", values: config });
    migrated.configs++;
  }

  const snapshotIdentity = new Set<string>();
  for (const snapshot of sourceSnapshots) {
    const configId = String(value(snapshot, "config_id", ""));
    if (!acceptedConfigIds.has(configId)) {
      skipped.snapshots++;
      continue;
    }
    const normalized = {
      id: value(snapshot, "id", ""), config_id: configId,
      content: value(snapshot, "content", ""), version: value(snapshot, "version", 1),
      created_at: value(snapshot, "created_at", "1970-01-01T00:00:00.000Z"),
    };
    const identity = `${configId}\0${normalized.version}\0${normalized.content}`;
    snapshotIdentity.add(identity);
    const existing = destination.query<{ id: string }, [string]>(
      "SELECT id FROM config_snapshots WHERE id = ?",
    ).get(String(normalized.id));
    if (existing) skipped.snapshots++;
    else {
      planned.push({ table: "snapshots", values: normalized });
      migrated.snapshots++;
    }
  }

  for (const config of sourceConfigs) {
    const configId = String(config.id);
    if (!acceptedConfigIds.has(configId)) continue;
    const identity = `${configId}\0${config.version}\0${config.content}`;
    const destinationHas = destination.query<{ present: number }, [string, number, string]>(
      "SELECT 1 AS present FROM config_snapshots WHERE config_id = ? AND version = ? AND content = ? LIMIT 1",
    ).get(configId, Number(config.version), String(config.content));
    if (!snapshotIdentity.has(identity) && !destinationHas) {
      planned.push({ table: "snapshots", values: {
        id: stableSnapshotId(config), config_id: configId, content: config.content,
        version: config.version, created_at: config.updated_at,
      } });
      migrated.snapshots++;
      snapshotsCreated++;
    }
  }

  const acceptedProfileIds = new Set<string>();
  for (const profile of sourceProfiles) {
    const existing = destination.query<{ id: string }, [string, string]>(
      "SELECT id FROM profiles WHERE id = ? OR slug = ? LIMIT 1",
    ).get(String(profile.id), String(profile.slug));
    if (existing) {
      skipped.profiles++;
      if (String(existing.id) !== String(profile.id)) conflicts++;
    } else {
      acceptedProfileIds.add(String(profile.id));
      planned.push({ table: "profiles", values: profile });
      migrated.profiles++;
    }
  }

  for (const link of sourceProfileConfigs) {
    const profileId = String(value(link, "profile_id", ""));
    const configId = String(value(link, "config_id", ""));
    if (!acceptedProfileIds.has(profileId) || !acceptedConfigIds.has(configId)) {
      skipped.profileConfigs++;
      continue;
    }
    planned.push({ table: "profileConfigs", values: {
      profile_id: profileId, config_id: configId, sort_order: value(link, "sort_order", 0),
      binding: normalizeJson(value(link, "binding", '{"schema":"hasna.instructions.profile-config-binding/v1","activation":{"mode":"always"},"required":true,"fallback":"fail"}'), '{}'),
    } });
    migrated.profileConfigs++;
  }

  for (const machine of sourceMachines) {
    const existing = destination.query<{ id: string }, [string, string]>(
      "SELECT id FROM machines WHERE id = ? OR hostname = ? LIMIT 1",
    ).get(String(machine.id), String(machine.hostname));
    if (existing) {
      skipped.machines++;
      if (String(existing.id) !== String(machine.id)) conflicts++;
    } else {
      planned.push({ table: "machines", values: machine });
      migrated.machines++;
    }
  }

  return { source: sourceCounts, migrated, skipped, conflicts, snapshotsCreated, rows: planned };
}

function insertRow(db: Database, row: PlannedRow): void {
  const table = row.table === "snapshots" ? "config_snapshots"
    : row.table === "profileConfigs" ? "profile_configs" : row.table;
  const names = Object.keys(row.values);
  const placeholders = names.map(() => "?").join(", ");
  db.run(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders})`,
    names.map((name) => row.values[name] as string | number | null),
  );
}

export function migrateLegacyInstructionsStore(
  options: LegacyStoreMigrationOptions,
): LegacyStoreMigrationResult {
  if (!options.operatorConfirmed) {
    throw new LegacyStoreMigrationError(
      "LOCAL_OPERATOR_CONFIRMATION_REQUIRED",
      "instructions legacy migration requires explicit local operator confirmation",
    );
  }
  const defaults = legacyInstructionsStorePaths();
  const sourcePath = resolve(options.sourcePath ?? defaults.sourcePath);
  const destinationPath = resolve(options.destinationPath ?? defaults.destinationPath);
  const dryRun = options.dryRun ?? true;
  if (sourcePath === destinationPath) {
    throw new LegacyStoreMigrationError("SOURCE_DESTINATION_SAME", "instructions legacy migration source and destination must differ");
  }
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new LegacyStoreMigrationError("SOURCE_NOT_FOUND", "instructions legacy migration source database was not found");
  }
  if (!existsSync(destinationPath) || !statSync(destinationPath).isFile()) {
    throw new LegacyStoreMigrationError(
      "DESTINATION_NOT_FOUND",
      "instructions legacy migration destination must be an initialized current Instructions SQLite database",
    );
  }

  const source = new Database(sourcePath, { readonly: true, strict: true });
  const destination = new Database(destinationPath, { strict: true });
  let backupPath: string | null = null;
  try {
    source.run("PRAGMA query_only = ON");
    destination.run("PRAGMA foreign_keys = ON");
    requireCurrentSchema(destination);
    const destinationRows = countDestinationRows(destination);
    if (destinationRows > 0 && options.mergePolicy === undefined) {
      throw new LegacyStoreMigrationError(
        "DESTINATION_NOT_EMPTY",
        "instructions legacy migration refuses a non-empty destination without an explicit merge policy",
      );
    }
    const plan = buildPlan(source, destination, options.mergePolicy);
    if (!dryRun) {
      backupPath = resolve(options.backupPath ?? `${destinationPath}.before-legacy-migration.bak`);
      if (backupPath === sourcePath || backupPath === destinationPath) {
        throw new LegacyStoreMigrationError("INVALID_BACKUP_PATH", "instructions legacy migration backup path must be separate");
      }
      if (existsSync(backupPath)) {
        throw new LegacyStoreMigrationError(
          "BACKUP_ALREADY_EXISTS",
          "instructions legacy migration refuses to overwrite an existing destination backup",
        );
      }
      mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
      destination.run("PRAGMA wal_checkpoint(FULL)");
      copyFileSync(destinationPath, backupPath, constants.COPYFILE_EXCL);
      chmodSync(backupPath, 0o600);
      const apply = destination.transaction(() => {
        for (const row of plan.rows) insertRow(destination, row);
      });
      apply();
    }
    return {
      dryRun,
      source: plan.source,
      migrated: plan.migrated,
      skipped: plan.skipped,
      conflicts: plan.conflicts,
      snapshotsCreated: plan.snapshotsCreated,
      backupCreated: !dryRun,
      sourcePath,
      destinationPath,
      backupPath,
    };
  } catch (error) {
    if (error instanceof LegacyStoreMigrationError) throw error;
    throw new LegacyStoreMigrationError(
      "MIGRATION_FAILED",
      `instructions legacy migration failed safely: ${error instanceof Error ? error.name : "unknown error"}`,
    );
  } finally {
    source.close();
    destination.close();
  }
}
