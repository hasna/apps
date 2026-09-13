import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { getDataDir } from "./config.js";

export type IntegrationAgent = "claude" | "codex";
export type ContextHookEvent = "UserPromptSubmit" | "SessionStart" | "SubagentStart";
export interface AgentRootAlias { agent: IntegrationAgent; home: string; alias: string; target: string; link: string; aliasIdentity: string; targetIdentity: string }
export interface NativeSkillEntry { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; rootAlias?: AgentRootAlias }
export interface AgentConfigChange { path: string; before: string | null; after: string }
export interface AgentIntegrationPlan { dataDir: string; profileId: string; changes: AgentConfigChange[]; nativeSkills: NativeSkillEntry[]; rootAliases?: AgentRootAlias[] }

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const HOOK_EVENTS: readonly ContextHookEvent[] = ["UserPromptSubmit", "SessionStart", "SubagentStart"];
const ROOTS = [
  ["claude", ".claude/skills"], ["codex", ".codex/skills"], ["codex", ".agents/skills"],
  ["gemini", ".gemini/skills"],
  ["codewith", ".codewith/skills"], ["opencode", ".config/opencode/skills"], ["cursor", ".cursor/skills"],
] as const;

function assertSafePath(path: string): void {
  let cursor = resolve(path);
  while (true) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing symlink path: ${cursor}`);
    const parent = dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}

/** Opt-in applies only to the two recognized home roots, never their contents. */
function readRootAlias(home: string, agent: IntegrationAgent): AgentRootAlias {
  assertSafePath(home);
  const realHome = realpathSync(home), alias = join(realHome, `.${agent}`);
  const stat = lstatSync(alias, { throwIfNoEntry: false, bigint: true });
  if (!stat?.isSymbolicLink()) throw new Error(`Agent root alias changed after planning: ${alias}`);
  const link = readlinkSync(alias), targetPath = resolve(dirname(alias), link);
  // Refuse chained or nested aliases even if realpath would hide them.
  assertSafePath(targetPath);
  const targetStat = lstatSync(targetPath, { throwIfNoEntry: false });
  if (!targetStat?.isDirectory()) throw new Error(`Agent root alias must target an existing directory: ${alias}`);
  const target = realpathSync(targetPath), inside = relative(realHome, target);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Agent root alias target must be inside the real home: ${alias}`);
  return { agent, home: realHome, alias, target, link, aliasIdentity: `${stat.dev}:${stat.ino}:${stat.ctimeNs}`, targetIdentity: `${targetStat.dev}:${targetStat.ino}` };
}

function rootAliases(home: string, allowed = false): AgentRootAlias[] {
  if (!allowed) return [];
  const result: AgentRootAlias[] = [];
  for (const agent of ["claude", "codex"] as const) if (lstatSync(join(home, `.${agent}`), { throwIfNoEntry: false })?.isSymbolicLink()) result.push(readRootAlias(home, agent));
  if (result.some((item, index) => result.slice(index + 1).some(other => item.target === other.target || item.target.startsWith(other.target + sep) || other.target.startsWith(item.target + sep)))) throw new Error("Agent root alias targets must not overlap");
  return result;
}

function canonicalAgentPath(path: string, aliases: AgentRootAlias[]): string {
  const absolute = resolve(path), binding = aliases.find(item => absolute === item.alias || absolute.startsWith(item.alias + sep));
  return binding ? join(binding.target, relative(binding.alias, absolute)) : absolute;
}

function recheckRootAliases(aliases: AgentRootAlias[]): void {
  for (const binding of aliases) {
    if (!["claude", "codex"].includes(binding.agent) || binding.alias !== join(binding.home, `.${binding.agent}`)) throw new Error("Invalid agent root alias binding");
    const current = readRootAlias(binding.home, binding.agent);
    if (JSON.stringify(current) !== JSON.stringify(binding)) throw new Error(`Agent root alias changed after planning: ${binding.alias}`);
  }
}

/** Hash every relative filename and byte; refuse links, devices, and oversized migration input. */
function treeHash(root: string): string {
  const hash = createHash("sha256"); let bytes = 0, files = 0;
  function visit(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in skill: ${path}`);
    const rel = relative(root, path);
    if (stat.isDirectory()) { hash.update(`d\0${rel}\0`); for (const name of readdirSync(path).sort()) visit(join(path, name)); return; }
    if (!stat.isFile()) throw new Error(`Unsupported skill file: ${path}`);
    bytes += stat.size; files++;
    if (bytes > 64 * 1024 * 1024 || files > 10000) throw new Error("Native skill exceeds migration size limits");
    hash.update(`f\0${rel}\0${stat.size}\0`); hash.update(readFileSync(path));
  }
  assertSafePath(root); visit(root); return hash.digest("hex");
}

export function inventoryNativeSkills(home = homedir(), options: { includeVendor?: boolean; projectDir?: string; allowRootAliases?: boolean } = {}): NativeSkillEntry[] {
  const aliases = rootAliases(home, options.allowRootAliases);
  const roots: Array<readonly [string, string]> = ROOTS.map(([agent, path]) => [agent, canonicalAgentPath(join(home, path), aliases)]);
  if (options.projectDir) for (const [agent, path] of ROOTS) roots.push([agent, join(resolve(options.projectDir), path)]);
  const entries: NativeSkillEntry[] = [], seen = new Set<string>();
  function visit(agent: string, path: string, vendor = false, depth = 0): void {
    assertSafePath(path);
    if (!existsSync(path)) return;
    if (!lstatSync(path).isDirectory()) return;
    if (existsSync(join(path, "SKILL.md"))) {
      if (seen.has(path)) return; seen.add(path);
      let managed = false;
      const marker = join(path, ".hasna-skills.json");
      if (existsSync(marker)) { try { managed = JSON.parse(readFileSync(marker, "utf8")).managedBy === "@hasna/skills"; } catch { /* Unrecognized markers grant no ownership. */ } }
      const rootAlias = aliases.find(item => path === item.target || path.startsWith(item.target + sep));
      entries.push({ agent, path, hash: treeHash(path), managed, vendor, ...(rootAlias ? { rootAlias } : {}) }); return;
    }
    if (depth > (vendor ? 8 : 3)) return;
    for (const name of readdirSync(path).sort()) {
      if (name === "node_modules") continue;
      if (name.startsWith(".") && name !== ".system") continue;
      const isVendor = vendor || name === ".system";
      if (isVendor && !options.includeVendor) continue;
      visit(agent, join(path, name), isVendor, depth + 1);
    }
  }
  for (const [agent, path] of roots) visit(agent, path);
  if (options.includeVendor) {
    for (const agent of ["codex", "claude"]) visit(agent, canonicalAgentPath(join(home, `.${agent}`, "plugins", "cache"), aliases), true);
  }
  recheckRootAliases(aliases);
  return entries;
}

function readOptional(path: string): string | null {
  assertSafePath(path); return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function jsonObject(text: string | null, path: string): Record<string, any> {
  if (text === null) return {};
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected configuration object: ${path}`);
  return value;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

function configureHooks(config: Record<string, any>, agent: IntegrationAgent, command: string, profileId: string): void {
  config.hooks ??= {};
  if (typeof config.hooks !== "object" || Array.isArray(config.hooks)) throw new Error("Expected hooks configuration object");
  for (const event of HOOK_EVENTS) {
    const existing: unknown = config.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Expected ${event} hooks array`);
    const hookCommand = `${shellQuote(command)} hook user-prompt --agent ${agent} --selection-profile ${profileId}`;
    const retained = existing.flatMap((entry: any) => {
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
      const hooks = entry.hooks.filter((hook: any) => !(hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent (?:claude|codex)(?: --selection-profile [A-Za-z0-9._-]+)?$/.test(hook.command)));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    retained.push({ hooks: [{ type: "command", command: hookCommand, timeout: 15 }] });
    config.hooks[event] = retained;
  }
  if (agent === "claude") {
    config.permissions ??= {};
    if (typeof config.permissions !== "object" || Array.isArray(config.permissions)) throw new Error("Expected permissions configuration object");
    const denied: unknown = config.permissions.deny ?? [];
    if (!Array.isArray(denied)) throw new Error("Expected permission deny array");
    config.permissions.deny = [...new Set([...denied, "Skill"])];
  }
}

function disableCodexSkills(text: string, skills: NativeSkillEntry[], aliases: AgentRootAlias[]): string {
  Bun.TOML.parse(text);
  let result = text;
  for (const skill of skills.filter(entry => entry.agent === "codex")) {
    const path = join(skill.path, "SKILL.md"); let found = false;
    result = result.replace(/^\[\[skills\.config\]\][^\n]*(?:\n(?!\s*\[)[^\n]*)*/gm, section => {
      const parsed = Bun.TOML.parse(section) as { skills?: { config?: Array<{ path?: string }> } };
      const declared = parsed.skills?.config?.[0]?.path;
      if (!declared || ![resolve(path), resolve(skill.path)].includes(canonicalAgentPath(declared, aliases))) return section;
      found = true;
      return /^\s*enabled\s*=/m.test(section) ? section.replace(/^\s*enabled\s*=.*$/m, "enabled = false") : `${section.trimEnd()}\nenabled = false\n`;
    });
    if (!found) result = `${result.trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
  }
  Bun.TOML.parse(result); return result;
}

/** Planning is read-only; credentials and unrelated settings never appear in CLI output. */
export function planAgentIntegration(options: { home?: string; dataDir?: string; agents: IntegrationAgent[]; command?: string; profileId?: string; includeVendor?: boolean; projectDir?: string; allowRootAliases?: boolean }): AgentIntegrationPlan {
  const home = options.home ?? homedir(), dataDir = options.dataDir ?? getDataDir();
  const profileId = options.profileId ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId) || profileId.includes("..")) throw new Error("Invalid selection profile id");
  const aliases = rootAliases(home, options.allowRootAliases);
  const nativeSkills = inventoryNativeSkills(home, { includeVendor: options.includeVendor, projectDir: options.projectDir, allowRootAliases: options.allowRootAliases });
  const changes: AgentConfigChange[] = [];
  for (const agent of [...new Set(options.agents)]) {
    if (agent !== "claude" && agent !== "codex") throw new Error(`Unsupported agent: ${agent}`);
    const path = canonicalAgentPath(join(home, `.${agent}`, agent === "claude" ? "settings.json" : "hooks.json"), aliases);
    const before = readOptional(path), config = jsonObject(before, path);
    configureHooks(config, agent, options.command ?? "skills", profileId);
    const after = `${JSON.stringify(config, null, 2)}\n`;
    if (before !== after) changes.push({ path, before, after });
    if (agent === "codex") {
      const configPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases), previous = readOptional(configPath);
      const next = disableCodexSkills(previous ?? "", nativeSkills, aliases);
      if (next !== (previous ?? "")) changes.push({ path: configPath, before: previous, after: next });
    }
  }
  recheckRootAliases(aliases);
  return { dataDir, profileId, changes, nativeSkills, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

function atomicWrite(path: string, content: string): void {
  assertSafePath(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.skills-${randomUUID()}`;
  try { writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function applyAgentIntegration(plan: AgentIntegrationPlan): { changed: string[]; backups: string[]; rootAliases?: AgentRootAlias[] } {
  const aliases = plan.rootAliases ?? [];
  recheckRootAliases(aliases);
  for (const change of plan.changes) if (readOptional(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
  const backupRoot = join(plan.dataDir, "migration", randomUUID()), backups: string[] = [], written: AgentConfigChange[] = [];
  if (!plan.changes.length) {
    const policyPath = join(plan.dataDir, "agent-policy.json");
    const policy = jsonObject(readOptional(policyPath), policyPath);
    recheckRootAliases(aliases);
    if (policy.loading !== "cli" || policy.profileId !== plan.profileId) atomicWrite(policyPath, JSON.stringify({ version: 1, loading: "cli", profileId: plan.profileId, installedAt: new Date().toISOString() }) + "\n");
    return { changed: [], backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
  }
  assertSafePath(backupRoot); mkdirSync(backupRoot, { recursive: true, mode: 0o700 }); chmodSync(backupRoot, 0o700);
  for (const [index, change] of plan.changes.entries()) if (change.before !== null) {
    const backup = join(backupRoot, `${index}-${sha(change.path).slice(0, 12)}.backup`);
    writeFileSync(backup, change.before, { mode: 0o600, flag: "wx" }); backups.push(backup);
  }
  try {
    for (const change of plan.changes) { recheckRootAliases(aliases); atomicWrite(change.path, change.after); written.push(change); }
    recheckRootAliases(aliases);
    atomicWrite(join(plan.dataDir, "agent-policy.json"), JSON.stringify({ version: 1, loading: "cli", profileId: plan.profileId, installedAt: new Date().toISOString() }) + "\n");
  } catch (error) {
    for (const change of written.reverse()) {
      if (change.before === null) unlinkSync(change.path); else atomicWrite(change.path, change.before);
    }
    throw error;
  }
  atomicWrite(join(backupRoot, "receipt.json"), JSON.stringify({ version: 1, changes: plan.changes.map(change => ({ path: change.path, beforeHash: change.before === null ? null : sha(change.before), afterHash: sha(change.after) })), backups, ...(aliases.length ? { rootAliases: aliases } : {}) }) + "\n");
  return { changed: plan.changes.map(change => change.path), backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

export function archiveNativeSkills(inventory: NativeSkillEntry[], options: { dataDir?: string; includeUnmanaged?: boolean; allowRootAliases?: boolean }): { entries: Array<{ source: string; archive: string; hash: string }>; rootAliases?: AgentRootAlias[] } {
  const aliases = [...new Map(inventory.filter(entry => entry.rootAlias).map(entry => [entry.rootAlias!.alias, entry.rootAlias!])).values()];
  if (aliases.length && !options.allowRootAliases) throw new Error("Native migration requires explicit allowRootAliases for agent root aliases");
  recheckRootAliases(aliases);
  const selected = inventory.filter(entry => !entry.vendor && (entry.managed || options.includeUnmanaged));
  for (const entry of selected) if (treeHash(entry.path) !== entry.hash) throw new Error(`Native skill changed after planning: ${entry.path}`);
  if (!selected.length) return { entries: [], ...(aliases.length ? { rootAliases: aliases } : {}) };
  const archiveRoot = join(options.dataDir ?? getDataDir(), "migration", randomUUID(), "native");
  assertSafePath(archiveRoot); mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const entries: Array<{ source: string; archive: string; hash: string }> = [];
  try {
    for (const [index, entry] of selected.entries()) {
      recheckRootAliases(aliases);
      const archive = join(archiveRoot, `${index}-${sha(entry.path).slice(0, 12)}`);
      renameSync(entry.path, archive); entries.push({ source: entry.path, archive, hash: entry.hash });
    }
    recheckRootAliases(aliases);
    atomicWrite(join(archiveRoot, "receipt.json"), JSON.stringify({ version: 1, entries, ...(aliases.length ? { rootAliases: aliases } : {}) }) + "\n");
  } catch (error) {
    for (const entry of entries.reverse()) renameSync(entry.archive, entry.source);
    throw error;
  }
  return { entries, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

export function hookContextOutput(event: string, result: { context: string; receipt?: unknown; omitted?: Array<{ slug: string; version: string; loadCommand: string }> }): Record<string, unknown> {
  if (!HOOK_EVENTS.includes(event as ContextHookEvent)) throw new Error(`Unsupported context hook event: ${event}`);
  const omitted = result.omitted?.slice(0, 10).map(entry => `Additional selected skill ${entry.slug}@${entry.version}: ${entry.loadCommand}`).join("\n");
  const policy = event === "SessionStart" || event === "SubagentStart"
    ? "Skills loading policy: discover skills with `skills list` or `skills search`, and read selected instructions with `skills load <slug>`. Use `skills sync` to refresh the shared profile. Load skills through this CLI; do not create, copy or load skills from agent-native skill folders. Context loading does not authorize execution; use `skills run` only when the task calls for running a skill."
    : "";
  const context = [policy, result.context, omitted].filter(Boolean).join("\n\n");
  if (!context) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

export function assertNativeExportAllowed(dataDir = getDataDir()): void {
  const path = join(dataDir, "agent-policy.json");
  if (!existsSync(path)) return;
  const policy = jsonObject(readOptional(path), path);
  if (policy.loading === "cli") throw new Error("NATIVE_SKILL_EXPORT_DISABLED: this station loads skills through the Skills CLI; use skills sync --selection-profile <id>");
}
