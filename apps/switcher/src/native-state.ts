import { lstat, mkdir, open, opendir, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Fault } from "./domain";

export type SharedNativeTool = "codex" | "claude";
export type NativeState = { tool: SharedNativeTool; home: string; sqliteHome?: string; marker: string; instructions?: Record<string, unknown> };
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
    ...["sessions", "archived_sessions", "thread-writer-locks", "skills", "memories", "rules", "prompts", "agents", ".hasna/instructions"].map(name => ({ name, kind: "directory" as const })),
    ...["history.jsonl", "AGENTS.md", "AGENTS.override.md"].map(name => ({ name, kind: "file" as const })),
  ],
  claude: [
    ...["projects", "todos", "skills", "commands", "agents", "rules", ".hasna/instructions"].map(name => ({ name, kind: "directory" as const })),
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
export function nativeDesktopStateId(state: NativeState): string {
  return `shared-${state.tool}-${createHash("sha256").update(state.home).digest("hex").slice(0, 24)}`;
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
  if (config.profile !== undefined)
    throw new Fault(422, "native_state_config", "Codex legacy profile selection is unsupported by the verified native configuration contract. Resolve that configuration before launching; Switcher will not silently discard its instructions.");
  return config;
}

async function codexInstructionProjection(home: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
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
      if (!entry || !entry.isFile() || entry.nlink !== 1 || entry.isSymbolicLink() || ![0, process.getuid?.()].includes(entry.uid)
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
  const actual = await codexInstructionProjection(overlayHome, config);
  const expected = state.instructions ?? {};
  if (CODEX_INSTRUCTION_KEYS.some(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key])))
    throw new Fault(409, "native_state_instruction_overlay", "This Codex authentication home has missing or conflicting canonical instructions. Refresh its instruction projection before launching; Switcher will not rewrite private account configuration.");
}

/** This marker identifies the corpus, never the selected authentication home. */
export async function resolveNativeState(tool: SharedNativeTool, environment: NodeJS.ProcessEnv = process.env, options: { create?: boolean } = {}): Promise<NativeState> {
  const suffix = tool.toUpperCase();
  const marker = `HASNA_${suffix}_STATE_HOME`;
  const explicit = environment[marker] ?? environment[`SUBSCRIPTIONS_SHARED_HOME_${suffix}`];
  const native = environment[tool === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"];
  const userHome = absolute(environment.HOME ?? homedir());
  const selected = explicit !== undefined ? absolute(explicit)
    : native && !credentialOverlay(absolute(native)) ? absolute(native) : join(userHome, `.${tool}`);
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
  return { [state.marker]: state.home, ...(state.sqliteHome ? { CODEX_SQLITE_HOME: state.sqliteHome } : {}) };
}

/** A new credential-only home must not hide an unreconciled previous corpus or
 * private config. This is a read-only admission check, never a migration. */
export async function assertCodexCanonicalLaunch(state: NativeState, previousHome = state.home): Promise<void> {
  const canonical = await readCodexStateConfig(state.home);
  if (["auth_home", "profile", "profiles", "include"].some(key => canonical[key] !== undefined))
    throw new Fault(422, "native_state_config", "Resolve canonical Codex auth/profile/include configuration before using the verified invocation.");
  previousHome = absolute(previousHome);
  if (previousHome === state.home) return;
  await assertNativeInstructionOverlay(state, previousHome);
  await assertNativeStateProjection(state, previousHome);
  const local = await readCodexStateConfig(previousHome);
  // Provider/model routing is explicitly owned by Switcher. Other private
  // configuration cannot vanish when CODEX_HOME becomes canonical.
  const routing = new Set(["model", "model_provider", "model_providers", "model_catalog_json", "review_model", "model_reasoning_effort", "cli_auth_credentials_store", "forced_login_method"]);
  for (const [key, value] of Object.entries(local)) {
    if (routing.has(key) || (CODEX_INSTRUCTION_KEYS as readonly string[]).includes(key)) continue;
    if (key === "sqlite_home" && value === state.sqliteHome) continue;
    if (!isDeepStrictEqual(value, canonical[key]))
      throw new Fault(409, "native_state_migration_required", "Private Codex configuration has not been reconciled with the canonical corpus. Existing files were preserved.");
  }
  const names = await readdir(previousHome);
  if (names.some(name => name === "session_index.jsonl" || /credential|secret|keyring|mcp|settings/i.test(name)))
    throw new Fault(409, "native_state_migration_required", "Private native names or capability settings require reconciliation before changing the credential boundary.");
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
    if (entry.name.startsWith("shared-")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const home = join(directory, entry.name, ...(state.tool === "codex" ? ["codex"] : []));
    if (!await info(home)) continue;
    await assertNativeStateDirectory(home);
    for (const name of [...NATIVE_STATE_ENTRIES[state.tool].map(item => item.name), ...(state.tool === "codex" ? ["state_5.sqlite", "session_index.jsonl"] : [])]) {
      const path = join(home, name), item = await info(path);
      if (!item || item.isSymbolicLink()) continue;
      if (item.isFile() && item.size > 0 || item.isDirectory() && (await readdir(path)).length > 0) { pending.push(home);break; }
    }
  }
  return pending.map(home => `Legacy native state is preserved at ${home}; migration is pending. Inspect with switcher state import ${state.tool} --from ${JSON.stringify(home)}. A copied snapshot does not retire the original or migrate its SQLite/index metadata.`);
}

/** Read-only collision admission, shared by legacy projection and canonical launches. */
async function assertNativeStateProjection(state: NativeState, overlayHome: string): Promise<void> {
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
    if (existing && (!existing.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== target))
      throw new Fault(409, "native_state_migration_required", "This launch profile already contains native state. Preserve and migrate its noncredential state before linking the shared corpus.");
  }
}

/** Link only the native noncredential corpus. Existing data is never replaced. */
export async function projectNativeState(state: NativeState, overlayHome: string): Promise<void> {
  overlayHome = absolute(overlayHome);
  await assertNativeStateProjection(state, overlayHome);
  if (overlayHome === state.home) return;
  for (const entry of NATIVE_STATE_ENTRIES[state.tool]) {
    const target = join(state.home, entry.name), destination = join(overlayHome, entry.name);
    await ensureNativeStateDirectory(dirname(target));
    await ensureNativeStateDirectory(dirname(destination));
    // A dangling optional link keeps the canonical file absent, but allows a
    // later user-created instruction file to become visible without copying it.
    if (entry.kind === "file" && !entry.name.endsWith(".jsonl") && !await info(target)) {
      if (!await info(destination)) await symlink(target, destination, "file");
      continue;
    }
    if (!await info(target)) {
      if (entry.kind === "directory") await mkdir(target, { mode: 0o700 });
      else { const file = await open(target, "wx", 0o600); await file.close(); }
    }
    if (!await info(destination)) await symlink(target, destination, entry.kind === "directory" ? "dir" : "file");
  }
}
