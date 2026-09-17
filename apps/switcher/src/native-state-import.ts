import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, link, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Fault } from "./domain";
import { assertNativeStateDirectory, ensureNativeStateDirectory, NATIVE_STATE_ENTRIES, type NativeState } from "./native-state";

const MAX_FILES = 100_000, MAX_BYTES = 2 * 1024 * 1024 * 1024;
type Identity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
type File = { path: string; bytes: number; sha256: string; source: Identity; existing: boolean; sessionId?: string };
export type NativeStateImport = { state: NativeState; source: string; entries: string[]; directories: string[]; files: File[]; bytes: number };
const refused = () => new Fault(409, "native_state_import_conflict", "Native state import found changed, unsafe or divergent data. No existing file will be replaced. Keep the original directory and resolve the conflict explicitly.");
async function info(path: string) { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } }
const identity = (s: Identity): Identity => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
const same = (a: Identity, b: Identity) => JSON.stringify(identity(a)) === JSON.stringify(identity(b));
const inside = (parent: string, child: string) => { const path = relative(parent, child);return path !== ".." && !path.startsWith("../") && !isAbsolute(path); };
const SESSION_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

/** Read only the bounded first native metadata row; never rewrite rollouts. */
async function sessionId(path: string, expected?: Identity): Promise<string | undefined> {
  const nameId = basename(path).match(/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\.jsonl$/i)?.[1]?.toLowerCase();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) || expected && !same(before, expected)) throw refused();
    const buffer = Buffer.alloc(Math.min(before.size, 1024 * 1024));let length = 0, newline = -1;
    while (length < buffer.length && newline < 0) { const read = await handle.read(buffer, length, buffer.length - length, null);if (!read.bytesRead) break;length += read.bytesRead;newline = buffer.indexOf(10, 0); }
    const after = await handle.stat(), named = await lstat(path);
    if (!same(before, after) || !same(after, named) || after.nlink !== 1 || named.nlink !== 1 || named.isSymbolicLink()) throw refused();
    if (newline < 0 && before.size > buffer.length) throw refused();
    let row: unknown;try { row = JSON.parse(buffer.subarray(0, newline < 0 ? length : newline).toString("utf8")); } catch { return nameId; }
    if (row && typeof row === "object" && "type" in row && row.type === "session_meta") {
      const value = (row as { payload?: { id?: unknown } }).payload?.id;
      if (typeof value !== "string" || !SESSION_ID.test(value) || nameId && value.toLowerCase() !== nameId) throw refused();
      return value.toLowerCase();
    }
    return nameId;
  } finally { await handle.close(); }
}

async function checkSessionIdentities(plan: NativeStateImport): Promise<void> {
  if (plan.state.tool !== "codex") return;
  const ids = new Map<string, File[]>();
  for (const file of plan.files) {
    if (!/^(sessions|archived_sessions)\//.test(file.path) || !file.path.endsWith(".jsonl")) continue;
    file.sessionId = await sessionId(join(plan.source, file.path), file.source);if (!file.sessionId) continue;
    const previous = ids.get(file.sessionId);
    if (previous?.some(other => other.sha256 !== file.sha256)) throw refused();
    if (previous) { file.existing = true;previous.push(file); } else ids.set(file.sessionId, [file]);
  }
  if (!ids.size) return;
  let seen = 0;
  async function scan(directory: string, depth = 0): Promise<void> {
    if (++seen > MAX_FILES || depth > 32) throw refused();
    if (!await info(directory)) return;
    await assertNativeStateDirectory(directory);
    for await (const entry of await opendir(directory)) {
      if (++seen > MAX_FILES || entry.isSymbolicLink()) throw refused();
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await scan(path, depth + 1);continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const id = await sessionId(path);if (!id || !ids.has(id)) continue;
      const existing = await fingerprint(path), importing = ids.get(id)!;
      if (importing.some(file => file.sha256 !== existing.sha256)) throw refused();
      for (const file of importing) file.existing = true;
    }
  }
  await scan(join(plan.state.home, "sessions"));await scan(join(plan.state.home, "archived_sessions"));
}

async function fingerprint(path: string, copyTo?: string): Promise<{ bytes: number; sha256: string; source: Identity }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) || before.size > MAX_BYTES) throw refused();
    if (copyTo) output = await open(copyTo, "wx", 0o600);
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);let bytes = 0;
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, null);if (!read.bytesRead) break;
      bytes += read.bytesRead;if (bytes > MAX_BYTES) throw refused();
      const chunk = buffer.subarray(0, read.bytesRead);hash.update(chunk);
      if (output) { let offset = 0; while (offset < chunk.length) offset += (await output.write(chunk, offset, chunk.length - offset)).bytesWritten; }
    }
    const after = await handle.stat(), named = await lstat(path);
    if (named.isSymbolicLink() || after.nlink !== 1 || named.nlink !== 1 || bytes !== before.size || !same(before, after) || !same(after, named)) throw refused();
    await output?.sync();
    return { bytes, sha256: hash.digest("hex"), source: identity(before) };
  } finally { await output?.close();await handle.close(); }
}

/** Entire import is checked before writes. Account/auth/config/SQLite files
 * cannot be selected, including through links. This is a snapshot, not cutover. */
export async function planNativeStateImport(state: NativeState, source: string, selection?: string[]): Promise<NativeStateImport> {
  if (!isAbsolute(source) || source.includes("\0")) throw refused();source = resolve(source);
  if (inside(source, state.home) || inside(state.home, source)) throw refused();
  await assertNativeStateDirectory(source);await ensureNativeStateDirectory(state.home, false);
  const allowed = NATIVE_STATE_ENTRIES[state.tool].filter(entry => entry.name !== "thread-writer-locks");
  const entries = selection?.length ? [...new Set(selection)] : allowed.map(entry => entry.name);
  if (entries.some(name => !allowed.some(entry => entry.name === name))) throw refused();
  const plan: NativeStateImport = { state, source, entries, files: [], directories: [], bytes: 0 };
  let seen = 0;
  async function visit(path: string, kind: "file" | "directory"): Promise<void> {
    if (++seen > MAX_FILES || path.split("/").length > 32) throw refused();
    await ensureNativeStateDirectory(dirname(join(source,path)), false);
    await ensureNativeStateDirectory(dirname(join(state.home,path)), false);
    const from = join(source, path), to = join(state.home, path), entry = await info(from), target = await info(to);
    if (!entry) return;
    if (entry.isSymbolicLink() || entry.uid !== process.getuid?.() || (entry.mode & 0o022)
        || (kind === "directory" ? !entry.isDirectory() : !entry.isFile())) throw refused();
    if (kind === "directory") {
      await assertNativeStateDirectory(from);
      if (target) await assertNativeStateDirectory(to);
      plan.directories.push(path);
      const directory = await opendir(from);const children: { name: string; kind: "directory" | "file" }[] = [];
      for await (const child of directory) { if (children.length + seen >= MAX_FILES || child.isSymbolicLink() || !(child.isDirectory() || child.isFile())) throw refused();children.push({ name: child.name, kind: child.isDirectory() ? "directory" : "file" }); }
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) await visit(join(path, child.name), child.kind);
    } else {
      const value = await fingerprint(from);plan.bytes += value.bytes;if (plan.bytes > MAX_BYTES) throw refused();
      if (target && (target.isSymbolicLink() || !target.isFile())) throw refused();
      if (target) { const existing = await fingerprint(to);if (existing.bytes !== value.bytes || existing.sha256 !== value.sha256) throw refused(); }
      plan.files.push({ path, ...value, existing: Boolean(target) });
    }
  }
  for (const name of entries) await visit(name, allowed.find(entry => entry.name === name)!.kind);
  await checkSessionIdentities(plan);
  return plan;
}

export function nativeStateImportSummary(plan: NativeStateImport, applied: boolean) {
  return { mode: applied ? "staged-snapshot" : "dry-run", tool: plan.state.tool, source: plan.source, destination: plan.state.home,
    files: plan.files.length, newFiles: plan.files.filter(file => !file.existing).length, bytes: plan.bytes,
    originalsPreserved: true, cutoverComplete: false, sqliteCopied: false,
    notice: "The original can still receive writes. This copy is not a completed migration. Legacy SQLite/index metadata and login data remain in the original directory; Codex discovery repairs the catalog from copied transcripts." };
}

export async function applyNativeStateImport(plan: NativeStateImport): Promise<void> {
  // Re-plan to detect changes since a displayed dry run, before creating dirs.
  const fresh = await planNativeStateImport(plan.state, plan.source, plan.entries);
  if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw refused();
  await ensureNativeStateDirectory(plan.state.home);
  for (const path of plan.directories) await ensureNativeStateDirectory(join(plan.state.home, path));
  for (const file of plan.files) {
    if (file.existing) continue;
    const target = join(plan.state.home, file.path);
    await assertNativeStateDirectory(dirname(target));
    const temporary = join(dirname(target), `.switcher-import-${crypto.randomUUID()}`);
    try {
      const copied = await fingerprint(join(plan.source, file.path), temporary);
      if (copied.bytes !== file.bytes || copied.sha256 !== file.sha256 || !same(copied.source, file.source)) throw refused();
      // Hardlink publication is atomic and never overwrites a racing writer.
      await link(temporary, target);
    } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
}
