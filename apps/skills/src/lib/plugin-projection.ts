/** Generic software contract. Original packages and prompt mappings belong in private Skills bundles. */
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { SkillBundleEntry } from "./skill-bundle.js";
import type { SkillSelection } from "../types/skill-selection.js";
import { SkillEntryPaths } from "./skill-entry-path.js";
import { SkillSelectionError, validateSelection } from "./selection-cache.js";

export const PLUGIN_PROJECTION_MANIFEST = "plugin-projection.json";
export const PLUGIN_PROJECTION_LIMITS = Object.freeze({ files: 1024, bytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024, metadataBytes: 512 * 1024, registrations: 64, history: 128 });
export interface PluginPayloadMapping {
  path: string;
  kind: "skill" | "command";
  /** Digest of the original one-file tree, including its path and mode. */
  sourceDigest: string;
  target: Pick<SkillSelection, "slug" | "version" | "bundleDigest">;
}
export interface PluginProjectionManifest {
  schemaVersion: 1;
  agent: "claude";
  pluginId: string;
  upstream: { source: string; revision: string; version: string; license: string; treeDigest: string };
  review: { hooks: "reviewed-no-skill-injection"; dependencies: "reviewed-no-retired-payload-dependency" };
  payloads: PluginPayloadMapping[];
}
export interface PluginFileWitness { path: string; mode: number; size: number; sha256: string }
export interface PluginProjection {
  manifest: PluginProjectionManifest;
  payloads: PluginPayloadMapping[];
  files: SkillBundleEntry[];
  witnesses: PluginFileWitness[];
  originalTreeDigest: string;
  projectionTreeDigest: string;
  removed: PluginFileWitness[];
}
export function pluginRefusal(message: string): never { throw new SkillSelectionError("PLUGIN_ADMISSION_REFUSED", message); }
export function pluginNeed(value: unknown, message: string): asserts value { if (!value) pluginRefusal(message); }
export const pluginHash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export function pluginObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export function pluginKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  pluginNeed(pluginObject(value) && Object.keys(value).every(key => keys.includes(key)), "Unsupported plugin contract fields");
}
export function pluginText(value: unknown, limit = 4096): asserts value is string { pluginNeed(typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value), "Invalid plugin contract text"); }
export function pluginId(value: unknown): asserts value is string { pluginNeed(typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 256, "Invalid plugin identity"); }
export function pluginDigest(value: unknown): asserts value is string { pluginNeed(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "Invalid plugin tree digest"); }
function parse(bytes: Uint8Array): unknown {
  pluginNeed(bytes.byteLength <= PLUGIN_PROJECTION_LIMITS.metadataBytes, "Plugin metadata exceeds its limit");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return pluginRefusal("Unreadable plugin metadata"); }
}
export function validatePluginManifest(value: unknown): asserts value is PluginProjectionManifest {
  pluginKeys(value, ["schemaVersion", "agent", "pluginId", "upstream", "review", "payloads"]);
  pluginNeed(value.schemaVersion === 1 && value.agent === "claude", "Unsupported plugin projection contract"); pluginId(value.pluginId);
  pluginKeys(value.upstream, ["source", "revision", "version", "license", "treeDigest"]);
  for (const key of ["source", "revision", "version", "license"]) pluginText(value.upstream[key], 2048);
  try { const url = new URL(value.upstream.source as string); pluginNeed(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "Upstream provenance requires a credential-free HTTPS source"); } catch { pluginRefusal("Invalid upstream provenance source"); }
  pluginNeed(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value.upstream.version as string) && !(value.upstream.version as string).includes(".."), "Invalid upstream version");
  pluginDigest(value.upstream.treeDigest);
  pluginKeys(value.review, ["hooks", "dependencies"]);
  pluginNeed(value.review.hooks === "reviewed-no-skill-injection" && value.review.dependencies === "reviewed-no-retired-payload-dependency", "Plugin components require an explicit dependency and hook review");
  pluginNeed(Array.isArray(value.payloads) && value.payloads.length <= PLUGIN_PROJECTION_LIMITS.files, "Invalid payload mapping collection");
  const seen = new Set<string>();
  for (const item of value.payloads) {
    pluginKeys(item, ["path", "kind", "sourceDigest", "target"]); pluginText(item.path, 100);
    pluginNeed(!seen.has(item.path), "Duplicate payload mapping"); seen.add(item.path);
    pluginNeed(item.kind === "skill" || item.kind === "command", "Unknown plugin payload kind"); pluginDigest(item.sourceDigest);
    pluginKeys(item.target, ["slug", "version", "bundleDigest"]);
    validateSelection({ ...item.target, authority: "https://example.com/skills/v1", workspaceId: "validation", profileRevision: "validation" } as Parameters<typeof validateSelection>[0]);
  }
}
export function pluginFileWitnesses(entries: SkillBundleEntry[]): PluginFileWitness[] {
  pluginNeed(entries.length > 0 && entries.length <= PLUGIN_PROJECTION_LIMITS.files, "Plugin file count exceeds its limit");
  const paths = new SkillEntryPaths(); let bytes = 0;
  return [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(item => {
    paths.add(item.path, 100, pluginRefusal, () => pluginRefusal("Plugin path exceeds its limit"));
    pluginNeed(item.mode === 0o644 || item.mode === 0o755, "Plugin files require normalized regular-file modes");
    bytes += item.bytes.byteLength;
    pluginNeed(item.bytes.byteLength <= PLUGIN_PROJECTION_LIMITS.fileBytes && bytes <= PLUGIN_PROJECTION_LIMITS.bytes, "Plugin bytes exceed their limit");
    return { path: item.path, mode: item.mode, size: item.bytes.byteLength, sha256: pluginHash(item.bytes) };
  });
}
export function pluginTreeDigest(entries: SkillBundleEntry[]): string { return `sha256:${pluginHash(JSON.stringify(pluginFileWitnesses(entries)))}`; }
const MANIFEST_FIELDS = ["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "experimental", "userConfig", "channels", "defaultEnabled"];
function declaredPaths(value: unknown): string[] {
  if (value === undefined) return [];
  const paths = typeof value === "string" ? [value] : value;
  pluginNeed(Array.isArray(paths) && paths.length <= 64, "Unsupported plugin component paths");
  return paths.map(path => {
    pluginText(path, 100);
    if (path === "." || path === "./") return "";
    pluginNeed(path.startsWith("./") && !path.includes("\\") && !path.includes("$") && !/[\*?\[\]{}]/.test(path), "Plugin component paths must be explicit relative paths");
    const clean = path.slice(2).replace(/\/$/, "");
    pluginNeed(clean.split("/").every(segment => segment && segment !== "." && segment !== ".."), "Plugin component path escapes its package"); return clean;
  });
}
function within(path: string, root: string): boolean {
  path = path.normalize("NFC").toLowerCase(); root = root.normalize("NFC").toLowerCase();
  return root === "" || path === root || path.startsWith(`${root}/`);
}
/** Pure projection: no filesystem access, upstream commands, package installation or publication. */
export function buildPluginProjection(entries: SkillBundleEntry[]): PluginProjection {
  pluginFileWitnesses(entries);
  const contract = entries.filter(item => item.path === PLUGIN_PROJECTION_MANIFEST);
  pluginNeed(contract.length === 1, "The selected bundle has no unique plugin projection manifest");
  const manifest = parse(contract[0]!.bytes); validatePluginManifest(manifest);
  const original = entries.filter(item => item.path.startsWith("original/")).map(item => ({ ...item, path: item.path.slice(9) }));
  pluginNeed(!original.some(item => [".in_use", ".orphaned_at", ".gcs-sha", ".links_materialized"].some(path => within(item.path, path))), "Original plugin packages cannot supply native runtime metadata");
  const originalTreeDigest = pluginTreeDigest(original);
  pluginNeed(originalTreeDigest === manifest.upstream.treeDigest, "The original plugin package differs from its immutable provenance");
  const native = original.find(item => item.path === ".claude-plugin/plugin.json"); pluginNeed(native, "The original plugin manifest is missing");
  const config = parse(native.bytes); pluginKeys(config, MANIFEST_FIELDS);
  pluginNeed(config.name === manifest.pluginId.split("@")[0] && config.version === manifest.upstream.version, "Original plugin identity differs from its contract");
  const skillRoots = ["skills", ...declaredPaths(config.skills)], commandRoots = ["commands", ...declaredPaths(config.commands)];
  const promptKind = (path: string): "skill" | "command" | undefined => /(^|\/)SKILL\.md$/i.test(path) ? "skill" : /\.md$/i.test(path) && commandRoots.some(root => within(path, root)) ? "command" : undefined;
  const prompts = original.filter(item => promptKind(item.path));
  pluginNeed(prompts.length === manifest.payloads.length, "Every original skill and command prompt needs one exact hosted payload mapping");
  for (const item of prompts) {
    const mapping = manifest.payloads.find(mapping => mapping.path === item.path);
    pluginNeed(mapping && mapping.kind === promptKind(item.path) && mapping.sourceDigest === pluginTreeDigest([item]), "A migrated prompt differs from its reviewed source mapping");
  }
  const removed = original.filter(item => promptKind(item.path) || skillRoots.some(root => root !== "" && within(item.path, root)));
  const removedPaths = new Set(removed.map(item => item.path));
  pluginNeed(!removedPaths.has(native.path), "A declared skill root overlaps the plugin manifest");
  const retainedConfig = { ...config }; delete retainedConfig.skills; delete retainedConfig.commands;
  const ordinaryDefaults = ["agents", "hooks", "workflows", "output-styles", "bin", "monitors", "themes", ".mcp.json", ".lsp.json", "settings.json"];
  pluginNeed(!removed.some(item => ordinaryDefaults.some(path => within(item.path, path))), "A skill root overlaps an ordinary component");
  function referencesRemoved(value: unknown): boolean {
    if (typeof value === "string") {
      const normalized = posix.normalize(value).replace(/\/$/, "");
      return removed.some(item => normalized.toLowerCase().includes(item.path.toLowerCase()) || value.startsWith("./") && within(item.path, normalized));
    }
    if (Array.isArray(value)) return value.some(referencesRemoved);
    return pluginObject(value) && Object.values(value).some(referencesRemoved);
  }
  pluginNeed(!referencesRemoved(retainedConfig), "The plugin manifest references a removed ordinary component");
  const files = original.filter(item => !removedPaths.has(item.path)).map(item => ({ ...item, bytes: new Uint8Array(item.bytes) }));
  for (const item of files) {
    if (item.path === native.path) continue;
    if (item.path.toLowerCase() === "package.json") {
      const pkg = parse(item.bytes); pluginNeed(pluginObject(pkg), "Invalid plugin package metadata");
      for (const key of ["scripts", "dependencies", "optionalDependencies", "devDependencies", "peerDependencies", "workspaces", "bundledDependencies", "bundleDependencies", "packageManager"]) pluginNeed(pkg[key] === undefined, "Upstream package installation is outside plugin admission");
    }
    let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(item.bytes); } catch { continue; }
    pluginNeed(![...removedPaths].some(path => text.toLowerCase().includes(path.toLowerCase())), "A retained component references a removed prompt or skill asset");
    if (/\.md$/i.test(item.path)) pluginNeed(!/^skills\s*:/m.test(text), "A retained agent preloads native skills; review its Skills CLI replacement first");
  }
  if (config.skills !== undefined || config.commands !== undefined) {
    delete config.skills; delete config.commands;
    files.find(item => item.path === native.path)!.bytes = new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`);
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { manifest, payloads: manifest.payloads, files, witnesses: pluginFileWitnesses(files), originalTreeDigest, projectionTreeDigest: pluginTreeDigest(files), removed: removed.length ? pluginFileWitnesses(removed) : [] };
}
