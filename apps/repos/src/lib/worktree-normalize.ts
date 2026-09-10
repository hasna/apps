/** Lossless, one-worktree-at-a-time normalization into the org-scoped layout. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { closeSync, constants, cpSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDb } from "../db/database.js";
import type { Repo } from "../types/index.js";
import { sanitizeRemoteIdentity } from "./remote-identity.js";
import { assertWorktreeName, computeWorktreePath, legacyFlatWorktreePath, redactGitDiagnostics, WorktreeError, worktreeOrgSegment, worktreeRootDir } from "./worktrees.js";

export const WORKTREE_NORMALIZE_SCHEMA = "repos.worktree-normalize.v1" as const;
type Row = Record<string, unknown>;
type FileEntry = { path: string; mode: number; kind: "file" | "directory" | "link"; digest?: string; target?: string };
type LinkChange = { path: string; before: string; after: string };
interface Snapshot {
  head: string; branch: string; status: string; index: string | null; files: FileEntry[];
}
interface State {
  schema: typeof WORKTREE_NORMALIZE_SCHEMA;
  repo_id: number; source: string; destination: string; parent: string; common_dir: string; git_dir: string;
  inode: number; device: number; snapshot: Snapshot; links: LinkChange[]; leases: Row[]; repos: Row[];
}
interface Journal { plan_hash: string; state: State; phase: "preparing" | "checkpointed" | "moving" | "moved" | "complete" | "rolled-back"; }
export interface NormalizeWorktreeRequest {
  /** Exact unique name or <org>/<repo>; never a filesystem path. */
  repo: string;
  name: string;
  apply?: boolean;
  expectedPlanHash?: string;
  /** Restore the paths in this operation's saved receipt; checkpoint files are retained. */
  rollback?: string;
  db?: Database;
}
export interface NormalizeWorktreeResult {
  schema: typeof WORKTREE_NORMALIZE_SCHEMA;
  action: "move" | "already-canonical" | "rolled-back";
  applied: boolean;
  source: string;
  destination: string;
  plan_hash: string;
  checkpoint: string | null;
  head: string;
  files: number;
  adjusted_links: number;
  lease_ids: string[];
}
function fail(message: string): never { throw new WorktreeError("LAYOUT_INVARIANT_VIOLATED", message); }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function present(path: string): boolean { try { lstatSync(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } }
function within(parent: string, path: string): boolean { return path === parent || path.startsWith(parent + sep); }
function git(path: string, ...args: string[]): string {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  // The caller chooses a registered repository, not a Git location override.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete (env as NodeJS.ProcessEnv)[key];
  try {
    return execFileSync("git", args, { cwd: path, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
      env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { const error = e as { stderr?: Buffer }; fail(`git operation failed: ${redactGitDiagnostics(String(error.stderr ?? "no diagnostic"))}`); }
}
function fileDigest(path: string): string {
  const h = createHash("sha256"), fd = openSync(path, "r"), buffer = Buffer.alloc(1024 * 1024);
  try { let n: number; while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) h.update(buffer.subarray(0, n)); }
  finally { closeSync(fd); }
  return h.digest("hex");
}
/** Every file, including ignored files; symlinks are recorded without following them. */
function inventory(root: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (dir === root && name === ".git") continue;
      const path = join(dir, name), rel = relative(root, path), st = lstatSync(path), mode = st.mode & 0o777;
      if (st.isSymbolicLink()) entries.push({ path: rel, mode, kind: "link", target: readlinkSync(path) });
      else if (st.isDirectory()) { entries.push({ path: rel, mode, kind: "directory" }); walk(path); }
      else if (st.isFile()) entries.push({ path: rel, mode, kind: "file", digest: fileDigest(path) });
      else fail(`unsupported special file in worktree: ${rel}; stop its writer before normalization`);
    }
  };
  walk(root); return entries;
}
function snapshot(path: string, gitDir: string): Snapshot {
  return { head: git(path, "rev-parse", "HEAD").trim(), branch: git(path, "rev-parse", "--abbrev-ref", "HEAD").trim(),
    status: git(path, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
    index: present(join(gitDir, "index")) ? fileDigest(join(gitDir, "index")) : null, files: inventory(path) };
}
function noSymlinkPath(root: string, path: string): void {
  if (!within(root, path)) fail("normalization path is outside the worktree root");
  let cursor = root;
  if (realpathSync(root) !== root) fail("worktree root must resolve without aliases");
  for (const segment of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (present(cursor) && lstatSync(cursor).isSymbolicLink()) fail(`symlink in normalization path: ${cursor}`);
  }
}
function registryRepo(db: Database, ref: string): Repo {
  const parts = ref.split("/");
  if (parts.length < 1 || parts.length > 2) fail("repo must be a unique name or <org>/<repo>");
  for (const part of parts) assertWorktreeName(part);
  const rows = db.query("SELECT * FROM repos WHERE name = ?").all(parts.at(-1)!) as Repo[];
  const matches = rows.filter(row => (parts.length === 1 || worktreeOrgSegment(row) === parts[0]) && !within(worktreeRootDir(), row.path));
  if (matches.length !== 1) fail("repo must identify exactly one primary registered checkout");
  const row = matches[0]!;
  const remote = sanitizeRemoteIdentity(row.remote_url);
  if (remote && (remote.split("/")[1] !== worktreeOrgSegment(row) || remote.split("/")[2] !== row.name)) fail("registry org/name disagrees with the remote identity");
  return row;
}
function affected(db: Database, source: string): { leases: Row[]; repos: Row[] } {
  const leases = (db.query("SELECT * FROM worktree_leases ORDER BY lease_id").all() as Row[])
    .filter(row => [row.worktree_path, row.repo_path, row.git_common_dir].some(p => typeof p === "string" && within(source, p)));
  const repos = (db.query("SELECT * FROM repos ORDER BY id").all() as Row[]).filter(row => typeof row.path === "string" && within(source, row.path));
  return { leases, repos };
}
function capture(db: Database, repo: Repo, source: string, destination: string): State {
  const parent = realpathSync(repo.path), common = git(parent, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
  if (realpathSync(common) !== join(parent, ".git")) fail("normalization requires the registered primary clone");
  if (!present(join(source, ".git")) || !lstatSync(join(source, ".git")).isFile()) fail("source is not a linked worktree");
  if (realpathSync(git(source, "rev-parse", "--path-format=absolute", "--git-common-dir").trim()) !== common) fail("source belongs to a different repository");
  const gitDir = realpathSync(git(source, "rev-parse", "--absolute-git-dir").trim());
  if (dirname(gitDir) !== join(common, "worktrees")) fail("unexpected worktree Git administrative directory");
  if (resolve(readFileSync(join(gitDir, "gitdir"), "utf8").trim()) !== join(source, ".git")) fail("worktree Git backlink does not match its source path");
  if ([join(gitDir, "locked"), join(gitDir, "index.lock"), join(common, "index.lock")].some(present)) fail("worktree is locked or a Git writer is active");
  if (present(join(source, ".gitmodules"))) fail("submodule worktrees need a separate relocation procedure");
  const snap = snapshot(source, gitDir), links: LinkChange[] = [];
  for (const entry of snap.files) {
    if (entry.kind !== "link" || isAbsolute(entry.target!)) continue;
    const oldTarget = resolve(dirname(join(source, entry.path)), entry.target!);
    if (!within(source, oldTarget)) links.push({ path: entry.path, before: entry.target!, after: relative(dirname(join(destination, entry.path)), oldTarget) });
  }
  // Rewriting a tracked symlink would change the index/worktree relationship.
  const tracked = new Set(git(source, "ls-files", "-z").split("\0"));
  if (links.some(link => tracked.has(link.path))) fail("a tracked relative symlink crosses the worktree boundary; review it before moving");
  const metadata = affected(db, source);
  const destinationRows = affected(db, destination);
  if (source !== destination && (destinationRows.leases.length || destinationRows.repos.length)) fail("destination is occupied by registry or lease metadata");
  for (const row of metadata.repos) {
    const newPath = destination + String(row.path).slice(source.length);
    if (source !== destination && db.query("SELECT id FROM repos WHERE path=?").get(newPath)) fail("destination registry path is occupied");
  }
  const st = statSync(source);
  return { schema: WORKTREE_NORMALIZE_SCHEMA, repo_id: repo.id, source, destination, parent, common_dir: common, git_dir: gitDir,
    inode: st.ino, device: st.dev, snapshot: snap, links, ...metadata };
}
function output(state: State, planHash: string, checkpoint: string | null, applied: boolean, action: NormalizeWorktreeResult["action"]): NormalizeWorktreeResult {
  return { schema: WORKTREE_NORMALIZE_SCHEMA, action, applied, source: state.source, destination: state.destination, plan_hash: planHash,
    checkpoint, head: state.snapshot.head, files: state.snapshot.files.length, adjusted_links: state.links.length,
    lease_ids: state.leases.map(row => String(row.lease_id)) };
}
function writeJournal(path: string, journal: Journal): void {
  const temp = path + ".tmp"; writeFileSync(temp, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
function expectedSnapshot(state: State, moved: boolean): Snapshot {
  if (!moved) return state.snapshot;
  return { ...state.snapshot, files: state.snapshot.files.map(entry => {
    const link = state.links.find(l => l.path === entry.path);
    return link ? { ...entry, target: link.after } : entry;
  }) };
}
function adjustLinks(state: State, moved: boolean): void {
  const root = moved ? state.destination : state.source;
  for (const link of state.links) {
    const path = join(root, link.path), want = moved ? link.after : link.before;
    if (!lstatSync(path).isSymbolicLink()) fail("relative symlink changed during normalization");
    const current = readlinkSync(path);
    if (current === want) continue;
    if (current !== (moved ? link.before : link.after)) fail("relative symlink target changed during normalization");
    unlinkSync(path); symlinkSync(want, path);
  }
}
function mappedRow(row: Row, state: State, table: "repos" | "worktree_leases"): Row {
  const result = { ...row };
  for (const key of table === "repos" ? ["path"] : ["worktree_path", "repo_path", "git_common_dir"]) {
    const value = result[key]; if (typeof value === "string" && within(state.source, value)) result[key] = state.destination + value.slice(state.source.length);
  }
  return result;
}
function updateRows(db: Database, state: State, forward: boolean): void {
  for (const table of ["repos", "worktree_leases"] as const) {
    const key = table === "repos" ? "id" : "lease_id", rows = table === "repos" ? state.repos : state.leases;
    for (const original of rows) {
      const moved = mappedRow(original, state, table), before = forward ? original : moved, after = forward ? moved : original;
      const current = db.query(`SELECT * FROM ${table} WHERE ${key}=?`).get(before[key] as string | number) as Row | null;
      if (hash(current) === hash(after)) continue;
      if (hash(current) !== hash(before)) fail("registry or lease changed since the reviewed plan");
      const fields = Object.keys(after).filter(k => after[k] !== before[k]);
      if (fields.length) db.query(`UPDATE ${table} SET ${fields.map(k => `${k}=?`).join(",")} WHERE ${key}=?`).run(...fields.map(k => after[k] as string), before[key] as string | number);
    }
  }
}
function assertMoved(state: State): void {
  const st = statSync(state.destination);
  if (st.ino !== state.inode || st.dev !== state.device) fail("worktree directory identity changed during move");
  if (hash(snapshot(state.destination, state.git_dir)) !== hash(expectedSnapshot(state, true))) fail("worktree content changed during move; checkpoint retained");
  if (readFileSync(join(state.git_dir, "gitdir"), "utf8").trim() !== join(state.destination, ".git")) fail("Git backlink verification failed");
}
function restorePaths(state: State): void {
  if (present(state.source) && lstatSync(state.source).isSymbolicLink()) {
    if (resolve(dirname(state.source), readlinkSync(state.source)) !== state.destination) fail("source alias changed; refusing rollback");
    unlinkSync(state.source);
  }
  if (!present(state.source) && present(state.destination)) git(state.parent, "worktree", "move", "--", state.destination, state.source);
  if (!present(state.source) || present(state.destination)) fail("rollback paths are ambiguous; inspect the retained checkpoint");
  adjustLinks(state, false);
}
function rollback(db: Database, repo: Repo, source: string, destination: string, planHash: string): NormalizeWorktreeResult {
  if (!/^[a-f0-9]{64}$/.test(planHash)) fail("rollback requires an exact normalization plan hash");
  const checkpoint = join(worktreeRootDir(), ".evidence", `normalize-${planHash}`), journalPath = join(checkpoint, "journal.json");
  noSymlinkPath(worktreeRootDir(), checkpoint);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal, state = journal.state;
  if (hash(state) !== planHash || journal.plan_hash !== planHash || state.repo_id !== repo.id || state.source !== source || state.destination !== destination || state.parent !== realpathSync(repo.path)) fail("rollback receipt identity does not match this request");
  if (journal.phase === "rolled-back") return output(state, planHash, checkpoint, false, "rolled-back");
  if (present(destination)) {
    noSymlinkPath(worktreeRootDir(), destination);
    const st = statSync(destination);
    if (st.ino !== state.inode || st.dev !== state.device) fail("rollback destination was replaced");
    // A crash can happen before or after external symlinks are adjusted.
    const current = snapshot(destination, state.git_dir);
    const normalized = { ...current, files: current.files.map(e => {
      const link = state.links.find(l => l.path === e.path);
      if (link && (e.target === link.before || e.target === link.after)) return { ...e, target: link.before };
      return e;
    }) };
    if (hash(normalized) !== hash(state.snapshot)) fail("worktree changed since normalization; retain current work and inspect the checkpoint before rollback");
  } else {
    noSymlinkPath(worktreeRootDir(), source);
    const st = statSync(source);
    if (st.ino !== state.inode || st.dev !== state.device || hash(snapshot(source, state.git_dir)) !== hash(state.snapshot)) fail("source changed since checkpoint; rollback refused");
  }
  db.exec("BEGIN IMMEDIATE");
  try { updateRows(db, state, false); restorePaths(state); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  journal.phase = "rolled-back"; writeJournal(journalPath, journal);
  return output(state, planHash, checkpoint, true, "rolled-back");
}
export function normalizeWorktree(request: NormalizeWorktreeRequest): NormalizeWorktreeResult {
  const db = request.db ?? getDb();
  assertWorktreeName(request.name);
  const repo = registryRepo(db, request.repo), root = worktreeRootDir();
  const source = legacyFlatWorktreePath(repo.name, request.name), destination = computeWorktreePath(worktreeOrgSegment(repo), repo.name, request.name);
  if (request.rollback) {
    if (request.apply || request.expectedPlanHash) fail("rollback cannot be combined with apply or a plan hash");
    return rollback(db, repo, source, destination, request.rollback);
  }
  noSymlinkPath(root, destination);
  if (present(destination)) {
    if (present(source) && (!lstatSync(source).isSymbolicLink() || realpathSync(source) !== destination)) fail("destination is occupied; nothing is overwritten");
    const state = capture(db, repo, destination, destination);
    return output(state, hash(state), null, false, "already-canonical");
  }
  noSymlinkPath(root, source);
  if (!present(source)) fail("no legacy worktree exists for this repository and name");
  const state = capture(db, repo, source, destination), planHash = hash(state);
  if (!request.apply) return output(state, planHash, null, false, "move");
  if (request.expectedPlanHash !== planHash) fail("normalization plan changed or the expected plan hash is missing; run a fresh dry run");
  const checkpoint = join(root, ".evidence", `normalize-${planHash}`);
  noSymlinkPath(root, checkpoint);
  const journalPath = join(checkpoint, "journal.json"), journal: Journal = { plan_hash: planHash, state, phase: "preparing" };
  if (present(checkpoint)) {
    const previous = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    if (previous.phase !== "rolled-back" || hash(previous.state) !== planHash) fail(`checkpoint already exists; inspect it or use --rollback ${planHash} before retrying`);
    // A failed copy may have left a partial checkpoint. Preserve that entire
    // attempt, including its receipt, and make a fresh verified checkpoint.
    let attempt = 1;
    while (present(`${checkpoint}.attempt-${attempt}`)) attempt++;
    renameSync(checkpoint, `${checkpoint}.attempt-${attempt}`);
  }
  mkdirSync(dirname(checkpoint), { recursive: true, mode: 0o700 });
  mkdirSync(checkpoint, { mode: 0o700 });
  writeJournal(journalPath, journal);
  // Copy-on-write where supported; fall back to copying. Never follow symlinks.
  const copyOptions = { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE };
  cpSync(source, join(checkpoint, "files"), copyOptions);
  cpSync(state.git_dir, join(checkpoint, "git-admin"), copyOptions);
  if (hash(inventory(join(checkpoint, "files"))) !== hash(state.snapshot.files)) fail("file checkpoint verification failed; source retained");
  journal.phase = "checkpointed"; writeJournal(journalPath, journal);
  if (hash(capture(db, repo, source, destination)) !== planHash) fail("normalization plan changed while checkpointing; source retained");
  mkdirSync(dirname(destination), { recursive: true });
  noSymlinkPath(root, destination);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hash(capture(db, repo, source, destination)) !== planHash) fail("normalization plan changed before moving");
    journal.phase = "moving"; writeJournal(journalPath, journal);
    git(state.parent, "worktree", "move", "--", source, destination);
    journal.phase = "moved"; writeJournal(journalPath, journal);
    adjustLinks(state, true); assertMoved(state);
    updateRows(db, state, true);
    symlinkSync(destination, source, "dir");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    try { restorePaths(state); journal.phase = "rolled-back"; writeJournal(journalPath, journal); }
    catch { fail(`normalization interrupted; recovery checkpoint: ${checkpoint}; use --rollback ${planHash}`); }
    throw error;
  }
  journal.phase = "complete"; writeJournal(journalPath, journal);
  return output(state, planHash, checkpoint, true, "move");
}
