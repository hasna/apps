import { lstat, mkdir, open, opendir, readlink, realpath, rmdir, symlink, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Fault } from "./domain";

export type SharedNativeTool = "codex" | "claude";
export type NativeState = { tool: SharedNativeTool; home: string; sqliteHome?: string; marker: string; instructions?: Record<string, unknown> };
export function nativeStateRequested(tool: SharedNativeTool, environment: NodeJS.ProcessEnv = process.env, explicit = false): boolean {
  const suffix = tool.toUpperCase();
  return explicit || environment[`HASNA_${suffix}_STATE_HOME`] !== undefined || environment[`SUBSCRIPTIONS_SHARED_HOME_${suffix}`] !== undefined;
}
export function validateNativeStateVersion(tool: SharedNativeTool, version: string | undefined): void {
  if (tool !== "codex") return;
  const match=version?.match(/(\d+)\.(\d+)\.(\d+)/),actual=match?.slice(1).map(Number);
  if (!actual || actual[0]!==0 || actual[1]<154)
    throw new Fault(422,"native_state_version","Shared Codex state requires Codex 0.154.0 or newer, whose metadata and resume protocol has been acceptance-tested by Switcher.");
}
export const CODEX_INSTRUCTION_KEYS = ["instructions", "developer_instructions", "model_instructions_file", "compact_prompt",
  "include_permissions_instructions", "include_apps_instructions", "include_collaboration_mode_instructions", "include_environment_context",
  "project_doc_max_bytes", "project_doc_fallback_filenames"] as const;
type Entry = { name: string; kind: "directory" | "file" };
// Authentication, provider configuration, Electron cookies, plugin caches and
// SQLite is shared through sqlite_home, never individual database/WAL links.
// session_index.jsonl is replace-on-write and remains overlay-local; legacy
// index-only names require explicit migration and cannot simply be discarded.
export const NATIVE_STATE_ENTRIES: Record<SharedNativeTool, readonly Entry[]> = {
  codex: [
    ...["sessions", "archived_sessions", "thread-writer-locks", ".hasna/instructions"].map(name => ({ name, kind: "directory" as const })),
    ...["history.jsonl", "AGENTS.md", "AGENTS.override.md"].map(name => ({ name, kind: "file" as const })),
  ],
  claude: [
    ...["projects", "todos", ".hasna/instructions"].map(name => ({ name, kind: "directory" as const })),
    ...["history.jsonl", "CLAUDE.md"].map(name => ({ name, kind: "file" as const })),
  ],
};

async function info(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
function absolute(value: string): string {
  if (!isAbsolute(value) || value.includes("\0"))
    throw new Fault(422, "native_state_path", "The shared native state directory must be an absolute path.");
  return resolve(value);
}
function credentialOverlay(path: string): boolean {
  return /(?:^|\/)subscriptions\/profiles\//.test(path)
    || /(?:^|\/)switcher\/state\/(?:desktop|desktop-claude|launch-[^/]+)\//.test(path);
}
async function assertSafeAncestors(path: string): Promise<void> {
  for (let parent = path;; parent = dirname(parent)) {
    const ancestor = await lstat(parent);
    // A root-owned sticky temp ancestor protects this user's child directory
    // from replacement by other users. Other writable ancestors are unsafe.
    const stickyRoot = ancestor.uid === 0 && (ancestor.mode & 0o1000) !== 0;
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink() || ![0, process.getuid?.()].includes(ancestor.uid)
        || (ancestor.mode & 0o022) !== 0 && !stickyRoot)
      throw new Fault(422, "native_state_permissions", "Shared native state has an unsafe ancestor directory.");
    if (parent === dirname(parent)) break;
  }
}
export async function assertNativeStateDirectory(path: string): Promise<void> {
  const entry = await info(path);
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()
      || entry.uid !== process.getuid?.() || (entry.mode & 0o022) !== 0
      || await realpath(path) !== path)
    throw new Fault(422, "native_state_permissions", "Shared native state must be an owned directory without writable or symbolic-link redirection.");
  await assertSafeAncestors(dirname(path));
}
export async function ensureNativeStateDirectory(path: string, create = true): Promise<void> {
  if (await info(path)) return assertNativeStateDirectory(path);
  // Validate before creating anything through a redirected parent.
  await ensureNativeStateDirectory(dirname(path), create);
  if (!create) return;
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  await assertNativeStateDirectory(path);
}
export async function withNativeStateLock<T>(state: NativeState, operation: () => Promise<T>): Promise<T> {
  await ensureNativeStateDirectory(state.home);
  const path=join(state.home,".switcher-shared-state.lock");
  let handle:Awaited<ReturnType<typeof open>>;
  try { handle=await open(path,"wx",0o600); }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code!=="EEXIST") throw error;
    const entry=await info(path);
    if (!entry?.isFile()||entry.isSymbolicLink()||entry.uid!==process.getuid?.()||(entry.mode&0o077)!==0)
      throw new Fault(422,"native_state_lock","The shared-state lock has unsafe ownership, permissions or type.");
    throw new Fault(409,"native_state_busy","Another Switcher projection/import owns this corpus, or a prior operation ended before releasing its lock. Inspect native processes and the lock before retrying.");
  }
  const identity=await handle.stat();
  try { return await operation(); }
  finally {
    await handle.close();
    try { const entry=await lstat(path);if(entry.dev===identity.dev&&entry.ino===identity.ino)await unlink(path); } catch(error) { if ((error as NodeJS.ErrnoException).code!=="ENOENT") throw error; }
  }
}

async function assertShareableTree(path:string,budget={entries:0},depth=0):Promise<void>{
  if(depth>32)throw new Fault(422,"native_state_inventory_limit","The shared native corpus exceeds the safe projection inventory limit.");
  if(depth===0)await assertNativeStateDirectory(path);
  for await(const child of await opendir(path)){
    if(++budget.entries>100_000||child.isSymbolicLink())throw new Fault(422,"native_state_entry","A shared native state tree contains an unsupported link or exceeds the safe inventory limit.");
    const nested=join(path,child.name),entry=await lstat(nested);
    if(entry.uid!==process.getuid?.()||(entry.mode&0o022)!==0)throw new Fault(422,"native_state_entry","A shared native state entry has unsafe ownership or writable permissions.");
    if(child.isDirectory()){if(!entry.isDirectory())throw new Fault(422,"native_state_entry","A shared native state directory changed during inspection.");await assertShareableTree(nested,budget,depth+1);continue;}
    if(!child.isFile()||!entry.isFile()||entry.nlink!==1)throw new Fault(422,"native_state_entry","A shared native state tree contains an unsupported file type or hardlink.");
  }
}
async function readCodexStateConfig(home: string): Promise<Record<string, unknown>> {
  const path = join(home, "config.toml"), entry = await info(path);
  if (!entry) return {};
  if (!entry.isFile() || entry.nlink !== 1 || entry.isSymbolicLink() || entry.uid !== process.getuid?.()
      || (entry.mode & 0o022) !== 0 || entry.size > 1024 * 1024)
    throw new Fault(422, "native_state_config", "The Codex instruction configuration cannot be read safely.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let config: Record<string, unknown>;
  try {
    const opened = await handle.stat();
    if (opened.ino !== entry.ino || opened.dev !== entry.dev || opened.nlink !== 1 || opened.size > 1024 * 1024)
      throw new Fault(409, "native_state_config", "The Codex instruction configuration changed during preparation.");
    config = Bun.TOML.parse(await handle.readFile("utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault(422, "native_state_config", "The Codex instruction configuration is invalid.");
  } finally { await handle.close(); }
  if (config.profile !== undefined || config.include !== undefined)
    throw new Fault(422, "native_state_config", "Codex profile/include selection is unsupported by the verified shared-state instruction contract. Resolve that effective configuration before launching; Switcher will not silently discard its instructions.");
  return config;
}

async function codexInstructionProjection(home: string, config: Record<string, unknown>, allowedExternalModelFile?: string): Promise<Record<string, unknown>> {
  const instructions: Record<string, unknown> = {};
  for (const key of CODEX_INSTRUCTION_KEYS) {
    const value = config[key]; if (value === undefined) continue;
    const valid = key.startsWith("include_") ? typeof value === "boolean"
      : key === "project_doc_max_bytes" ? typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      : key === "project_doc_fallback_filenames" ? Array.isArray(value) && value.every(item => typeof item === "string" && !item.includes("\0"))
      : typeof value === "string" && !value.includes("\0");
    if (!valid) throw new Fault(422, "native_state_instructions", "Codex instruction configuration has an unsupported value.");
    if (key === "model_instructions_file") {
      const path = resolve(home, value as string), entry = await info(path);
      const relativePath=relative(home,path),contained=relativePath!==".."&&!relativePath.startsWith("../")&&!isAbsolute(relativePath);
      if ((!contained && path!==allowedExternalModelFile) || !entry || !entry.isFile() || entry.nlink !== 1 || entry.isSymbolicLink() || ![0, process.getuid?.()].includes(entry.uid)
          || (entry.mode & 0o022) !== 0 || await realpath(path) !== path)
        throw new Fault(422, "native_state_instructions", "The model instruction file is not a readable trusted file.");
      await assertSafeAncestors(dirname(path));
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new Fault(422, "native_state_instructions", "The model instruction file is not readable."); });
      try { const opened = await handle.stat(); if (opened.ino !== entry.ino || opened.dev !== entry.dev || opened.nlink !== 1) throw new Fault(409, "native_state_instructions", "The model instruction file changed during preparation."); }
      finally { await handle.close(); }
      instructions[key] = path;
    } else instructions[key] = value;
  }
  return instructions;
}

/** A nested CLI keeps its authentication home. Refuse conflicting instruction
 * overlays rather than rewriting account config or exposing instructions in argv. */
export async function assertNativeInstructionOverlay(state: NativeState, overlayHome: string): Promise<void> {
  if (state.tool !== "codex" || absolute(overlayHome) === state.home) return;
  await assertNativeStateDirectory(overlayHome);
  const config = await readCodexStateConfig(overlayHome);
  if (config.profiles !== undefined || config.include !== undefined)
    throw new Fault(422, "native_state_instruction_overlay", "Private Codex profile/include instruction overlays are not supported. Resolve their effective canonical instructions before launching.");
  const expected = state.instructions ?? {};
  const actual = await codexInstructionProjection(overlayHome, config, typeof expected.model_instructions_file === "string" ? expected.model_instructions_file : undefined);
  if (CODEX_INSTRUCTION_KEYS.some(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key])))
    throw new Fault(409, "native_state_instruction_overlay", "This Codex authentication home has missing or conflicting canonical instructions. Refresh its instruction projection before launching; Switcher will not rewrite private account configuration.");
}

/** This marker identifies the corpus, never the selected authentication home. */
export async function resolveNativeState(tool: SharedNativeTool, environment: NodeJS.ProcessEnv = process.env, options: { create?: boolean } = {}): Promise<NativeState> {
  if(process.platform==="win32")throw new Fault(422,"unsupported_platform","Shared native state currently requires POSIX ownership, no-follow and symlink semantics on Linux or macOS.");
  const suffix = tool.toUpperCase();
  const marker = `HASNA_${suffix}_STATE_HOME`, legacyMarker = `SUBSCRIPTIONS_SHARED_HOME_${suffix}`;
  const primary = environment[marker], legacy = environment[legacyMarker];
  if (primary !== undefined && legacy !== undefined && absolute(primary) !== absolute(legacy))
    throw new Fault(409, "native_state_identity_conflict", `The ${marker} and ${legacyMarker} corpus identities disagree. Select one exact shared native state directory before launching.`);
  // A launch must opt in before this resolver is called. Once opted in, the
  // default identity is the native user corpus, never an ambient account home.
  // Custom canonical homes must be named explicitly by one of the markers.
  const userHome = absolute(environment.HOME ?? homedir());
  const selected = primary !== undefined ? absolute(primary) : legacy !== undefined ? absolute(legacy) : join(userHome, `.${tool}`);
  if (credentialOverlay(selected))
    throw new Fault(422, "native_state_overlay", "An authentication profile cannot be the shared native state directory. Select its original native state directory.");
  await ensureNativeStateDirectory(selected, options.create !== false);
  if (tool === "claude") return { tool, home: selected, marker };
  const config = await readCodexStateConfig(selected);
  let sqliteHome = selected;
  if (config.sqlite_home !== undefined) {
    if (typeof config.sqlite_home !== "string") throw new Fault(422, "native_state_config", "Codex sqlite_home must be an absolute directory.");
    sqliteHome = absolute(config.sqlite_home);
    if (credentialOverlay(sqliteHome)) throw new Fault(422, "native_state_overlay", "Codex SQLite state cannot belong to an authentication profile.");
    await ensureNativeStateDirectory(sqliteHome, options.create !== false);
  }
  const instructions = await codexInstructionProjection(selected, config);
  return { tool, home: selected, sqliteHome, marker, instructions };
}

export function nativeStateEnvironment(state: NativeState): Record<string, string> {
  // The corpus marker is Switcher input/consent, not native child state. Do not
  // propagate it into provider processes or nested launchers. Codex receives
  // only its native SQLite location; Claude uses the projected overlay paths.
  return state.tool === "codex" && state.sqliteHome ? { CODEX_SQLITE_HOME: state.sqliteHome } : {};
}

/** A transcript projection cannot reconcile SQLite-only history or metadata. */
async function assertCodexDatabaseRedirectSafe(state: NativeState, overlayHome: string): Promise<void> {
  if (state.tool !== "codex") return;
  const config = await readCodexStateConfig(overlayHome);
  const previous = config.sqlite_home;
  if (previous !== undefined && typeof previous !== "string")
    throw new Fault(422, "native_state_config", "The previous Codex sqlite_home must be an absolute directory.");
  const roots = new Set([overlayHome, ...(typeof previous === "string" ? [absolute(previous)] : [])]);
  for (const root of roots) {
    if (root === (state.sqliteHome ?? state.home) || !await info(root)) continue;
    await assertNativeStateDirectory(root);
    const before = await lstat(root);
    let inspected = 0;
    for await (const entry of await opendir(root)) {
      if (++inspected > 10_000)
        throw new Fault(409, "native_state_inventory_limit", "Native database inventory exceeded its bounded limit; no state was projected.");
      if (/^(?:state|logs|goals|memories|queue|thread_history)_\d+\.sqlite(?:-(?:wal|shm))?$/.test(entry.name))
        throw new Fault(409, "native_state_migration_required", "This profile retains native database metadata. Reconcile its catalog and history before redirecting shared state.");
    }
    const after = await lstat(root);
    if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs)
      throw new Fault(409, "native_state_inventory_changed", "Native database inventory changed; no state was projected.");
  }
}
async function directoryHasEntries(path:string):Promise<boolean>{const directory=await opendir(path);try{return Boolean(await directory.read());}finally{await directory.close();}}

/** Metadata only. Old data remains visible as pending migration; normal launch
 * never treats starting a fresh shared overlay as completed legacy migration. */
export async function legacyNativeStateWarnings(root: string, state: NativeState): Promise<string[]> {
  const directory = join(root, state.tool === "codex" ? "desktop" : "desktop-claude");
  if (!await info(directory)) return [];
  await assertNativeStateDirectory(directory);
  const pending: string[] = [];
  let inspected = 0;
  for await (const entry of await opendir(directory)) {
    if (++inspected > 1000) throw new Fault(409, "native_state_inventory_limit", "Too many legacy desktop profiles to inspect safely.");
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const home = join(directory, entry.name, ...(state.tool === "codex" ? ["codex"] : []));
    if (!await info(home)) continue;
    await assertNativeStateDirectory(home);
    for (const name of [...NATIVE_STATE_ENTRIES[state.tool].map(item => item.name), ...(state.tool === "codex" ? ["state_5.sqlite", "session_index.jsonl"] : [])]) {
      const path = join(home, name), item = await info(path);
      if (!item || item.isSymbolicLink()) continue;
      if (item.isFile() && item.size > 0 || item.isDirectory() && await directoryHasEntries(path)) { pending.push(home);break; }
    }
  }
  const display = (path: string) => { const value = JSON.stringify(path).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4,"0")}`); return value.length > 768 ? `${value.slice(0,384)}...${value.slice(-381)}` : value; };
  const warnings = pending.slice(0,10).map(home => `Legacy native state is preserved at ${display(home)}; migration is pending. Inspect with switcher state import ${state.tool} --from ${display(home)}. A copied snapshot does not retire the original or migrate its SQLite/index metadata.`);
  if (pending.length > warnings.length) warnings.push(`${pending.length-warnings.length} additional legacy ${state.tool} state directories are pending migration; inspect the Switcher state root before launch.`);
  return warnings;
}

async function createTrackedDirectory(path:string,created:string[]):Promise<void>{
  try {await mkdir(path,{mode:0o700});created.push(path);}
  catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;await assertNativeStateDirectory(path);}
}

/** Link only the native noncredential corpus. Existing data is never replaced. */
async function projectNativeStateUnlocked(state: NativeState, overlayHome: string): Promise<void> {
  overlayHome = absolute(overlayHome);
  await assertNativeStateDirectory(state.home);
  await assertNativeStateDirectory(overlayHome);
  if (overlayHome === state.home) return;
  const contains = (parent: string, child: string) => { const suffix = relative(parent, child); return suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix); };
  if (contains(state.home, overlayHome) || contains(overlayHome, state.home))
    throw new Fault(422, "native_state_overlap", "The shared corpus and authentication overlay must be separate directories.");
  await assertCodexDatabaseRedirectSafe(state, overlayHome);
  // Preflight all collisions before creating any links or canonical entries.
  for (const entry of NATIVE_STATE_ENTRIES[state.tool]) {
    const target = join(state.home, entry.name), destination = join(overlayHome, entry.name);
    await ensureNativeStateDirectory(dirname(target), false);
    await ensureNativeStateDirectory(dirname(destination), false);
    const source = await info(target), existing = await info(destination);
    if (source && (source.isSymbolicLink() || source.uid !== process.getuid?.() || (source.mode & 0o022) !== 0
        || source.isFile() && source.nlink !== 1
        || (entry.kind === "directory" ? !source.isDirectory() : !source.isFile())))
      throw new Fault(422, "native_state_entry", "A shared native state entry has an unsupported type, owner or permissions.");
    if(source?.isDirectory())await assertShareableTree(target);
    if (existing && (!existing.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== target))
      throw new Fault(409, "native_state_migration_required", "This launch profile already contains native state. Preserve and migrate its noncredential state before linking the shared corpus.");
  }
  const createdLinks: Array<{ destination: string; target: string }> = [];
  const createdFiles: string[] = [], createdDirectories: string[] = [];
  try {
    for (const entry of NATIVE_STATE_ENTRIES[state.tool]) {
      const target = join(state.home, entry.name), destination = join(overlayHome, entry.name);
      const targetParent = dirname(target), destinationParent = dirname(destination);
      if (!await info(targetParent)) await createTrackedDirectory(targetParent,createdDirectories);else await assertNativeStateDirectory(targetParent);
      if (!await info(destinationParent)) await createTrackedDirectory(destinationParent,createdDirectories);else await assertNativeStateDirectory(destinationParent);
      // Missing optional files stay absent. A later launch links them only after
      // the canonical path exists and passes the regular-file checks.
      if (entry.kind === "file" && !await info(target)) continue;
      if (!await info(target)) {
        if (entry.kind === "directory") await createTrackedDirectory(target,createdDirectories);
        else { const file = await open(target, "wx", 0o600); await file.close(); createdFiles.push(target); }
      }
      if (!await info(destination)) { await symlink(target, destination, entry.kind === "directory" ? "dir" : "file"); createdLinks.push({ destination, target }); }
    }
  } catch (error) {
    for (const item of createdLinks.reverse()) {
      try { if ((await info(item.destination))?.isSymbolicLink() && resolve(dirname(item.destination), await readlink(item.destination)) === item.target) await unlink(item.destination); } catch { /* Preserve the original refusal. */ }
    }
    for (const path of createdFiles.reverse()) {
      try { const entry = await info(path); if (entry?.isFile() && entry.nlink === 1 && entry.size === 0) await unlink(path); } catch { /* Preserve the original refusal. */ }
    }
    for (const path of [...new Set(createdDirectories)].sort((a,b)=>b.length-a.length)) {
      try { await rmdir(path); } catch { /* Keep nonempty or concurrently used directories. */ }
    }
    throw error;
  }
}

export async function projectNativeState(state: NativeState, overlayHome: string): Promise<void> {
  if (absolute(overlayHome) === state.home) return;
  return withNativeStateLock(state,()=>projectNativeStateUnlocked(state,overlayHome));
}
