import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseHermesConfig, assertHermesEnvironment } from "./agent-hermes.js";
import type { IntegrationAgent } from "./agent-adapters.js";
import { captureDiscoveryDirectories, verifyDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";
import { discoveryByteBudget, hashRawDiscoveryFile } from "./agent-discovery-bytes.js";
export { captureDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";

export interface DiscoverySource { path: string; sha256: string | null; hashMode?: "bytes"; format?: "json" | "toml" | "yaml"; fields?: string[] }
export interface AgentDiscoveryBinding { agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; method: "automatic" | "reviewed"; builtinNames?: string[] }
export interface ReviewedDiscoveryInputs { version: 1; agents: Array<{ agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; pluginHooks: "reviewed-no-skill-injection" }> }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function parseConfig(text: string, path: string, toml = false): any {
  try {
    const value = toml ? Bun.TOML.parse(text) : JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error(`Invalid native discovery configuration: ${path}`); }
}

function safe(path: string): void {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Expected an absolute native discovery path");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing symlink native discovery input: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
}
function read(path: string, changes?: Map<string, string>): string | null {
  safe(path);
  if (changes?.has(path)) return changes.get(path)!;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error(`Unsupported or oversized native discovery input: ${path}`);
  return readFileSync(path, "utf8");
}
function projected(source: DiscoverySource, changes?: Map<string, string>, budget = discoveryByteBudget()): string | null {
  if (source.hashMode !== undefined) {
    if (source.hashMode !== "bytes") throw new Error("Invalid native discovery hash mode");
    if (source.format !== undefined || source.fields !== undefined) throw new Error("Raw discovery witnesses cannot project configuration fields");
    return hashRawDiscoveryFile(source.path, budget, changes);
  }
  const text = read(source.path, changes);
  if (text === null) return null;
  if (!source.format) return digest(text);
  const object = source.format === "yaml" ? parseHermesConfig(text) : parseConfig(text, source.path, source.format === "toml");
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Expected native discovery configuration object");
  return digest(JSON.stringify(Object.fromEntries((source.fields ?? []).map(field => [field, (object as Record<string, unknown>)[field] ?? null]))));
}
export function verifyAgentDiscovery(binding: AgentDiscoveryBinding): void {
  if (!binding || !Array.isArray(binding.sources) || !Array.isArray(binding.roots) || binding.sources.length > AGENT_POLICY_LIMITS.discoverySources || binding.roots.length > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Invalid native discovery binding");
  if (binding.agent === "hermes" && !binding.directories?.length) throw new Error("Hermes discovery requires directory membership coverage; run skills hook install with a fresh discovery review");
  if (binding.directories !== undefined) verifyDiscoveryDirectories(binding.directories);
  const budget = discoveryByteBudget();
  for (const source of binding.sources) {
    if (source.format !== undefined && (!["json", "toml", "yaml"].includes(source.format) || !Array.isArray(source.fields) || !source.fields.length || source.fields.length > 64 || source.fields.some(field => typeof field !== "string" || !field))) throw new Error("Invalid native discovery projection");
    if (source.sha256 !== null && !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid native discovery digest");
    if (projected(source, undefined, budget) !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
  }
  for (const root of binding.roots) safe(root);
}
export function rebindAgentDiscovery(binding: AgentDiscoveryBinding, changes: Map<string, string>): AgentDiscoveryBinding {
  const budget = discoveryByteBudget();
  return { ...binding, sources: binding.sources.map(source => ({ ...source, sha256: projected(source, changes, budget) })) };
}

/** Capture full byte witnesses for reviewed source or executable files; never import or execute them. */
export function captureDiscoveryByteSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid raw discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => ({ path, hashMode: "bytes", sha256: hashRawDiscoveryFile(path, budget) }));
}

function deniesBridge(rule: unknown): boolean {
  if (typeof rule !== "string") return false;
  if (rule === "Skill") return true;
  const match = rule.match(/^Skill\(([^)]*)\)$/);
  if (!match) return false;
  const pattern = match[1]!.replace(/(?::\*| \*)$/, "");
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test("skills-cli");
}

/** Project settings can introduce a higher-precedence discovery source. Until
 * its native merge format is supported, refuse that layer rather than certify
 * the home-only inventory. Ordinary unrelated project settings remain usable. */
export function assertProjectDiscovery(agent: IntegrationAgent, directories: string[], home: string, canonical: (path: string) => string = resolve): void {
  for (const directory of directories) {
    const isHome = resolve(directory) === resolve(home);
    if (agent === "hermes") { assertHermesEnvironment(home); continue; }
    if (isHome && agent !== "claude") continue;
    const paths = agent === "claude" ? [...(isHome ? [] : [".claude/settings.json"]), ".claude/settings.local.json"]
      : agent === "codex" ? [".codex/config.toml"]
      : agent === "gemini" ? [".gemini/settings.json"]
      : agent === "opencode" ? ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"]
      : [".cursor/hooks.json"];
    for (const suffix of paths) {
      const path = canonical(join(directory, suffix)), raw = read(path); if (raw === null) continue;
      if (suffix.endsWith(".jsonc")) throw new Error(`NATIVE_SKILL_DRIFT: project JSONC discovery configuration requires review: ${path}`);
      const config: any = parseConfig(raw, path, suffix.endsWith(".toml"));
      const keys = agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces", "skillOverrides"]
        : agent === "codex" ? ["plugins", "marketplaces", "skills"]
        : agent === "gemini" ? ["skills", "extensions"]
        : agent === "opencode" ? ["plugin", "skills"] : ["hooks"];
      if (keys.some(key => config[key] !== undefined) || config.disableAllHooks === true || config.disableBundledSkills === false || config.hooksConfig?.enabled === false || config.permission?.skill !== undefined || config.permissions?.deny?.some(deniesBridge)) throw new Error(`NATIVE_SKILL_DRIFT: higher-precedence project skill or hook configuration requires review: ${path}`);
    }
    if (agent === "claude") {
      const commands = canonical(join(directory, ".claude/commands")); safe(commands);
      if (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length) throw new Error("NATIVE_SKILL_DRIFT: legacy project command discovery requires a dedicated format adapter");
    }
  }
}

/** Resolve configured plugin discovery without starting an agent or loading a plugin.
 * Unknown runtime registrations require explicit reviewed inputs, never a cache guess. */
export function resolveAgentDiscovery(options: { home: string; agent: IntegrationAgent; reviewed?: ReviewedDiscoveryInputs; canonical?: (path: string) => string }): AgentDiscoveryBinding {
  const canonical = options.canonical ?? resolve, home = resolve(options.home), agent = options.agent;
  const sources: DiscoverySource[] = [], roots = new Set<string>(), builtinNames: string[] = [];
  const witness = (path: string, format?: "json" | "toml" | "yaml", fields?: string[]) => {
    const source: DiscoverySource = { path: canonical(path), sha256: null, ...(format ? { format, fields } : {}) };
    source.sha256 = projected(source); sources.push(source); return read(source.path);
  };
  if (agent === "hermes") assertHermesEnvironment(home);
  const configPath = join(home, agent === "hermes" ? ".hermes/config.yaml" : agent === "opencode" ? ".config/opencode/opencode.json" : `.${agent}/${agent === "codex" ? "config.toml" : agent === "cursor" ? "hooks.json" : "settings.json"}`);
  const configText = witness(configPath, agent === "hermes" ? "yaml" : agent === "codex" ? "toml" : "json", agent === "hermes" ? ["skills", "plugins", "hooks"] : agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces"] : agent === "codex" ? ["plugins", "marketplaces", "skills"] : agent === "gemini" ? ["skills", "extensions", "security"] : agent === "opencode" ? ["plugin", "skills"] : ["version"]);
  const config: any = configText === null ? {} : agent === "hermes" ? parseHermesConfig(configText) : parseConfig(configText, configPath, agent === "codex");
  const unresolved = (detail: string): never => { throw new Error(`Native discovery is unresolved (${agent}: ${detail}); provide a reviewed --discovery-inputs file`); };
  if (agent === "hermes") {
    const profile = witness(join(home, ".hermes/active_profile"));
    if (profile?.trim() && profile.trim() !== "default") unresolved("a non-default profile is active");
    const declared = config.skills?.external_dirs ?? [], paths = typeof declared === "string" ? [declared] : declared;
    if (!Array.isArray(paths) || paths.length > 128) unresolved("malformed external skill directories");
    for (const value of paths) {
      if (typeof value !== "string" || !value || /[\0$]/.test(value)) unresolved("environment-expanded or malformed external skill root");
      const normalized = value.trim();
      if (!normalized) continue;
      if (normalized.startsWith("~") && normalized !== "~" && !normalized.startsWith("~/")) unresolved("user-specific tilde expansion requires a separate discovery adapter");
      const path = normalized === "~" ? home : normalized.startsWith("~/") ? join(home, normalized.slice(2)) : resolve(home, ".hermes", normalized);
      safe(path); roots.add(path);
    }
  }
  if (agent === "gemini") {
    const executable = Bun.which("gemini");
    if (executable) {
      // Inspect the installed package, never run a client just to discover its
      // bundled skills. A client update changes this source binding.
      let packageRoot: string | undefined;
      for (let directory = dirname(realpathSync(executable)), depth = 0; depth < 8; directory = dirname(directory), depth++) {
        const path = join(directory, "package.json"), raw = read(path);
        if (raw !== null && parseConfig(raw, path).name === "@google/gemini-cli") { packageRoot = directory; witness(path); break; }
        if (dirname(directory) === directory) break;
      }
      if (!packageRoot) unresolved("installed Gemini package layout is not recognized");
      const builtinRoot = join(packageRoot!, "bundle/builtin"); safe(builtinRoot);
      if (!lstatSync(builtinRoot, { throwIfNoEntry: false })?.isDirectory()) unresolved("installed Gemini builtin root is missing");
      for (const name of readdirSync(builtinRoot).sort()) {
        const text = witness(join(builtinRoot, name, "SKILL.md"));
        const match = text?.match(/^---\r?\n[\s\S]*?^name:\s*([a-z0-9][a-z0-9-]*)\s*$/m);
        if (!match?.[1] || builtinNames.includes(match[1])) unresolved("installed Gemini builtin name is missing or ambiguous");
        builtinNames.push(match![1]!);
      }
    }
  }
  if (options.reviewed && (options.reviewed.version !== 1 || !Array.isArray(options.reviewed.agents) || options.reviewed.agents.some(item => !item || typeof item !== "object") || new Set(options.reviewed.agents.map(item => item.agent)).size !== options.reviewed.agents.length)) throw new Error("Invalid --discovery-inputs version or agents");
  const review = options.reviewed?.agents.find(item => item.agent === agent);
  if (review) {
    if (review.pluginHooks !== "reviewed-no-skill-injection" || !Array.isArray(review.sources) || !review.sources.length || !Array.isArray(review.roots)) throw new Error("Discovery review must bind sources and confirm plugin hooks do not inject retired skills");
    const supplied = { agent, roots: review.roots, sources: review.sources, ...(review.directories !== undefined ? { directories: review.directories } : {}), method: "reviewed" as const };
    if (review.sources.some(source => source.format !== undefined || source.fields !== undefined)) throw new Error("Explicit discovery reviews require full source-file hashes");
    verifyAgentDiscovery(supplied);
    if (!review.sources.some(source => source.path === canonical(configPath))) throw new Error("Discovery review must include the agent configuration source");
    return { ...supplied, roots: [...new Set([...roots, ...supplied.roots])].sort(), sources: [...sources, ...review.sources], ...(agent === "gemini" ? { builtinNames } : {}) };
  }

  function plugin(root: string): void {
    root = canonical(root); safe(root);
    const manifestPath = join(root, agent === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json");
    const raw = witness(manifestPath); if (raw === null) unresolved("plugin manifest missing");
    const manifest = parseConfig(raw!, manifestPath);
    const hooks = witness(join(root, "hooks/hooks.json"));
    if (manifest.hooks !== undefined || hooks !== null) unresolved("plugin hooks require a separate no-skill-injection review");
    const commands = join(root, "commands"); safe(commands);
    if (agent === "claude" && (manifest.commands !== undefined || (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length))) unresolved("legacy command discovery requires retirement or a dedicated format adapter");
    const rootSkill = witness(join(root, "SKILL.md"));
    if (rootSkill !== null) roots.add(root);
    const declared = manifest.skills === undefined ? ["./skills"] : typeof manifest.skills === "string" ? [manifest.skills] : manifest.skills;
    if (!Array.isArray(declared) || declared.some(path => typeof path !== "string")) unresolved("unsupported plugin skill paths");
    if (agent === "claude") roots.add(join(root, "skills"));
    for (const value of declared) {
      const path = resolve(root, value);
      if (path !== root && !path.startsWith(root + sep)) unresolved("plugin skill path escapes its root");
      roots.add(path.endsWith(`${sep}SKILL.md`) ? dirname(path) : path);
    }
  }
  if (agent === "claude") {
    const registrations = witness(join(home, ".claude/plugins/installed_plugins.json"));
    const installed = registrations === null ? {} : parseConfig(registrations, join(home, ".claude/plugins/installed_plugins.json")).plugins;
    const commands = canonical(join(home, ".claude/commands")); safe(commands);
    if (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length) unresolved("legacy home command discovery requires a dedicated format adapter");
    for (const [id, enabled] of Object.entries(config.enabledPlugins ?? {})) {
      if (enabled === false) continue;
      if (enabled !== true) unresolved("unsupported plugin enablement");
      const matches = installed?.[id];
      if (!Array.isArray(matches) || !matches.length) unresolved("enabled plugin registration is missing or ambiguous");
      const scopes = new Set<string>();
      for (const match of matches) {
        if (!match || typeof match.installPath !== "string" || !isAbsolute(match.installPath) || !["user", "project", "local"].includes(match.scope)) unresolved("enabled plugin registration has an unsupported scope or path");
        if (match.scope !== "user" && (typeof match.projectPath !== "string" || !isAbsolute(match.projectPath))) unresolved("project plugin registration has no absolute project path");
        const scope = `${match.scope}:${match.scope === "user" ? "" : resolve(match.projectPath)}`;
        if (scopes.has(scope)) unresolved("enabled plugin registration is ambiguous within its scope");
        scopes.add(scope);
        // Bind every registered scope conservatively instead of interpreting
        // two valid scope records as an ambiguous single user installation.
        plugin(match.installPath);
      }
    }
  } else if (agent === "codex") {
    for (const [id, value] of Object.entries(config.plugins ?? {}) as Array<[string, any]>) {
      if (value?.enabled === false) continue;
      if (value?.enabled !== true) unresolved("unsupported plugin enablement");
      const split = id.lastIndexOf("@"), name = id.slice(0, split), marketplace = id.slice(split + 1);
      const market = config.marketplaces?.[marketplace] ?? (marketplace === "personal" ? { source_type: "local", source: home } : undefined);
      if (split < 1 || market?.source_type !== "local" || typeof market.source !== "string" || !isAbsolute(market.source)) unresolved("enabled plugin marketplace is not an explicit local source");
      const catalogText = witness(join(market.source, ".agents/plugins/marketplace.json"));
      if (catalogText === null) unresolved("marketplace catalog missing");
      const catalog = parseConfig(catalogText!, join(market.source, ".agents/plugins/marketplace.json")), matches = Array.isArray(catalog.plugins) ? catalog.plugins.filter((item: any) => item.name === name) : [];
      if (matches.length !== 1 || matches[0]?.source?.source !== "local" || typeof matches[0]?.source?.path !== "string") unresolved("plugin catalog source is missing or ambiguous");
      plugin(resolve(market.source, matches[0].source.path));
    }
  } else if (agent === "opencode") {
    if (witness(join(home, ".config/opencode/opencode.jsonc")) !== null || witness(join(home, ".config/opencode/config.json")) !== null) unresolved("additional config layers require review");
    if ((config.plugin?.length ?? 0) > 0 || config.skills?.urls?.length) unresolved("external plugin or remote skill source");
    for (const path of config.skills?.paths ?? []) { if (typeof path !== "string" || !isAbsolute(path)) unresolved("relative or malformed added skill root"); roots.add(path); }
    const localPlugins = join(home, ".config/opencode/plugins"); safe(localPlugins);
    if (lstatSync(localPlugins, { throwIfNoEntry: false }) && readdirSync(localPlugins).some(name => name !== "skills-cli.js")) unresolved("additional local plugin hooks require review");
  } else if (agent === "hermes") {
    // Python entry points and bundled plugins may register prompt sections or
    // namespaced skills. Do not import them to guess their effective behavior.
    for (const directory of [join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent")]) {
      safe(directory); if (lstatSync(directory, { throwIfNoEntry: false })) unresolved("installed runtime/plugin discovery requires reviewed source bindings");
    }
    if (Bun.which("hermes") || Object.keys(config.plugins ?? {}).length) unresolved("installed runtime/plugin discovery requires reviewed source bindings");
  } else if (agent === "gemini") {
    if (Object.keys(config.extensions ?? {}).length || config.skills?.paths?.length) unresolved("custom extension or skill paths");
    // Extension files under the normal directory are also inventoried. A linked
    // development extension must be reviewed instead of following its symlink.
    const directory = join(home, ".gemini/extensions"); safe(directory);
    if (lstatSync(directory, { throwIfNoEntry: false })) for (const name of readdirSync(directory)) {
      const root = join(directory, name); safe(root);
      if (!lstatSync(root)?.isDirectory()) continue;
      const raw = witness(join(root, "gemini-extension.json"));
      if (raw === null) unresolved("extension registration missing");
      const manifest = parseConfig(raw!, join(root, "gemini-extension.json"));
      if (manifest.hooks !== undefined || witness(join(root, "hooks/hooks.json")) !== null || witness(join(root, ".gemini-extension-install.json")) !== null) unresolved("extension hooks or linked registration require review");
      roots.add(join(root, "skills"));
    }
  }
  return { agent, roots: [...roots].sort(), sources, method: "automatic", ...(agent === "gemini" ? { builtinNames } : {}), ...(agent === "hermes" ? { directories: captureDiscoveryDirectories([join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent")].map(path => canonical(path))) } : {}) };
}
