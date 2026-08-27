import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

export interface DbMigrationReceipt {
  migrated: boolean;
  from?: string;
  to?: string;
  reason?: "canonical-data-exists" | "no-legacy-data" | "legacy-not-a-file" | "copy-verification-failed";
}

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (!home || home === "~") {
    throw new Error("Cannot resolve the home directory: set HOME (or USERPROFILE) and try again");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for
 * computers. This is the forward-looking home the XDG migration (hotfixes
 * plan 0f49f56a, task P3.3) moves the store toward: `~/.local/share/hasna/
 * computers` on Linux, `~/Library/Application Support/Hasna/computers` on
 * macOS. The home override mirrors the pre-existing $HOME-first resolution so
 * the resolver follows the same home the legacy path does.
 */
export function getResolverDataRoot(): string {
  return dataDir({ app: "computers", home: getHomeDir() });
}

/** The legacy (pre-XDG) data root: ~/.hasna/computers */
export function getLegacyDataRoot(): string {
  return join(getHomeDir(), ".hasna", "computers");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`computers.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "computers.db"));
}

/** The exact-app override root, when set: `HASNA_COMPUTERS_HOME`, then `COMPUTERS_HOME`. */
export function getExactDataRoot(): string | undefined {
  const dir = process.env["HASNA_COMPUTERS_HOME"] ?? process.env["COMPUTERS_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_COMPUTERS_HOME`, then
 * `COMPUTERS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/computers` default. The
 * store path (`COMPUTERS_DB` / `--db`) is layered on top of this by
 * `resolveDbPath`, so an explicit store path always wins regardless.
 */
export function getDataRoot(): string {
  const exact = getExactDataRoot();
  if (exact) return exact;
  const resolved = getResolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : getLegacyDataRoot();
}

/** Effective default database path: <data root>/computers.db */
export function getDefaultDbPath(): string {
  return join(getDataRoot(), "computers.db");
}

function filesEqual(a: string, b: string): boolean {
  if (statSync(a).size !== statSync(b).size) return false;
  return hashFile(a) === hashFile(b);
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * One-time migration of the legacy cwd-relative default (./computers.db) into
 * the effective data root (<data root>/computers.db — the legacy
 * ~/.hasna/computers root until the resolver (XDG) home is adopted).
 * Idempotent and resumable: it never runs when the effective path already
 * holds data, it never overwrites an existing database, it never deletes the
 * legacy file (copy + verify + flag), and it records a receipt next to the
 * migrated database. A copy that fails verification is removed (the copy is
 * our own staging artifact, never user data) and reported as not migrated.
 */
export function migrateLegacyDb(cwd = process.cwd()): DbMigrationReceipt {
  const target = getDefaultDbPath();
  if (existsSync(target)) return { migrated: false, reason: "canonical-data-exists" };
  const legacy = resolve(cwd, "computers.db");
  if (!existsSync(legacy)) return { migrated: false, reason: "no-legacy-data" };
  if (!statSync(legacy).isFile()) return { migrated: false, reason: "legacy-not-a-file" };

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staging = `${target}.migrating`;
  rmSync(staging, { force: true }); // our own staging artifact from an interrupted run
  copyFileSync(legacy, staging);
  if (!filesEqual(legacy, staging)) {
    rmSync(staging, { force: true });
    return { migrated: false, reason: "copy-verification-failed" };
  }
  try {
    // Atomic, no-clobber publish: linkSync fails with EEXIST if a canonical
    // database appeared concurrently, so the target is never overwritten.
    linkSync(staging, target);
    rmSync(staging, { force: true });
  } catch (error) {
    rmSync(staging, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { migrated: false, reason: "canonical-data-exists" };
    throw error;
  }
  try {
    writeFileSync(
      join(dirname(target), "migration-receipt.json"),
      JSON.stringify({ from: legacy, to: target, migratedAt: new Date().toISOString() }, null, 2) + "\n",
      { flag: "wx" },
    );
  } catch {
    // The receipt is best-effort; the migrated database itself is the durable record.
  }
  return { migrated: true, from: legacy, to: target };
}

/**
 * Resolve the database path for a command. An explicit value (--db flag or
 * COMPUTERS_DB) and ":memory:" win unchanged. The default is the effective
 * data root's computers.db (legacy ~/.hasna/computers until the resolver
 * (XDG) home is adopted), with a one-time migration of a cwd-relative
 * ./computers.db into it.
 */
export function resolveDbPath(raw: string | undefined, cwd = process.cwd()): string {
  if (raw === ":memory:") return raw;
  if (raw !== undefined) return resolve(raw);
  migrateLegacyDb(cwd);
  return getDefaultDbPath();
}
