import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, statSync, mkdirSync, readFileSync, readdirSync, opendirSync, readlinkSync, realpathSync, renameSync, rmdirSync, writeFileSync, unlinkSync, chmodSync, openSync, closeSync, fsyncSync, fstatSync, readSync, constants, linkSync, type Dirent } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { getDataDir, getDataDirReadOnly } from "./config.js";
import { requiresCliSkillLoading, readManagedSkillPolicySnapshot, serializeManagedSkillPolicy, parseManagedSkillPolicy } from "./managed-policy.js";
import { CLI_BRIDGE_NAME, CLI_BRIDGE_FILES, CLI_BRIDGE_DIGEST, CLI_BRIDGE_VERSION, isOwnedCliBridge } from "./agent-bridge.js";
import { assertProjectDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, rebindAgentDiscovery, type AgentDiscoveryBinding, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, renderOpenCodePlugin, type IntegrationAgent } from "./agent-adapters.js";

import { HERMES_OPT_OUT, parseHermesConfig, configureHermesHooks, assertHermesProtection, renderHermesSupervisor, assertNoHermesLegacyShadow, type HermesSupervisorBinding } from "./agent-hermes.js";

export type { IntegrationAgent } from "./agent-adapters.js";
export type ContextHookEvent = "UserPromptSubmit" | "SessionStart" | "SubagentStart";
export interface AgentRootAlias { agent: IntegrationAgent; home: string; alias: string; target: string; link: string; aliasIdentity: string; targetIdentity: string }
export interface NativeSkillEntry { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; system?: boolean; bridge?: boolean; bridgeHome?: string; rootAlias?: AgentRootAlias }
export interface AgentConfigChange { path: string; before: string | null; after: string }
export interface AgentIntegrationPlan { dataDir: string; profileId: string; changes: AgentConfigChange[]; nativeSkills: NativeSkillEntry[]; observedPolicy?: { path: string; before: string | null }; discoveryBefore?: AgentDiscoveryBinding[]; discoveryAfter?: AgentDiscoveryBinding[]; rootAliases?: AgentRootAlias[] }

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const HOOK_EVENTS: readonly ContextHookEvent[] = ["UserPromptSubmit", "SessionStart", "SubagentStart"];
const ROOTS = [
  ["claude", ".claude/skills"], ["codex", ".codex/skills"], ["codex", ".agents/skills"],
  ["gemini", ".gemini/skills"],
  ["codewith", ".codewith/skills"], ["opencode", ".config/opencode/skills"], ["opencode", ".opencode/skills"], ["cursor", ".cursor/skills"],
  ["hermes", ".hermes/skills"], ["windsurf", ".windsurf/skills"], ["pi", ".pi/agent/skills"], ["amp", ".amp/skills"], ["cline", ".cline/skills"], ["roo", ".roo/skills"], ["copilot", ".github/skills"],
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

/** Ownership hashing must not follow a replacement link or block on a FIFO. */
function readNativeBytes(path: string, maximum = 64 * 1024 * 1024): Buffer {
  assertSafePath(path);
  const before = lstatSync(path);
  if (!before.isFile() || before.size > maximum) throw new Error("Unsupported or oversized native skill file");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("Native skill file changed while reading");
    const bytes = Buffer.allocUnsafe(before.size + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Native skill file changed while reading");
    return bytes.subarray(0, length);
  } finally { closeSync(descriptor); }
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
    hash.update(`f\0${rel}\0${stat.size}\0`); hash.update(readNativeBytes(path, stat.size));
  }
  assertSafePath(root); visit(root); return hash.digest("hex");
}

export function inventoryNativeSkills(home = homedir(), options: { includeVendor?: boolean; guardHermes?: boolean; projectDir?: string; projectDirs?: string[]; agentRoots?: Array<{ agent: string; path: string }>; configured?: boolean; discoveryInputs?: ReviewedDiscoveryInputs; allowRootAliases?: boolean } = {}): NativeSkillEntry[] {
  const aliases = rootAliases(home, options.allowRootAliases);
  const roots: Array<readonly [string, string]> = ROOTS.map(([agent, path]) => [agent, canonicalAgentPath(join(home, path), aliases)]);
  const bridgePaths = Object.values(AGENT_ADAPTERS).map(adapter => canonicalAgentPath(join(home, adapter.root, CLI_BRIDGE_NAME), aliases));
  for (const project of new Set([...(options.projectDirs ?? []), ...(options.projectDir ? [options.projectDir] : [])].map(path => resolve(path)))) {
    for (const [agent, path] of ROOTS) roots.push([agent, canonicalAgentPath(join(project, path), aliases)]);
  }
  const entries: NativeSkillEntry[] = [], seen = new Set<string>();
  type Scan = { complete: boolean; hasSkills: boolean; entries: number };
  const cacheScans = new Map<string, Scan>(), maxAliasProofEntries = 10000;
  let discoveryEntries = 0, discoveryPathBytes = 0;
  function admit(path: string): void {
    if (++discoveryEntries > 20000) throw new Error("Native skill discovery entry limit exceeded");
    discoveryPathBytes += Buffer.byteLength(path, "utf8");
    if (discoveryPathBytes > 4 * 1024 * 1024) throw new Error("Native skill discovery metadata limit exceeded");
  }
  function emptySiblingCacheAlias(path: string, parent: string): boolean {
    const link = readlinkSync(path), target = resolve(parent, link);
    // A lexical normalization must not conceal an intermediate symlink escape.
    if (dirname(target) !== parent || (isAbsolute(link) ? link !== target : dirname(link) !== ".")) return false;
    if (!lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) return false;
    const scan = cacheScans.get(target);
    return Boolean(scan?.complete && !scan.hasSkills && scan.entries <= maxAliasProofEntries);
  }
  function visit(agent: string, path: string, vendor = false, depth = 0, pluginCache = false, admitted = false): Scan {
    if (!admitted) admit(path);
    const scan: Scan = { complete: true, hasSkills: false, entries: 1 };
    assertSafePath(path);
    if (!existsSync(path)) return scan;
    const stat = lstatSync(path);
    if (stat.isFile()) return scan;
    if (!stat.isDirectory()) throw new Error(`Unsupported native discovery entry: ${path}`);
    if (existsSync(join(path, "SKILL.md"))) {
      scan.hasSkills = true;
      if (seen.has(path)) return scan; seen.add(path);
      let managed = false;
      const marker = join(path, ".hasna-skills.json");
      if (existsSync(marker)) { try { managed = JSON.parse(readFileSync(marker, "utf8")).managedBy === "@hasna/skills"; } catch { /* Unrecognized markers grant no ownership. */ } }
      const bridge = !vendor && isOwnedCliBridge(path, bridgePaths);
      const rootAlias = aliases.find(item => path === item.target || path.startsWith(item.target + sep));
      entries.push({ agent, path, hash: treeHash(path), managed, vendor, ...(agent === "codex" && path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep) ? { system: true } : {}), ...(bridge ? { bridge: true, bridgeHome: resolve(home) } : {}), ...(rootAlias ? { rootAlias } : {}) }); return scan;
    }
    if (depth > (vendor ? 32 : 3)) return { ...scan, complete: false };
    // Retired vendor documents leave their shared assets in place. Bound the
    // entire discovery walk before retaining or sorting directory entries.
    const children: Dirent[] = [], directory = opendirSync(path);
    try {
      let child: Dirent | null;
      while ((child = directory.readSync()) !== null) { admit(join(path, child.name)); children.push(child); }
    } finally { directory.closeSync(); }
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    // Complete real sibling scans before considering cache aliases, regardless
    // of their names. Never recurse through an alias to discover its contents.
    if (pluginCache) children.sort((a, b) => Number(a.isSymbolicLink()) - Number(b.isSymbolicLink()));
    for (const { name } of children) {
      if (name === "node_modules") continue;
      if (name.startsWith(".") && name !== ".system" && agent !== "hermes" && !(options.guardHermes && `${path}${sep}`.includes(`${sep}.agents${sep}skills${sep}`))) continue;
      const isVendor = vendor || name === ".system";
      if (isVendor && !options.includeVendor) continue;
      const child = join(path, name);
      // Vendor containers can have linked metadata beside their skills. Follow
      // only for target metadata; never read its bytes or descend through the
      // link. Real skills return through treeHash above, which refuses all links.
      if (isVendor && lstatSync(child, { throwIfNoEntry: false })?.isSymbolicLink()) {
        const target = statSync(child, { throwIfNoEntry: false });
        if (target?.isFile() || (pluginCache && target?.isDirectory() && emptySiblingCacheAlias(child, path))) {
          scan.entries++; continue;
        }
      }
      const childScan = visit(agent, child, isVendor, depth + 1, pluginCache, true);
      scan.complete &&= childScan.complete; scan.hasSkills ||= childScan.hasSkills; scan.entries += childScan.entries;
    }
    if (pluginCache) cacheScans.set(path, scan);
    return scan;
  }
  function scanRoot(agent: string, path: string, vendor = false, pluginCache = false): void {
    if (agent === "hermes" || (options.guardHermes && `${path}${sep}`.includes(`${sep}.agents${sep}skills${sep}`))) assertNoHermesLegacyShadow(path);
    if (!visit(agent, path, vendor, 0, pluginCache).complete) throw new Error(`Native skill discovery limit exceeded; review this root before continuing: ${path}`);
  }
  for (const [agent, path] of roots) scanRoot(agent, path);
  if (options.includeVendor) {
    for (const agent of ["codex", "claude"]) scanRoot(agent, canonicalAgentPath(join(home, `.${agent}`, "plugins", "cache"), aliases), true, true);
    scanRoot("gemini", join(home, ".gemini", "extensions"), true);
  }
  const configured = options.configured ? INTEGRATION_AGENTS.flatMap(agent => resolveAgentDiscovery({ home, agent, reviewed: options.discoveryInputs, canonical: path => canonicalAgentPath(path, aliases) }).roots.map(path => ({ agent, path }))) : [];
  for (const root of [...(options.agentRoots ?? []), ...configured]) scanRoot(root.agent, canonicalAgentPath(root.path, aliases), true);
  recheckRootAliases(aliases);
  return entries;
}

function readOptional(path: string): string | null {
  assertSafePath(path); return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function jsonObject(text: string | null, path: string): Record<string, any> {
  if (text === null) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Invalid JSON configuration: ${path}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected configuration object: ${path}`);
  return value;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

function configureHooks(config: Record<string, any>, agent: IntegrationAgent, command: string, profileId: string, nativeReady: boolean): void {
  config.hooks ??= {};
  if (typeof config.hooks !== "object" || Array.isArray(config.hooks)) throw new Error("Expected hooks configuration object");
  for (const event of AGENT_ADAPTERS[agent].events) {
    const existing: unknown = config.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Expected ${event} hooks array`);
    const hookCommand = `${shellQuote(command)} hook user-prompt --agent ${agent} --selection-profile ${profileId} --event ${event}`;
    const retained = existing.flatMap((entry: any) => {
      if (agent === "cursor") {
        if (!entry || typeof entry.command !== "string") throw new Error(`Malformed ${event} hook entry`);
        return /(?:^|\s)hook user-prompt --agent cursor(?:\s|$)/.test(entry.command) ? [] : [entry];
      }
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
      const hooks = entry.hooks.filter((hook: any) => !(hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent (?:claude|codex|gemini)(?: --selection-profile [A-Za-z0-9._-]+)?(?: --event [A-Za-z]+)?$/.test(hook.command)));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    retained.push(agent === "cursor" ? { command: hookCommand, timeout: 15 } : { hooks: [{ type: "command", command: hookCommand, timeout: agent === "gemini" ? 15000 : 15 }] });
    config.hooks[event] = retained;
  }
  if (agent === "claude") {
    config.permissions ??= {};
    if (typeof config.permissions !== "object" || Array.isArray(config.permissions)) throw new Error("Expected permissions configuration object");
    const denied: unknown = config.permissions.deny ?? [];
    if (!Array.isArray(denied)) throw new Error("Expected permission deny array");
    const allowed: unknown = config.permissions.allow ?? [];
    if (!Array.isArray(allowed)) throw new Error("Expected permission allow array");
    config.permissions.deny = nativeReady ? denied.filter(rule => rule !== "Skill") : [...new Set([...denied, "Skill"])];
    config.permissions.allow = nativeReady ? [...new Set([...allowed, `Skill(${CLI_BRIDGE_NAME})`])] : allowed;
    config.disableBundledSkills = true;
  }
  if (agent === "gemini") {
    config.skills ??= {};
    if (!config.skills || typeof config.skills !== "object" || Array.isArray(config.skills)) throw new Error("Expected skills configuration object");
    const disabled = config.skills.disabled ?? [];
    if (!Array.isArray(disabled) || disabled.some(value => typeof value !== "string")) throw new Error("Expected disabled skills array");
    config.skills.enabled = true;
    config.skills.disabled = [...new Set([...disabled.filter(name => name !== CLI_BRIDGE_NAME), "antigravity-support", "skill-creator"])];
    if (config.hooksConfig?.enabled === false) throw new Error("Gemini hooks are disabled; enable them before installing the Skills bridge");
  }
  if (agent === "cursor") config.version = 1;
  if (agent === "claude" || agent === "gemini") {
    const event = agent === "claude" ? "PreToolUse" : "BeforeTool", matcher = agent === "claude" ? "Skill" : "activate_skill";
    const existing = config.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Expected ${event} hooks array`);
    const retained = existing.flatMap((entry: any) => {
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
      const hooks = entry.hooks.filter((hook: any) => !(hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent (?:claude|gemini) --selection-profile [A-Za-z0-9._-]+ --event (?:PreToolUse|BeforeTool)$/.test(hook.command)));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    config.hooks[event] = [...retained, { matcher, hooks: [{ type: "command", command: `${shellQuote(command)} hook user-prompt --agent ${agent} --selection-profile ${profileId} --event ${event}`, timeout: agent === "gemini" ? 15000 : 15 }] }];
  }
}

function disableCodexSkills(text: string, skills: NativeSkillEntry[], aliases: AgentRootAlias[], bridgePath: string): string {
  Bun.TOML.parse(text);
  let result = text;
  const selections = [...skills.filter(entry => entry.agent === "codex" && !entry.bridge).map(skill => ({ path: skill.path, enabled: false })), { path: bridgePath, enabled: true }];
  for (const skill of selections) {
    const path = join(skill.path, "SKILL.md"); let found = false;
    result = result.replace(/^\[\[skills\.config\]\][^\n]*(?:\n(?!\s*\[)[^\n]*)*/gm, section => {
      const parsed = Bun.TOML.parse(section) as { skills?: { config?: Array<{ path?: string }> } };
      const declared = parsed.skills?.config?.[0]?.path;
      if (!declared || ![resolve(path), resolve(skill.path)].includes(canonicalAgentPath(declared, aliases))) return section;
      found = true;
      return /^\s*enabled\s*=/m.test(section) ? section.replace(/^\s*enabled\s*=.*$/m, `enabled = ${skill.enabled}`) : `${section.trimEnd()}\nenabled = ${skill.enabled}\n`;
    });
    if (!found && !skill.enabled) result = `${result.trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
  }
  Bun.TOML.parse(result); return result;
}

/** Planning is read-only; credentials and unrelated settings never appear in CLI output. */
export function planAgentIntegration(options: { home?: string; dataDir?: string; agents: IntegrationAgent[]; command?: string; profileId?: string; includeVendor?: boolean; projectDir?: string; discoveryInputs?: ReviewedDiscoveryInputs; allowRootAliases?: boolean }): AgentIntegrationPlan {
  const home = options.home ?? homedir(), dataDir = options.dataDir ?? getDataDirReadOnly();
  const profileId = options.profileId ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId) || profileId.includes("..")) throw new Error("Invalid selection profile id");
  const aliases = rootAliases(home, options.allowRootAliases);
  const policyPath = join(dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const priorSnapshot = readManagedSkillPolicySnapshot(dataDir), previousPolicy = priorSnapshot?.text ?? null, policy = priorSnapshot?.value ?? {};
  if (policy.bridge !== undefined && (!policy.bridge || typeof policy.bridge !== "object" || Array.isArray(policy.bridge))) throw new Error("Invalid existing Skills bridge policy");
  if (policy.bridge?.agents !== undefined && (!Array.isArray(policy.bridge.agents) || policy.bridge.agents.some((agent: unknown) => !INTEGRATION_AGENTS.includes(agent as IntegrationAgent)))) throw new Error("Invalid existing bridge agent inventory");
  for (const field of ["commands", "profiles"]) if (policy.bridge?.[field] !== undefined && (!policy.bridge[field] || typeof policy.bridge[field] !== "object" || Array.isArray(policy.bridge[field]) || Object.entries(policy.bridge[field]).some(([key, value]) => !INTEGRATION_AGENTS.includes(key as IntegrationAgent) || typeof value !== "string" || !value || value.includes("\0")))) throw new Error(`Invalid existing bridge ${field} binding`);
  const discoveries = [...new Set(options.agents)].map(agent => resolveAgentDiscovery({ home, agent, reviewed: options.discoveryInputs, canonical: path => canonicalAgentPath(path, aliases) }));
  const nativeSkills = inventoryNativeSkills(home, { includeVendor: true, guardHermes: options.agents.includes("hermes"), projectDir: options.projectDir, agentRoots: discoveries.flatMap(binding => binding.roots.map(path => ({ agent: binding.agent, path }))), allowRootAliases: options.allowRootAliases });
  const changes: AgentConfigChange[] = [];
  for (const agent of [...new Set(options.agents)]) {
    if (!INTEGRATION_AGENTS.includes(agent)) throw new Error(`Unsupported agent: ${agent}`);
    const adapter = AGENT_ADAPTERS[agent];
    const bridgePath = canonicalAgentPath(join(home, adapter.root, CLI_BRIDGE_NAME), aliases);
    assertSafePath(bridgePath);
    if (existsSync(bridgePath) && !isOwnedCliBridge(bridgePath, [bridgePath])) throw new Error(`Refusing to overwrite an unrecognized or modified Skills bridge: ${bridgePath}`);
    for (const [name, after] of Object.entries(CLI_BRIDGE_FILES)) {
      const path = join(bridgePath, name), before = readOptional(path);
      if (before !== after) changes.push({ path, before, after });
    }
    const path = canonicalAgentPath(join(home, adapter.config), aliases);
    const before = readOptional(path);
    if (agent === "hermes") {
      const supervisorPath = join(dataDir, "agent-hooks", "hermes.js"), supervisorBefore = readOptional(supervisorPath), supervisorAfter = renderHermesSupervisor(options.command ?? "skills", profileId);
      const priorCommand = policy.bridge?.commands?.hermes, priorProfile = policy.bridge?.profiles?.hermes ?? policy.profileId;
      const previous = policy.bridge?.supervisors?.hermes as HermesSupervisorBinding | undefined;
      if (supervisorBefore !== null && supervisorBefore !== supervisorAfter && !(previous?.path === supervisorPath && typeof priorCommand === "string" && typeof priorProfile === "string" && supervisorBefore === renderHermesSupervisor(priorCommand, priorProfile))) throw new Error("Refusing to overwrite an unrecognized Hermes supervisor");
      if (supervisorBefore !== supervisorAfter) changes.push({ path: supervisorPath, before: supervisorBefore, after: supervisorAfter });
      const supervisor = { path: supervisorPath, runtime: process.execPath, sha256: sha(supervisorAfter) };
      const after = configureHermesHooks(before, supervisor, previous);
      if (before !== after) changes.push({ path, before, after });
      const optOut = join(home, ".hermes", HERMES_OPT_OUT), optOutBefore = readOptional(optOut);
      if (optOutBefore === null) changes.push({ path: optOut, before: null, after: "Managed by @hasna/skills: bundled native skill reseeding is disabled.\n" });
      continue;
    }
    const config = jsonObject(before, path);
    if (agent === "opencode") {
      const permission = config.permission ?? {};
      if (!permission || typeof permission !== "object" || Array.isArray(permission)) throw new Error("Expected OpenCode permission object");
      config.permission = { ...permission, skill: { "*": "deny", [CLI_BRIDGE_NAME]: "allow" } };
      const pluginPath = join(home, ".config", "opencode", "plugins", "skills-cli.js"), pluginBefore = readOptional(pluginPath);
      const pluginAfter = renderOpenCodePlugin(options.command ?? "skills", profileId);
      const priorCommand = policy.bridge?.commands?.opencode;
      const ownedPrevious = typeof priorCommand === "string" && typeof policy.profileId === "string" && pluginBefore === renderOpenCodePlugin(priorCommand, policy.bridge?.profiles?.opencode ?? policy.profileId);
      if (pluginBefore !== null && pluginBefore !== pluginAfter && !ownedPrevious) throw new Error("Refusing to overwrite a modified OpenCode Skills plugin; preserve and review it first");
      if (pluginBefore !== pluginAfter) changes.push({ path: pluginPath, before: pluginBefore, after: pluginAfter });
    } else configureHooks(config, agent, options.command ?? "skills", profileId, !nativeSkills.some(entry => entry.agent === agent && !entry.bridge));
    if (agent === "gemini") config.skills.disabled = [...new Set([...config.skills.disabled, ...(discoveries.find(binding => binding.agent === agent)?.builtinNames ?? [])])];
    const after = `${JSON.stringify(config, null, 2)}\n`;
    if (before !== after) changes.push({ path, before, after });
    if (agent === "codex") {
      const configPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases), previous = readOptional(configPath);
      const next = disableCodexSkills(previous ?? "", nativeSkills, aliases, bridgePath);
      if (next !== (previous ?? "")) changes.push({ path: configPath, before: previous, after: next });
    }
  }
  const discoveryAfter = discoveries.map(binding => rebindAgentDiscovery(binding, new Map(changes.map(change => [change.path, change.after]))));
  const priorAgents = Array.isArray(policy.bridge?.agents) ? policy.bridge.agents : [];
  const nextPolicy = { ...policy, version: 1, loading: "cli", profileId, bridge: {
    ...policy.bridge,
    version: CLI_BRIDGE_VERSION, digest: CLI_BRIDGE_DIGEST,
    agents: [...new Set([...priorAgents, ...options.agents])].sort(),
    home: resolve(home), includeVendor: true,
    ...(options.agents.includes("hermes") ? { supervisors: { ...policy.bridge?.supervisors, hermes: { path: join(dataDir, "agent-hooks", "hermes.js"), runtime: process.execPath, sha256: sha(renderHermesSupervisor(options.command ?? "skills", profileId)) } } } : {}),
    commands: { ...policy.bridge?.commands, ...Object.fromEntries(options.agents.map(agent => [agent, options.command ?? "skills"])) },
    profiles: Object.fromEntries([...new Set<IntegrationAgent>([...priorAgents, ...options.agents])].sort().map(agent => [agent, options.agents.includes(agent) ? profileId : policy.bridge?.profiles?.[agent] ?? policy.profileId])),
    disabledBuiltins: options.agents.includes("codex") ? nativeSkills.filter(entry => entry.agent === "codex" && entry.vendor && entry.path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep)).map(entry => ({ path: entry.path, hash: entry.hash })) : (policy.bridge?.disabledBuiltins ?? []),
    rootAliases: aliases,
    discovery: { ...policy.bridge?.discovery, ...Object.fromEntries(discoveryAfter.map(binding => [binding.agent, binding])) },
  } };
  const serializedPolicy = serializeManagedSkillPolicy(nextPolicy);
  if (JSON.stringify(policy) !== JSON.stringify(nextPolicy)) changes.push({ path: policyPath, before: previousPolicy, after: serializedPolicy });
  recheckRootAliases(aliases);
  return { dataDir, profileId, changes, nativeSkills, observedPolicy: { path: policyPath, before: previousPolicy }, discoveryBefore: discoveries, discoveryAfter, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

function atomicWrite(path: string, content: string): void {
  assertSafePath(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.skills-${randomUUID()}`;
  try { writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function applyAgentIntegration(plan: AgentIntegrationPlan): { changed: string[]; backups: string[]; rootAliases?: AgentRootAlias[] } {
  // Refuse an unusable policy before creating backups or changing native config.
  const policyPath = join(plan.dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const currentText = (path: string) => resolve(path) === resolve(policyPath) ? readManagedSkillPolicySnapshot(plan.dataDir)?.text ?? null : readOptional(path);
  readManagedSkillPolicySnapshot(plan.dataDir);
  for (const change of plan.changes) if (resolve(change.path) === resolve(policyPath)) parseManagedSkillPolicy(change.after);
  const aliases = plan.rootAliases ?? [];
  recheckRootAliases(aliases);
  for (const binding of plan.discoveryBefore ?? []) verifyAgentDiscovery(binding);
  if (plan.observedPolicy && currentText(plan.observedPolicy.path) !== plan.observedPolicy.before) throw new Error("Agent policy changed after planning");
  for (const change of plan.changes) if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
  const backupRoot = join(plan.dataDir, "migration", randomUUID()), backups: string[] = [], written: AgentConfigChange[] = [], createdDirectories = new Set<string>();
  if (!plan.changes.length) {
    recheckRootAliases(aliases);
    return { changed: [], backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
  }
  assertSafePath(backupRoot); mkdirSync(backupRoot, { recursive: true, mode: 0o700 }); chmodSync(backupRoot, 0o700);
  for (const [index, change] of plan.changes.entries()) if (change.before !== null) {
    const backup = join(backupRoot, `${index}-${sha(change.path).slice(0, 12)}.backup`);
    writeFileSync(backup, change.before, { mode: 0o600, flag: "wx" }); backups.push(backup);
  }
  try {
    for (const change of plan.changes) {
      recheckRootAliases(aliases);
      if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
      for (let directory = dirname(change.path); !existsSync(directory); directory = dirname(directory)) createdDirectories.add(directory);
      const after = change.after;
      atomicWrite(change.path, after); written.push({ path: change.path, before: change.before, after });
    }
    recheckRootAliases(aliases);
    for (const binding of plan.discoveryAfter ?? []) verifyAgentDiscovery(binding);
    atomicWrite(join(backupRoot, "receipt.json"), JSON.stringify({ version: 1, changes: written.map(change => ({ path: change.path, beforeHash: change.before === null ? null : sha(change.before), afterHash: sha(change.after) })), backups, ...(aliases.length ? { rootAliases: aliases } : {}) }) + "\n");
  } catch (error) {
    for (const change of written.reverse()) {
      // Do not erase a concurrent user's edit during compensation.
      // An unreadable or malformed replacement also belongs to that user;
      // preserve it while continuing to restore our other unchanged writes.
      let current: string | null;
      try { current = currentText(change.path); } catch { continue; }
      if (current !== change.after) continue;
      if (change.before === null) unlinkSync(change.path); else atomicWrite(change.path, change.before);
    }
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { rmdirSync(directory); } catch (cleanupError) {
        if (!["ENOENT", "ENOTEMPTY"].includes((cleanupError as NodeJS.ErrnoException).code ?? "")) throw cleanupError;
      }
    }
    throw error;
  }
  return { changed: plan.changes.map(change => change.path), backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

function syncArchiveDirectory(path: string): void {
  assertSafePath(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** Persist the journal file and its containing directory before proceeding. */
function writeArchiveJournal(path: string, value: unknown): void {
  assertSafePath(path);
  const temporary = `${path}.skills-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path); syncArchiveDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

export function archiveNativeSkills(inventory: NativeSkillEntry[], options: { dataDir?: string; includeUnmanaged?: boolean; includeVendor?: boolean; allowRootAliases?: boolean }): { entries: Array<{ source: string; archive: string; hash: string; discoveryOnly?: boolean }>; receiptPath?: string; rootAliases?: AgentRootAlias[] } {
  const aliases = [...new Map(inventory.filter(entry => entry.rootAlias).map(entry => [entry.rootAlias!.alias, entry.rootAlias!])).values()];
  if (aliases.length && !options.allowRootAliases) throw new Error("Native migration requires explicit allowRootAliases for agent root aliases");
  recheckRootAliases(aliases);
  // Recompute ownership before exempting it: a stale plan or a forged bridge
  // flag must not protect subsequently modified native instructions.
  for (const entry of inventory.filter(entry => entry.bridge)) {
    const adapter = AGENT_ADAPTERS[entry.agent as IntegrationAgent];
    const expected = adapter && entry.bridgeHome ? canonicalAgentPath(join(entry.bridgeHome, adapter.root, CLI_BRIDGE_NAME), aliases) : undefined;
    if (!expected || treeHash(entry.path) !== entry.hash || !isOwnedCliBridge(entry.path, [expected])) throw new Error(`Skills bridge changed after planning: ${entry.path}`);
  }
  const selected = inventory.filter(entry => !entry.bridge && !entry.system && (entry.vendor ? options.includeVendor : entry.managed || options.includeUnmanaged));
  for (const entry of selected) if (treeHash(entry.path) !== entry.hash) throw new Error(`Native skill changed after planning: ${entry.path}`);
  if (!selected.length) return { entries: [], ...(aliases.length ? { rootAliases: aliases } : {}) };
  const operationId = randomUUID(), archiveRoot = join(options.dataDir ?? getDataDir(), "migration", operationId, "native"), receiptPath = join(archiveRoot, "receipt.json");
  type Move = { source: string; archive: string; hash: string; discoveryOnly?: boolean; status: "planned" | "moving" | "archived" | "restored" | "recovery-required"; conflict?: string };
  const entries: Move[] = selected.map((entry, index) => ({
    source: entry.vendor ? join(entry.path, "SKILL.md") : entry.path,
    archive: join(archiveRoot, `${index}-${sha(entry.path).slice(0, 12)}`),
    hash: entry.vendor ? sha(readNativeBytes(join(entry.path, "SKILL.md"))) : entry.hash,
    ...(entry.vendor ? { discoveryOnly: true } : {}), status: "planned",
  }));
  const journal = { version: 2, operationId, status: "planned", entries, ...(aliases.length ? { rootAliases: aliases } : {}) };
  const moved: Move[] = [];
  const verifyArchive = (entry: Move): void => {
    assertSafePath(entry.archive);
    const stat = lstatSync(entry.archive);
    if (entry.discoveryOnly ? !stat.isFile() : !stat.isDirectory()) throw new Error("Archive type changed");
    if ((entry.discoveryOnly ? sha(readNativeBytes(entry.archive)) : treeHash(entry.archive)) !== entry.hash) throw new Error("Archive bytes changed");
  };
  assertSafePath(archiveRoot);
  const created: string[] = [];
  for (let path = archiveRoot; !existsSync(path); path = dirname(path)) created.push(path);
  mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  try {
    for (const directory of created) syncArchiveDirectory(directory);
    if (created.length) syncArchiveDirectory(dirname(created.at(-1)!));
    writeArchiveJournal(receiptPath, journal);
    for (const [index, entry] of selected.entries()) {
      recheckRootAliases(aliases);
      if (treeHash(entry.path) !== entry.hash) throw new Error("Native skill changed after planning");
      const move = entries[index]!;
      journal.status = "archiving"; move.status = "moving"; writeArchiveJournal(receiptPath, journal);
      // Vendor discovery documents move alone; shared scripts/assets remain.
      renameSync(move.source, move.archive); moved.push(move);
      syncArchiveDirectory(dirname(move.source)); syncArchiveDirectory(archiveRoot);
      verifyArchive(move); move.status = "archived"; writeArchiveJournal(receiptPath, journal);
    }
    recheckRootAliases(aliases);
    for (const entry of moved) verifyArchive(entry);
    journal.status = "completed"; writeArchiveJournal(receiptPath, journal);
  } catch (error) {
    journal.status = "compensating";
    try { writeArchiveJournal(receiptPath, journal); } catch { /* The durable intent still names every source and archive. */ }
    for (const entry of [...moved].reverse()) {
      try {
        recheckRootAliases(aliases); assertSafePath(entry.source); assertSafePath(entry.archive);
        if (lstatSync(entry.source, { throwIfNoEntry: false })) { entry.status = "recovery-required"; entry.conflict = "source-occupied"; continue; }
        try { verifyArchive(entry); } catch { entry.status = "recovery-required"; entry.conflict = "archive-unverified"; continue; }
        if (entry.discoveryOnly) {
          // A hard link refuses EEXIST atomically, so a concurrent document wins.
          linkSync(entry.archive, entry.source); syncArchiveDirectory(dirname(entry.source)); unlinkSync(entry.archive);
        } else {
          // Portable directory rename has no no-replace option. Recheck directly
          // before it; callers must keep native writers quiescent during recovery.
          if (lstatSync(entry.source, { throwIfNoEntry: false })) { entry.status = "recovery-required"; entry.conflict = "source-occupied"; continue; }
          renameSync(entry.archive, entry.source);
        }
        entry.status = "restored";
        syncArchiveDirectory(dirname(entry.source)); syncArchiveDirectory(archiveRoot);
      } catch { entry.status = "recovery-required"; entry.conflict = "compensation-io"; }
      finally { try { writeArchiveJournal(receiptPath, journal); } catch { /* Preserve other recoverable entries even if journaling fails. */ } }
    }
    journal.status = "failed";
    try { writeArchiveJournal(receiptPath, journal); } catch { /* Inspect the last durable intent before retrying. */ }
    throw new Error(`Native archive failed; inspect the recovery journal at ${receiptPath} before retrying.`, { cause: error });
  }
  return { entries: entries.map(({ status, conflict, ...entry }) => entry), receiptPath, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

/** Run before any prompt context load. Missing ownership or reappearing native
 * discovery files require repair; verified cache availability is not an override. */
export function assertManagedAgentBridge(agent: IntegrationAgent, options: { home?: string; dataDir?: string; projectDir?: string; projectDirs?: string[] } = {}): void {
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  assertSafePath(join(dataDir, "agent-policy.json"));
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot) throw new Error("NATIVE_SKILL_DRIFT: install the Skills bridge with skills hook install");
  const binding = snapshot.value.bridge;
  if (!binding || binding.version !== CLI_BRIDGE_VERSION || binding.digest !== CLI_BRIDGE_DIGEST || binding.home !== home || !Array.isArray(binding.agents) || !binding.agents.includes(agent)) throw new Error("NATIVE_SKILL_DRIFT: the managed Skills bridge binding is missing or incompatible; run skills hook install");
  const aliases: AgentRootAlias[] = binding.rootAliases ?? [];
  if (!Array.isArray(aliases)) throw new Error("NATIVE_SKILL_DRIFT: invalid root alias binding");
  recheckRootAliases(aliases);
  const expected = canonicalAgentPath(join(home, AGENT_ADAPTERS[agent].root, CLI_BRIDGE_NAME), aliases);
  if (!isOwnedCliBridge(expected, [expected])) throw new Error("NATIVE_SKILL_DRIFT: the native Skills bridge is missing or modified; repair it before continuing");
  const roots = new Set<string>();
  for (const project of [options.projectDir ?? process.cwd(), ...(options.projectDirs ?? [])]) {
    for (let path = resolve(project), depth = 0; ; depth++) {
      if (depth >= 100) throw new Error("NATIVE_SKILL_DRIFT: project ancestor discovery limit exceeded");
      roots.add(path); const parent = dirname(path); if (parent === path) break; path = parent;
    }
  }
  const visible = (entry: NativeSkillEntry) => entry.agent === agent || (["codex", "gemini", "opencode", "hermes"].includes(agent) && entry.path.includes(`${sep}.agents${sep}skills${sep}`)) || (agent === "opencode" && entry.agent === "claude");
  assertProjectDiscovery(agent, [...roots], home, path => canonicalAgentPath(path, aliases));
  const configPath = canonicalAgentPath(join(home, AGENT_ADAPTERS[agent].config), aliases), config = agent === "hermes" ? parseHermesConfig(readOptional(configPath)) : jsonObject(readOptional(configPath), configPath);
  const command = binding.commands?.[agent], profile = binding.profiles?.[agent];
  if (typeof command !== "string" || typeof profile !== "string") throw new Error("NATIVE_SKILL_DRIFT: the native hook command/profile binding is missing");
  if (agent === "hermes") {
    const supervisor = binding.supervisors?.hermes;
    if (supervisor?.path !== join(dataDir, "agent-hooks", "hermes.js") || supervisor?.sha256 !== sha(renderHermesSupervisor(command, profile))) throw new Error("NATIVE_SKILL_DRIFT: Hermes supervisor binding changed; run skills hook install");
    assertHermesProtection(home, config, command, profile, supervisor);
  } else if (agent === "opencode") {
    if (JSON.stringify(config.permission?.skill) !== JSON.stringify({ "*": "deny", [CLI_BRIDGE_NAME]: "allow" }) || readOptional(join(home, ".config", "opencode", "plugins", "skills-cli.js")) !== renderOpenCodePlugin(command, profile)) throw new Error("NATIVE_SKILL_DRIFT: OpenCode bridge protection changed; run skills hook install");
  } else {
    const required: Record<string, any> = {}; configureHooks(required, agent, command, profile, true);
    for (const [event, entries] of Object.entries(required.hooks) as Array<[string, any[]]>) for (const entry of entries) {
      if (!Array.isArray(config.hooks?.[event]) || config.hooks[event].filter((actual: unknown) => JSON.stringify(actual) === JSON.stringify(entry)).length !== 1) throw new Error("NATIVE_SKILL_DRIFT: required native prompt/skill hooks changed; run skills hook install");
    }
    if (agent === "claude" && (config.disableBundledSkills !== true || config.disableAllHooks === true || !config.permissions?.allow?.includes(`Skill(${CLI_BRIDGE_NAME})`) || config.permissions?.deny?.includes("Skill"))) throw new Error("NATIVE_SKILL_DRIFT: Claude bridge or bundled-skill protection changed; retire copies and run skills hook install");
    if (agent === "gemini" && (config.hooksConfig?.enabled === false || config.skills?.enabled !== true || !["antigravity-support", "skill-creator"].every(name => config.skills?.disabled?.includes(name)) || config.skills?.disabled?.includes(CLI_BRIDGE_NAME))) throw new Error("NATIVE_SKILL_DRIFT: Gemini bridge or bundled-skill protection changed; run skills hook install");
  }
  const codexPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases);
  const codexConfig = agent === "codex" ? Bun.TOML.parse(readOptional(codexPath) ?? "") as { skills?: { config?: Array<{ path?: string; enabled?: boolean }> } } : {};
  const setting = (path: string) => (codexConfig.skills?.config ?? []).filter(entry => typeof entry.path === "string" && [path, join(path, "SKILL.md")].includes(canonicalAgentPath(entry.path, aliases)));
  if (agent === "codex" && setting(expected).some(entry => entry.enabled === false)) throw new Error("NATIVE_SKILL_DRIFT: the Codex CLI bridge is disabled; run skills hook install");
  const disabledBuiltin = (entry: NativeSkillEntry): boolean => {
    if (agent !== "codex" || !entry.vendor || !entry.path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep)) return false;
    const matched = Array.isArray(binding.disabledBuiltins) && binding.disabledBuiltins.some((item: any) => item.path === entry.path && item.hash === entry.hash);
    const settings = setting(entry.path);
    return matched && settings.length === 1 && settings[0]?.enabled === false;
  };
  const discovery: AgentDiscoveryBinding | undefined = binding.discovery?.[agent];
  if (!discovery || discovery.agent !== agent) throw new Error("NATIVE_SKILL_DRIFT: native discovery coverage is missing; run skills hook install");
  if (agent === "gemini" && !discovery.builtinNames?.every(name => config.skills.disabled.includes(name))) throw new Error("NATIVE_SKILL_DRIFT: an installed Gemini builtin is not disabled");
  try {
    verifyAgentDiscovery(discovery);
    if (discovery.method === "automatic") {
      const current = resolveAgentDiscovery({ home, agent, canonical: path => canonicalAgentPath(path, aliases) });
      if (JSON.stringify(current) !== JSON.stringify(discovery)) throw new Error("Configured native discovery roots changed");
    }
  } catch (error) { throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message}`); }
  const inventory = inventoryNativeSkills(home, { includeVendor: true, guardHermes: agent === "hermes", projectDirs: [...roots], agentRoots: discovery.roots.map(path => ({ agent, path })), allowRootAliases: aliases.length > 0 });
  if (inventory.some(entry => visible(entry) && !entry.bridge && !disabledBuiltin(entry))) throw new Error("NATIVE_SKILL_DRIFT: unexpected native skill copies were found; review skills migrate native --include-unmanaged --include-vendor before continuing");
  recheckRootAliases(aliases);
}

const SKILLS_LOADING_POLICY = "Skills loading policy: discover skills with `skills list` or `skills search`, and read selected instructions with `skills load <slug>`. Use `skills sync` to refresh the shared profile. The only native skill is the owned skills-cli bridge. Create and edit payload skills in the Skills authoring workspace; do not copy payload instructions into native discovery folders. Context loading does not authorize execution; use `skills run` only when the task calls for running a skill.";

export function normalizeAgentHookPrompt(agent: IntegrationAgent, event: string, prompt: string): string {
  // Gemini prepends SessionStart context to BeforeAgent.prompt. Exclude only
  // our exact leading policy from selection; arbitrary hook/user text survives.
  if (agent !== "gemini" || event !== "BeforeAgent") return prompt;
  const prefix = `<hook_context>${SKILLS_LOADING_POLICY}`;
  if (!prompt.startsWith(prefix)) return prompt;
  const remainder = prompt.slice(prefix.length);
  const closing = "</hook_context>\n\n";
  if (remainder.startsWith(closing)) return remainder.slice(closing.length);
  if (remainder.startsWith("\n\n") && remainder.includes(closing)) return `<hook_context>${remainder.slice(2)}`;
  return prompt;
}

export function hookContextOutput(event: string, result: { context: string; receipt?: unknown; omitted?: Array<{ slug: string; version: string; loadCommand: string }> }): Record<string, unknown> {
  if (!HOOK_EVENTS.includes(event as ContextHookEvent)) throw new Error(`Unsupported context hook event: ${event}`);
  const omitted = result.omitted?.slice(0, 10).map(entry => `Additional selected skill ${entry.slug}@${entry.version}: ${entry.loadCommand}`).join("\n");
  const policy = event === "SessionStart" || event === "SubagentStart"
    ? SKILLS_LOADING_POLICY
    : "";
  const context = [policy, result.context, omitted].filter(Boolean).join("\n\n");
  if (!context) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

export function assertNativeExportAllowed(dataDir = getDataDirReadOnly()): void {
  if (requiresCliSkillLoading(dataDir)) throw new Error("NATIVE_SKILL_EXPORT_DISABLED: this station loads skills through the Skills CLI; use skills sync --selection-profile <id>");
}
