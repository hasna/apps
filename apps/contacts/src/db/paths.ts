/**
 * Pure filesystem path helpers for the on-box data directory, state directory
 * and SQLite file.
 *
 * These resolve *paths* only — they never open a database handle or import
 * `bun:sqlite`. They are split out of `database.ts` so client code (CLI
 * `backup`/`init`) can reference the on-box paths without importing the SQLite
 * transport, keeping direct SQLite access confined to the LocalStore.
 *
 * XDG conformance (hotfixes 5f624540): the on-box store, documents and config
 * resolve through @hasna/paths `dataDir()`, and the vault session state through
 * `stateDir()` — never a hardcoded `~/.hasna/contacts`. The legacy home is
 * only ever an adoption SOURCE, migrated once into the XDG roots on first use
 * under a gate: an existing (non-empty) XDG store is never clobbered.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir, stateDir } from "@hasna/paths";

function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function home(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/**
 * The home dir handed to the @hasna/paths resolver. Honoring process.env HOME
 * keeps the resolver deterministic under an injected HOME (tests, chroot, CI);
 * when neither HOME nor USERPROFILE is set, @hasna/paths falls back to
 * os.homedir() on its own.
 */
function resolverHome(): string | undefined {
  const value = process.env["HOME"] || process.env["USERPROFILE"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Legacy (pre-XDG) data home: ~/.hasna/contacts. Read-only adoption source. */
function legacyHomeDir(): string {
  return join(home(), ".hasna", "contacts");
}

/** Ancient (pre-.hasna) home: ~/.contacts. Also an adoption source. */
function ancientHomeDir(): string {
  return join(home(), ".contacts");
}

function hasContent(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Gated legacy adoption: copy the regular files of a legacy source into the
 * XDG target once, and only when the target holds no store yet. Never
 * clobbers an existing XDG store. `.vault-session` is transient session state
 * and is adopted separately into the XDG state root by `getStateDir()`.
 */
function adoptLegacy(source: string, target: string): void {
  if (!hasContent(source) || hasContent(target)) return;
  ensurePrivateDir(target);
  for (const entry of readdirSync(source)) {
    if (entry === ".vault-session") continue;
    // Skip the literal "{backups,images,documents}" directory: an empty shell
    // brace-expansion artifact created by the pre-0.6.36 postinstall.
    if (entry === "{backups,images,documents}") continue;
    const oldPath = join(source, entry);
    const newPath = join(target, entry);
    const st = statSync(oldPath);
    if (st.isDirectory()) {
      // Preserves nested documents/, images/ and friends with their perms.
      cpSync(oldPath, newPath, { recursive: true });
      chmodSync(newPath, 0o700);
    } else if (st.isFile()) {
      copyFileSync(oldPath, newPath);
      chmodSync(newPath, 0o600);
    }
  }
}

// Once a target has been adoption-checked, skip re-scanning it: the legacy
// home is a large directory and readdirSync of it on every path resolution is
// wasteful I/O under load. Each distinct target path (per test temp root or
// per env override) is checked at most once per process.
const checkedDataTargets = new Set<string>();
const checkedStateTargets = new Set<string>();

/**
 * The XDG data root for contacts (~/.local/share/hasna/contacts, or
 * $HASNA_DATA_HOME/contacts). Creates it on first use; adopts the legacy
 * `~/.hasna/contacts` (and the older `~/.contacts`) store into it once.
 */
export function getDataDir(): string {
  // Read HOME once so the XDG target and the legacy adoption source can never
  // disagree mid-call (a concurrent process.env flip must not adopt a
  // temp-home fixture into the real XDG root).
  const base = home();
  const target = dataDir({ app: "contacts", home: base });
  if (!checkedDataTargets.has(target)) {
    adoptLegacy(join(base, ".hasna", "contacts"), target);
    adoptLegacy(join(base, ".contacts"), target);
    checkedDataTargets.add(target);
  }
  ensurePrivateDir(target);
  return target;
}

/**
 * The XDG state root for contacts (~/.local/state/hasna/contacts, or
 * $HASNA_STATE_HOME/contacts) — the home of the vault session state file.
 * Adopts a legacy `~/.hasna/contacts/.vault-session` once, gated on the state
 * target holding no session yet.
 */
export function getStateDir(): string {
  const base = home();
  const target = stateDir({ app: "contacts", home: base });
  if (!checkedStateTargets.has(target)) {
    if (!hasContent(target)) {
      const legacySession = join(base, ".hasna", "contacts", ".vault-session");
      if (existsSync(legacySession)) {
        ensurePrivateDir(target);
        const targetSession = join(target, ".vault-session");
        copyFileSync(legacySession, targetSession);
        chmodSync(targetSession, 0o600);
      }
    }
    checkedStateTargets.add(target);
  }
  ensurePrivateDir(target);
  return target;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}
