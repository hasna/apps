import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getDbPath } from "./database.js";
import { sanitizeRemoteIdentity } from "../lib/remote-identity.js";

export const REGISTRY_REGISTER_SCHEMA = "repos.registry-register.v1" as const;
export class RegistryRegisterError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "RegistryRegisterError"; }
}
export interface RegistryRegisterRequest {
  path: string;
  expectedRemote: string;
  expectedHead: string;
  expectedBranch: string;
  apply?: boolean;
  /** Confirms normal provider resolution; this does not select another store. */
  expectedDatabasePath?: string;
  expectedPlanHash?: string;
}
interface RegistrationRow {
  path: string; name: string; org: string; remote_url: string; default_branch: string;
}
interface Identity { dev: number; ino: number; uid: number; mode: number }
interface CheckoutWitness {
  root: Identity;
  git: Identity;
  index: { sha256: string; dev: number; ino: number; bytes: number };
  head: string;
  branch: string;
  remote: string;
}
export interface RegistryRegisterResult {
  schema: typeof REGISTRY_REGISTER_SCHEMA;
  applied: boolean;
  inserted: 0 | 1;
  already_registered: boolean;
  repo_id: number | null;
  plan: {
    database: string;
    database_identity: Identity;
    row: RegistrationRow;
    checkout: CheckoutWitness;
    plan_hash: string;
  };
}
const fail = (code: string): never => { throw new RegistryRegisterError(code); };
function need(ok: unknown, code: string): asserts ok { if (!ok) fail(code); }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const identity = (s: Stats): Identity => ({ dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function absolute(value: unknown): asserts value is string {
  need(typeof value === "string" && value.length <= 4096 && isAbsolute(value)
    && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value), "INVALID_REQUEST");
}
function ordinaryPath(path: string, kind: "directory" | "file", code: string): Identity {
  try {
    for (let p = path; ; p = dirname(p)) {
      const s = lstatSync(p);
      need(!s.isSymbolicLink() && (p === path && kind === "file" ? s.isFile() : s.isDirectory()), code);
      if (typeof process.getuid === "function") {
        need(s.uid === process.getuid() || s.uid === 0, code);
        const trustedTemporaryAncestor = p !== path && s.uid === 0 && (s.mode & 0o1000) !== 0;
        need((s.mode & 0o022) === 0 || trustedTemporaryAncestor, code);
      }
      if (p === path) {
        need(typeof process.getuid !== "function" || s.uid === process.getuid(), code);
        need((s.mode & 0o022) === 0 && (kind !== "file" || s.nlink === 1), code);
      }
      if (p === dirname(p)) break;
    }
    need(realpathSync(path) === path, code);
    return identity(lstatSync(path));
  } catch (error) { if (error instanceof RegistryRegisterError) throw error; return fail(code); }
}
function regularWitness(path: string) {
  const expected = ordinaryPath(path, "file", "PATH_UNTRUSTED");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    need(before.isFile() && before.nlink === 1 && before.size <= 32 * 1024 * 1024
      && same(expected, identity(before)), "PATH_UNTRUSTED");
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    const raw = buffer.subarray(0, bytes);
    const after = fstatSync(fd);
    need(raw.length === before.size && before.ino === after.ino && before.dev === after.dev
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.size === after.size
      && same(identity(before), identity(after)), "CHECKOUT_CHANGED");
    return { sha256: hash(raw), dev: after.dev, ino: after.ino, bytes: after.size };
  } finally { closeSync(fd); }
}
function git(path: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" });
  try {
    return execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", path, ...args], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 64 * 1024,
    }).trim();
  } catch { return fail("GIT_READ_FAILED"); }
}
function checkout(request: RegistryRegisterRequest): CheckoutWitness {
  const root = ordinaryPath(request.path, "directory", "PATH_UNTRUSTED");
  const gitDir = join(request.path, ".git");
  const authority = ordinaryPath(gitDir, "directory", "PATH_UNTRUSTED");
  for (const name of ["commondir", "index.lock", "HEAD.lock", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    need(!lstatSync(join(gitDir, name), { throwIfNoEntry: false }), "GIT_OPERATION_OR_LINKED_AUTHORITY");
  }
  regularWitness(join(gitDir, "HEAD")); regularWitness(join(gitDir, "config"));
  const index = regularWitness(join(gitDir, "index"));
  need(git(request.path, ["rev-parse", "--show-toplevel"]) === request.path, "PATH_UNTRUSTED");
  const head = git(request.path, ["rev-parse", "--verify", "HEAD"]);
  need(head === request.expectedHead, "HEAD_MISMATCH");
  const branch = git(request.path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  need(branch === request.expectedBranch, "BRANCH_MISMATCH");
  const remote = sanitizeRemoteIdentity(git(request.path, ["remote", "get-url", "origin"]));
  need(remote === request.expectedRemote, "REMOTE_MISMATCH");
  need(same(index, regularWitness(join(gitDir, "index"))) && same(root, ordinaryPath(request.path, "directory", "PATH_UNTRUSTED"))
    && same(authority, ordinaryPath(gitDir, "directory", "PATH_UNTRUSTED")), "CHECKOUT_CHANGED");
  return { root, git: authority, index, head, branch, remote };
}
function schema(db: Database) {
  for (const [table, required] of Object.entries({
    repos: ["id", "path", "name", "org", "remote_url", "default_branch"],
    worktree_leases: ["repo_id", "repo_path", "repo_catalog_id", "worktree_path", "git_common_dir", "status"],
  })) {
    need((db.query("SELECT type FROM sqlite_master WHERE name=?").get(table) as { type?: string } | null)?.type === "table", "SCHEMA_UNSUPPORTED");
    const columns = new Set((db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(x => x.name));
    need(required.every(column => columns.has(column)), "SCHEMA_UNSUPPORTED");
  }
  // An additive catalog operation must not inherit arbitrary INSERT-trigger
  // side effects. These are the three standard search-index triggers created
  // by the normal Repos schema; no other catalog/FTS trigger is admitted.
  const expected: Record<string, string> = {
    repos_ai: "CREATE TRIGGER repos_ai AFTER INSERT ON repos BEGIN INSERT INTO fts_repos(rowid,name,org,description,remote_url) VALUES(new.id,new.name,new.org,new.description,new.remote_url); END",
    repos_ad: "CREATE TRIGGER repos_ad AFTER DELETE ON repos BEGIN INSERT INTO fts_repos(fts_repos,rowid,name,org,description,remote_url) VALUES('delete',old.id,old.name,old.org,old.description,old.remote_url); END",
    repos_au: "CREATE TRIGGER repos_au AFTER UPDATE ON repos BEGIN INSERT INTO fts_repos(fts_repos,rowid,name,org,description,remote_url) VALUES('delete',old.id,old.name,old.org,old.description,old.remote_url); INSERT INTO fts_repos(rowid,name,org,description,remote_url) VALUES(new.id,new.name,new.org,new.description,new.remote_url); END",
  };
  const normalized = (sql: string) => sql.replace(/\s/g, "").replace(/;$/, "").toLowerCase();
  const triggers = db.query("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND (tbl_name='repos' OR tbl_name LIKE 'fts_repos%')")
    .all() as Array<{ name: string; tbl_name: string; sql: string }>;
  need(triggers.every(t => t.tbl_name === "repos" && expected[t.name] && normalized(t.sql) === normalized(expected[t.name]!)), "SCHEMA_UNSUPPORTED");
}
function existingRow(db: Database, row: RegistrationRow): number | null {
  const entries = db.query("SELECT id,path,name,org,remote_url,default_branch FROM repos LIMIT 100001").all() as Array<RegistrationRow & { id: number }>;
  need(entries.length <= 100000, "REGISTRY_BOUND");
  let found: number | null = null;
  for (const entry of entries) {
    if (entry.path === row.path) {
      need(found === null && entry.name === row.name && entry.org === row.org && sanitizeRemoteIdentity(entry.remote_url) === row.remote_url
        && entry.default_branch === row.default_branch, "EXISTING_ROW_CONFLICT");
      found = entry.id;
    } else {
      try { need(realpathSync(entry.path) !== row.path, "EXISTING_PATH_ALIAS"); }
      catch (error) { if (error instanceof RegistryRegisterError) throw error; }
    }
  }
  return found;
}
function leaseGuard(db: Database, row: RegistrationRow) {
  const result = db.query(`SELECT count(*) AS n FROM worktree_leases WHERE coalesce(status,'') != 'released' AND (
    lower(repo_id)=lower($remote) OR repo_id=$pathId OR repo_id=$commonId OR repo_path=$path
    OR git_common_dir=$common OR worktree_path=$path OR substr(worktree_path,1,length($path)+1)=$path||'/'
    OR repo_catalog_id IN (SELECT id FROM repos WHERE path=$path OR (lower(name)=lower($name) AND lower(org)=lower($org))))`).get({
      $remote: row.remote_url.replace(/^github\.com\//, "github:"), $pathId: "path:" + row.path,
      $commonId: "path:" + join(row.path, ".git"), $path: row.path, $common: join(row.path, ".git"), $name: row.name, $org: row.org,
    }) as { n: number };
  need(result.n === 0, "ACTIVE_LEASE_CONFLICT");
}

/**
 * Register one existing standalone checkout in the normally resolved registry.
 * This operation never bootstraps, migrates schemas, installs hooks, scans
 * history, syncs a catalog, merges rows, or modifies Git/lease state. Existing
 * matching rows are returned unchanged. Standard SQLite FTS insert triggers
 * maintain the newly inserted row's search index.
 */
export function registerRepository(request: RegistryRegisterRequest): RegistryRegisterResult {
  need(request.apply === undefined || request.apply === false || request.apply === true, "INVALID_REQUEST");
  absolute(request.path);
  need(typeof request.expectedRemote === "string" && sanitizeRemoteIdentity(request.expectedRemote) === request.expectedRemote
    && /^github\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(request.expectedRemote), "INVALID_REQUEST");
  need(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request.expectedHead) && typeof request.expectedBranch === "string"
    && request.expectedBranch.length > 0 && request.expectedBranch.length <= 256 && !/[\x00-\x20\x7f]/.test(request.expectedBranch), "INVALID_REQUEST");
  if (request.apply) need(request.expectedDatabasePath && /^[a-f0-9]{64}$/.test(request.expectedPlanHash ?? ""), "CONFIRMATION_REQUIRED");
  const database = resolve(getDbPath());
  if (request.expectedDatabasePath !== undefined) need(request.expectedDatabasePath === database, "DATABASE_MISMATCH");
  const dbIdentity = ordinaryPath(database, "file", "DATABASE_UNAVAILABLE");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (lstatSync(database + suffix, { throwIfNoEntry: false })) {
      ordinaryPath(database + suffix, "file", "DATABASE_UNAVAILABLE");
      need(suffix !== "-journal", "DATABASE_JOURNAL_PRESENT");
    }
  }
  const [, org, name] = request.expectedRemote.split("/");
  need(basename(request.path) === name, "PATH_NAME_MISMATCH");
  const row: RegistrationRow = { path: request.path, name: name!, org: org!, remote_url: request.expectedRemote, default_branch: request.expectedBranch };
  let db: Database;
  try { db = new Database(database, request.apply ? { readwrite: true, create: false } : { readonly: true, create: false }); }
  catch { return fail("DATABASE_UNAVAILABLE"); }
  let transaction = false;
  try {
    db.exec("PRAGMA busy_timeout=5000"); db.exec("PRAGMA foreign_keys=ON");
    if (request.apply) { db.exec("BEGIN IMMEDIATE"); transaction = true; }
    schema(db);
    need(same(dbIdentity, ordinaryPath(database, "file", "DATABASE_UNAVAILABLE")), "DATABASE_CHANGED");
    const witness = checkout(request);
    const existing = existingRow(db, row); leaseGuard(db, row);
    const core = { database, database_identity: dbIdentity, row, checkout: witness };
    const plan = { ...core, plan_hash: hash(JSON.stringify(core)) };
    if (request.apply) need(request.expectedPlanHash === plan.plan_hash, "PLAN_HASH_MISMATCH");
    let repoId = existing;
    if (request.apply && repoId === null) {
      const result = db.query("INSERT OR ABORT INTO repos (path,name,org,remote_url,default_branch) VALUES (?,?,?,?,?)")
        .run(row.path, row.name, row.org, row.remote_url, row.default_branch);
      repoId = Number(result.lastInsertRowid);
      // Bun's changes count includes normal FTS trigger writes. Verify the
      // exact catalog row instead of mistaking those index writes for extras.
      need(Number.isSafeInteger(repoId) && repoId > 0 && existingRow(db, row) === repoId, "REGISTRATION_FAILED");
    }
    need(same(witness, checkout(request)), "CHECKOUT_CHANGED");
    need(same(dbIdentity, ordinaryPath(database, "file", "DATABASE_UNAVAILABLE")), "DATABASE_CHANGED");
    if (transaction) { db.exec("COMMIT"); transaction = false; }
    return { schema: REGISTRY_REGISTER_SCHEMA, applied: request.apply === true && existing === null,
      inserted: request.apply === true && existing === null ? 1 : 0, already_registered: existing !== null, repo_id: repoId, plan };
  } catch (error) {
    if (transaction) { try { db.exec("ROLLBACK"); } catch {} }
    if (error instanceof RegistryRegisterError) throw error;
    return fail("REGISTRATION_FAILED");
  } finally { db.close(); }
}
