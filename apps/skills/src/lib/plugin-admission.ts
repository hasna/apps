import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { inspectSkillBundle, SKILL_BUNDLE_INSPECTION_LIMITS, type SkillBundleEntry } from "./skill-bundle.js";
import { validateResolvedProfile, validateSelection, type SelectionCacheOptions } from "./selection-cache.js";
import { exactProfileSelection } from "./selection-resolver.js";
import { buildPluginProjection, pluginDigest, pluginHash, pluginId, pluginKeys, pluginNeed, pluginObject, pluginRefusal, pluginText, type PluginProjection, type PluginFileWitness, type PluginProjectionManifest, validatePluginManifest, PLUGIN_PROJECTION_LIMITS } from "./plugin-projection.js";
import { materializePluginTree, pluginExecutableDigest, readPluginJson, verifyPluginTree, writePluginJsonImmutable } from "./plugin-projection-store.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { SkillEntryPaths } from "./skill-entry-path.js";
import { describeEntries } from "./selected-manifest.js";

/** Version 1 is certified against native Claude 2.1.274 and 2.1.276; new hosts require a contract revision/test. */
export interface PluginAdmissionTarget {
  schemaVersion: 1;
  pluginId: string;
  /** One marketplace command serves all explicitly reviewed native registration scopes. */
  registrations: Array<{ scope: "user" | "project"; projectPath: string | null }>;
  native: { version: "2.1.274" | "2.1.276"; executable: string; digest: string };
  resolver: { executable: string; digest: string };
}
export interface PluginAdmissionBinding {
  schemaVersion: 1;
  authority: string;
  workspaceId: string;
  profileId: string;
  bundleSlug: string;
  target: PluginAdmissionTarget;
}
export type PluginBundleIdentity = Pick<ResolvedSkillSelection, "slug" | "version" | "bundleDigest">;
/** Only relevant immutable selections participate in admission identity. */
export interface PluginAdmissionIdentity {
  schemaVersion: 2;
  binding: PluginAdmissionBinding;
  bindingId: string;
  selection: PluginBundleIdentity;
  payloadSelections: PluginBundleIdentity[];
  manifest: PluginProjectionManifest;
  originalTreeDigest: string;
  projectionTreeDigest: string;
  files: PluginFileWitness[];
  removed: PluginFileWitness[];
  sourceCommand: string;
}
export interface PluginAdmissionPlan extends PluginAdmissionIdentity {
  observation: { profileRevision: string; integration: ResolvedSkillSelection; payloads: ResolvedSkillSelection[] };
  planDigest: string;
  /** Covers immutable identity and the fresh evidence snapshot together. */
  evidenceDigest: string;
}
export interface PluginAdmissionReceipt { schemaVersion: 2; plan: PluginAdmissionPlan; materializedPath: string; admittedAt: string }
/** Client/store injections are for embedding and isolated tests. The CLI exposes neither. */
export interface PluginAdmissionOptions extends Pick<SelectionCacheOptions, "now"> { client?: ProfileClient; storeRoot?: string; timeoutMs?: number }
export function pluginAdmissionRoot(): string { return join(homedir(), ".hasna", "skills", "plugin-admission"); }
export function validatePluginTarget(value: unknown): asserts value is PluginAdmissionTarget {
  pluginKeys(value, ["schemaVersion", "pluginId", "registrations", "native", "resolver"]);
  pluginNeed(value.schemaVersion === 1, "Invalid plugin admission target"); pluginId(value.pluginId);
  pluginNeed(Array.isArray(value.registrations) && value.registrations.length > 0 && value.registrations.length <= 64, "Invalid plugin registration scope collection");
  const scopes = new Set<string>();
  for (const registration of value.registrations) {
    pluginKeys(registration, ["scope", "projectPath"]);
    pluginNeed(registration.scope === "user" || registration.scope === "project", "Unsupported plugin registration scope");
    pluginNeed(registration.scope === "user" ? registration.projectPath === null : typeof registration.projectPath === "string" && isAbsolute(registration.projectPath) && resolve(registration.projectPath) === registration.projectPath, "Plugin scope requires its exact project path");
    const key = JSON.stringify([registration.scope, registration.projectPath]); pluginNeed(!scopes.has(key), "Duplicate plugin registration scope"); scopes.add(key);
  }
  for (const key of ["native", "resolver"] as const) {
    pluginKeys(value[key], key === "native" ? ["version", "executable", "digest"] : ["executable", "digest"]);
    pluginText(value[key].executable); pluginNeed(isAbsolute(value[key].executable as string) && resolve(value[key].executable as string) === value[key].executable, "Plugin executable must have a canonical absolute path"); pluginDigest(value[key].digest);
  }
  pluginNeed(["2.1.274", "2.1.276"].includes((value.native as Record<string, unknown>).version as string), "Plugin admission requires a certified Claude command-source runtime (2.1.274 or 2.1.276)");
}
/** Deterministic JSON for typed contracts; array order remains meaningful. */
function canonicalJson(value: unknown): string { return JSON.stringify(value, (_key, item) => pluginObject(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item); }
function canonicalTarget(target: PluginAdmissionTarget): PluginAdmissionTarget {
  return JSON.parse(canonicalJson({ ...target, registrations: [...target.registrations].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0) }));
}
function bindingId(binding: PluginAdmissionBinding): string { return pluginHash(canonicalJson({ ...binding, target: canonicalTarget(binding.target) })); }
function selectedIdentity(selection: PluginBundleIdentity): PluginBundleIdentity { return { slug: selection.slug, version: selection.version, bundleDigest: selection.bundleDigest }; }
function planIdentity(plan: PluginAdmissionIdentity): PluginAdmissionIdentity {
  return { schemaVersion: 2, binding: plan.binding, bindingId: plan.bindingId, selection: selectedIdentity(plan.selection), payloadSelections: plan.payloadSelections.map(selectedIdentity), manifest: plan.manifest, originalTreeDigest: plan.originalTreeDigest, projectionTreeDigest: plan.projectionTreeDigest, files: plan.files, removed: plan.removed, sourceCommand: plan.sourceCommand };
}
function identityDigest(plan: PluginAdmissionIdentity): string { return `sha256:${pluginHash(canonicalJson(planIdentity(plan)))}`; }
function evidenceDigest(plan: Omit<PluginAdmissionPlan, "evidenceDigest">): string { return `sha256:${pluginHash(canonicalJson(plan))}`; }
function validateBinding(value: unknown): asserts value is PluginAdmissionBinding {
  pluginKeys(value, ["schemaVersion", "authority", "workspaceId", "profileId", "bundleSlug", "target"]);
  pluginNeed(value.schemaVersion === 1, "Unsupported plugin binding"); validatePluginTarget(value.target);
  for (const key of ["authority", "workspaceId", "profileId", "bundleSlug"]) pluginText(value[key]);
  validateSelection({ slug: value.bundleSlug, version: "1.0.0", bundleDigest: `sha256:${"0".repeat(64)}`, authority: value.authority, workspaceId: value.workspaceId, profileRevision: "validation" } as ResolvedSkillSelection);
}
function validateObservedSelection(value: unknown): asserts value is ResolvedSkillSelection {
  pluginKeys(value, ["slug", "version", "bundleDigest", "aliases", "triggers", "authority", "workspaceId", "profileRevision"]);
  validateSelection(value as unknown as ResolvedSkillSelection);
  if (value.triggers !== undefined) {
    pluginKeys(value.triggers, ["keywords", "paths", "always"]);
    pluginNeed(value.triggers.always === undefined || typeof value.triggers.always === "boolean", "Invalid plugin selection trigger");
    for (const key of ["keywords", "paths"]) {
      const terms = value.triggers[key];
      pluginNeed(terms === undefined || Array.isArray(terms) && terms.length <= 32 && terms.every(term => typeof term === "string" && term.trim() && term.length <= 256), "Invalid plugin selection trigger terms");
    }
  }
}
function validateBundleIdentity(value: unknown): asserts value is PluginBundleIdentity {
  pluginKeys(value, ["slug", "version", "bundleDigest"]);
  validateSelection({ ...value, authority: "https://example.com/skills/v1", workspaceId: "validation", profileRevision: "validation" } as ResolvedSkillSelection);
}
function validateWitnesses(value: unknown, empty = false): asserts value is PluginFileWitness[] {
  pluginNeed(Array.isArray(value) && (empty || value.length > 0) && value.length <= PLUGIN_PROJECTION_LIMITS.files, "Invalid plugin file witnesses");
  const paths = new SkillEntryPaths(); let previous = "", bytes = 0;
  for (const item of value) {
    pluginKeys(item, ["path", "mode", "size", "sha256"]); pluginText(item.path, 100);
    paths.add(item.path, 100, pluginRefusal, () => pluginRefusal("Plugin witness path exceeds its limit"));
    pluginNeed(item.path > previous, "Plugin witnesses must be unique and sorted"); previous = item.path;
    pluginNeed(item.mode === 0o644 || item.mode === 0o755, "Invalid plugin witness mode");
    pluginNeed(typeof item.size === "number" && Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= PLUGIN_PROJECTION_LIMITS.fileBytes, "Invalid plugin witness size");
    bytes += item.size; pluginNeed(bytes <= PLUGIN_PROJECTION_LIMITS.bytes, "Plugin witnesses exceed their byte limit");
    pluginNeed(typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256), "Invalid plugin file digest");
  }
}
function normalizedWitnesses(files: PluginFileWitness[]): PluginFileWitness[] { return files.map(file => ({ path: file.path, mode: file.mode, size: file.size, sha256: file.sha256 })); }
function validatePlan(value: unknown): asserts value is PluginAdmissionPlan {
  pluginKeys(value, ["schemaVersion", "binding", "bindingId", "selection", "payloadSelections", "manifest", "originalTreeDigest", "projectionTreeDigest", "files", "removed", "sourceCommand", "observation", "planDigest", "evidenceDigest"]);
  pluginNeed(value.schemaVersion === 2, "Unsupported plugin admission plan; schema version 2 is required");
  validateBinding(value.binding); validateBundleIdentity(value.selection); validatePluginManifest(value.manifest);
  pluginNeed(value.bindingId === bindingId(value.binding) && value.selection.slug === value.binding.bundleSlug && value.manifest.pluginId === value.binding.target.pluginId, "Plugin plan identities disagree");
  pluginNeed(value.sourceCommand === pluginResolverCommand(value.binding), "Plugin plan command differs from its binding");
  pluginDigest(value.originalTreeDigest); pluginDigest(value.projectionTreeDigest); pluginDigest(value.planDigest); pluginDigest(value.evidenceDigest);
  validateWitnesses(value.files); validateWitnesses(value.removed, true);
  pluginNeed(value.originalTreeDigest === value.manifest.upstream.treeDigest && value.projectionTreeDigest === `sha256:${pluginHash(JSON.stringify(normalizedWitnesses(value.files)))}`, "Plugin plan tree identities disagree");
  const allPaths = new SkillEntryPaths();
  pluginNeed(value.files.length + value.removed.length <= PLUGIN_PROJECTION_LIMITS.files && [...value.files, ...value.removed].reduce((sum, item) => sum + item.size, 0) <= PLUGIN_PROJECTION_LIMITS.bytes, "Combined plugin witnesses exceed their limits");
  for (const item of [...value.files, ...value.removed]) allPaths.add(item.path, 100, pluginRefusal, () => pluginRefusal("Plugin witness path exceeds its limit"));
  const mapped = new Map<string, PluginBundleIdentity>();
  for (const mapping of value.manifest.payloads) {
    const prior = mapped.get(mapping.target.slug);
    pluginNeed(!prior || canonicalJson(prior) === canonicalJson(mapping.target), "Plugin mappings disagree about a canonical payload"); mapped.set(mapping.target.slug, mapping.target);
    const removed = value.removed.find(item => item.path === mapping.path);
    pluginNeed(removed && mapping.sourceDigest === `sha256:${pluginHash(JSON.stringify(normalizedWitnesses([removed])))}`, "Plugin mapped source differs from its removed witness");
  }
  pluginNeed(Array.isArray(value.payloadSelections) && value.payloadSelections.length === mapped.size, "Plugin payload selection membership differs from its mappings");
  let previous = "";
  for (const selection of value.payloadSelections) {
    validateBundleIdentity(selection);
    pluginNeed(selection.slug > previous && selection.slug !== value.selection.slug && canonicalJson(selection) === canonicalJson(mapped.get(selection.slug)), "Plugin payload selection differs from its canonical mapping"); previous = selection.slug;
  }
  pluginKeys(value.observation, ["profileRevision", "integration", "payloads"]); pluginText(value.observation.profileRevision);
  validateObservedSelection(value.observation.integration);
  pluginNeed(Array.isArray(value.observation.payloads) && value.observation.payloads.length === value.payloadSelections.length, "Plugin observation membership differs from its identity");
  const observed = [value.observation.integration, ...value.observation.payloads], selected = [value.selection, ...value.payloadSelections];
  for (let index = 0; index < observed.length; index++) {
    const selection = observed[index]; validateObservedSelection(selection);
    pluginNeed(canonicalJson(selectedIdentity(selection)) === canonicalJson(selected[index]), "Plugin observed canonical selection differs from its identity");
  }
  validateResolvedProfile({ profileId: value.binding.profileId, authority: value.binding.authority, workspaceId: value.binding.workspaceId, profileRevision: value.observation.profileRevision, selections: observed }, value.binding.authority);
  const plan = value as unknown as PluginAdmissionPlan, { evidenceDigest: digest, ...evidence } = plan;
  pluginNeed(identityDigest(plan) === plan.planDigest, "Plugin receipt immutable identity changed");
  pluginNeed(evidenceDigest(evidence) === digest, "Plugin receipt observed evidence changed");
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function pluginResolverCommand(binding: PluginAdmissionBinding): string { return `${quote(binding.target.resolver.executable)} integration plugin resolve --binding ${bindingId(binding)}`; }
function root(options: PluginAdmissionOptions): string { const path = options.storeRoot ?? pluginAdmissionRoot(); pluginNeed(isAbsolute(path) && resolve(path) === path, "Invalid plugin admission store root"); return path; }
export function pluginBindingPath(storeRoot: string, id: string): string { pluginNeed(/^[a-f0-9]{64}$/.test(id), "Invalid plugin binding identifier"); return join(storeRoot, "bindings", `${id}.json`); }
export function pluginReceiptPath(storeRoot: string, id: string, digest: string): string { pluginNeed(/^[a-f0-9]{64}$/.test(id), "Invalid plugin binding identifier"); pluginDigest(digest); return join(storeRoot, "receipts", id, `${digest.slice(7)}.json`); }
export function readPluginBinding(storeRoot: string, id: string): PluginAdmissionBinding {
  const value = readPluginJson(pluginBindingPath(storeRoot, id));
  validateBinding(value);
  const binding = value as unknown as PluginAdmissionBinding;
  pluginNeed(bindingId(binding) === id, "Plugin admission binding changed"); return binding;
}
export function readPluginAdmissionReceipt(storeRoot: string, id: string, digest: string): PluginAdmissionReceipt {
  const value = readPluginJson(pluginReceiptPath(storeRoot, id, digest));
  pluginKeys(value, ["schemaVersion", "plan", "materializedPath", "admittedAt"]);
  pluginNeed(value.schemaVersion === 2, "Unsupported plugin admission receipt; schema version 2 is required");
  validatePlan(value.plan);
  const receipt = value as unknown as PluginAdmissionReceipt;
  // Legacy tree digests and native discovery use the explicit file-witness field order.
  receipt.plan.files = normalizedWitnesses(receipt.plan.files); receipt.plan.removed = normalizedWitnesses(receipt.plan.removed);
  pluginNeed(receipt.plan.bindingId === id && receipt.plan.planDigest === digest, "Plugin receipt identity differs from its filename");
  const binding = readPluginBinding(storeRoot, id);
  pluginNeed(canonicalJson(binding) === canonicalJson(receipt.plan.binding) && receipt.plan.sourceCommand === pluginResolverCommand(binding), "Plugin receipt binding changed");
  pluginNeed(receipt.materializedPath === join(storeRoot, "objects", id, digest.slice(7)), "Plugin receipt points outside its immutable materialization");
  pluginText(receipt.admittedAt, 64); pluginNeed(Number.isFinite(Date.parse(receipt.admittedAt)), "Invalid plugin admission time");
  return receipt;
}
/** Command sources inherit an untrusted shell environment; authority comes from normal owner credentials. */
export function assertPluginAuthorityEnvironment(env: Record<string, string | undefined> = process.env): void {
  for (const key of Object.keys(env)) {
    if (/^(?:HASNA_SKILLS_(?:API_|BOUND_API_|LOCAL|MODE|DIR)|SKILLS_(?:API_|LOCAL|MODE)|HASNA_(?:API_KEY|CONFIG_HOME|HOME)$)/.test(key) && env[key] !== undefined) pluginRefusal("Plugin admission refuses environment overrides of Skills authority or local storage; use owner credential configuration");
  }
}
async function client(options: PluginAdmissionOptions): Promise<ProfileClient> {
  if (options.client) return options.client;
  assertPluginAuthorityEnvironment(); return createProfileClient();
}
class Deadline {
  readonly end: number;
  constructor(ms: number) { pluginNeed(Number.isInteger(ms) && ms > 0 && ms <= 25_000, "Invalid plugin resolver timeout"); this.end = Date.now() + ms; }
  check(): void { pluginNeed(Date.now() < this.end, "Plugin admission deadline exceeded"); }
  async wait<T>(promise: Promise<T>, cancel?: () => void): Promise<T> {
    this.check(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel?.(); reject(new Error("Plugin admission deadline exceeded")); }, Math.max(1, this.end - Date.now())); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
}
async function bundle(selection: ResolvedSkillSelection, api: ProfileClient, deadline: Deadline): Promise<SkillBundleEntry[]> {
  const response = await deadline.wait(api.getBundle(selection.slug, selection.version));
  pluginNeed(response?.ok, "Selected plugin or migrated payload bundle is unavailable");
  const declared = response.headers.get("X-Skill-Bundle-Sha256"), version = response.headers.get("X-Skill-Version");
  if ((declared && `sha256:${declared}` !== selection.bundleDigest) || (version && version !== selection.version)) { await response.body?.cancel(); pluginRefusal("Selected plugin bundle identity differs from the API response"); }
  const reader = response.body?.getReader(); pluginNeed(reader, "Selected plugin bundle has no body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await deadline.wait(reader.read(), () => { void reader.cancel().catch(() => {}); }); if (next.done) break;
      size += next.value.byteLength; pluginNeed(size <= SKILL_BUNDLE_INSPECTION_LIMITS.compressedBytes, "Selected plugin bundle exceeds its size limit"); chunks.push(next.value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  pluginNeed(`sha256:${pluginHash(bytes)}` === selection.bundleDigest, "Selected plugin bundle digest differs from the profile");
  deadline.check(); const inspected = await inspectSkillBundle(bytes); deadline.check(); return inspected.entries;
}
async function candidate(spec: string, profileId: string, target: PluginAdmissionTarget, options: PluginAdmissionOptions): Promise<{ plan: PluginAdmissionPlan; projection: PluginProjection }> {
  validatePluginTarget(target); target = canonicalTarget(target);
  const deadline = new Deadline(options.timeoutMs ?? 25_000), api = await deadline.wait(client(options));
  const profile = await deadline.wait(api.resolveProfile(profileId)); validateResolvedProfile(profile, api.authority);
  pluginKeys(profile, ["profileId", "workspaceId", "profileRevision", "authority", "selections"]);
  for (const selection of profile.selections) validateObservedSelection(selection);
  pluginNeed(profile.profileId === profileId, "The Skills API returned a different plugin selection profile");
  const selection = exactProfileSelection(spec, profile), entries = await bundle(selection, api, deadline);
  pluginNeed(describeEntries(entries).kind === "instruction", "Plugin assets must be held in an instruction bundle, never an executable skill");
  const projection = buildPluginProjection(entries);
  pluginNeed(projection.manifest.pluginId === target.pluginId, "Plugin package and registration target identities differ");
  const seen = new Map<string, ResolvedSkillSelection>();
  for (const payload of projection.payloads) {
    const selected = exactProfileSelection(`${payload.target.slug}@${payload.target.version}`, profile);
    pluginNeed(selected.slug === payload.target.slug && selected.bundleDigest === payload.target.bundleDigest && selected.slug !== selection.slug, "Migrated payload is not selected at its reviewed digest");
    if (!seen.has(selected.slug)) { await bundle(selected, api, deadline); seen.set(selected.slug, selected); }
  }
  for (const executable of [target.native, target.resolver]) { deadline.check(); pluginNeed(pluginExecutableDigest(executable.executable) === executable.digest, "The approved native or Skills executable changed"); }
  deadline.check();
  const binding: PluginAdmissionBinding = JSON.parse(canonicalJson({ schemaVersion: 1, authority: profile.authority, workspaceId: profile.workspaceId, profileId, bundleSlug: selection.slug, target }));
  const payloads = [...seen.values()].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const identity: PluginAdmissionIdentity = { schemaVersion: 2, binding, bindingId: bindingId(binding), selection: selectedIdentity(selection), payloadSelections: payloads.map(selectedIdentity), manifest: projection.manifest, originalTreeDigest: projection.originalTreeDigest, projectionTreeDigest: projection.projectionTreeDigest, files: projection.witnesses, removed: projection.removed, sourceCommand: pluginResolverCommand(binding) };
  const evidence = { ...identity, observation: { profileRevision: profile.profileRevision, integration: selection, payloads }, planDigest: identityDigest(identity) };
  const plan: PluginAdmissionPlan = { ...evidence, evidenceDigest: evidenceDigest(evidence) }; validatePlan(plan);
  return { plan, projection };
}
/** API reads only: a plan neither writes caches nor admits or executes package code. */
export async function planPluginAdmission(spec: string, profileId: string, target: PluginAdmissionTarget, options: PluginAdmissionOptions = {}): Promise<PluginAdmissionPlan> { return (await candidate(spec, profileId, target, options)).plan; }
/** Explicit local admission. Original archive and migrated payloads are already privately published. */
export async function admitPlugin(spec: string, profileId: string, target: PluginAdmissionTarget, approvedDigest: string, options: PluginAdmissionOptions = {}): Promise<PluginAdmissionReceipt> {
  pluginDigest(approvedDigest);
  const { plan, projection } = await candidate(spec, profileId, target, options);
  pluginNeed(plan.planDigest === approvedDigest, "The plugin plan changed since review; obtain and review a new plan");
  const store = root(options), materializedPath = join(store, "objects", plan.bindingId, plan.planDigest.slice(7));
  materializePluginTree(materializedPath, projection.files);
  writePluginJsonImmutable(pluginBindingPath(store, plan.bindingId), plan.binding);
  const path = pluginReceiptPath(store, plan.bindingId, plan.planDigest), existing = readPluginJson(path);
  if (existing) { const receipt = readPluginAdmissionReceipt(store, plan.bindingId, plan.planDigest); verifyPluginTree(receipt.materializedPath, plan.files); return receipt; }
  const receipt: PluginAdmissionReceipt = { schemaVersion: 2, plan, materializedPath, admittedAt: new Date((options.now ?? Date.now)()).toISOString() };
  writePluginJsonImmutable(path, receipt); return receipt;
}
/** Fresh authority on every invocation. No receipt, API failure or revocation ever returns a stale directory. */
export async function resolveAdmittedPlugin(id: string, options: PluginAdmissionOptions = {}): Promise<string> {
  const store = root(options), binding = readPluginBinding(store, id);
  const { plan } = await candidate(binding.bundleSlug, binding.profileId, binding.target, options);
  pluginNeed(plan.selection.slug === binding.bundleSlug, "The canonical integration selection was replaced by an alias");
  pluginNeed(plan.bindingId === id, "The current credential resolves a different plugin authority or workspace");
  const receipt = readPluginAdmissionReceipt(store, id, plan.planDigest);
  pluginNeed(canonicalJson(planIdentity(receipt.plan)) === canonicalJson(planIdentity(plan)), "The current plugin immutable identity is not explicitly admitted");
  verifyPluginTree(receipt.materializedPath, plan.files); return receipt.materializedPath;
}
