import { createHash } from "node:crypto";
import { isAbsolute, posix, resolve } from "node:path";
import type {
  AssetDestinationStrategy,
  AssetKind,
  AssetScope,
  Config,
  ConfigAgent,
  ProfileAssetBinding,
  ProfileAssetBindingSpec,
} from "../types/index.js";
import {
  ASSET_DESTINATION_STRATEGIES,
  ASSET_KINDS,
  ASSET_ROLLBACK_POLICIES,
  ASSET_SCOPES,
  ASSET_UNINSTALL_POLICIES,
  CONFIG_AGENTS,
  PROFILE_ASSET_BINDING_SCHEMA,
} from "../types/index.js";
import { providerVersionSatisfies } from "./provider-version.js";

export const ASSET_PLAN_SCHEMA = "hasna.instructions.asset-plan/v1" as const;
export const ASSET_CAPABILITY_SCHEMA = "hasna.instructions.asset-capability/v1" as const;
export const ASSET_BUNDLE_SCHEMA = "hasna.instructions.asset-bundle/v1" as const;

export type AssetPlanMode = "explain" | "dry-run" | "apply";
export type AssetSupport = "supported" | "conditional" | "unsupported";
export type AssetAction = "explain" | "write" | "install" | "skip";

/** Immutable, content-addressed bytes consumed by an AssetBinding. */
export interface AssetBundle {
  schema: typeof ASSET_BUNDLE_SCHEMA;
  bundleId: string;
  sourceConfigId: string;
  sourceConfigVersion: number;
  kind: AssetKind;
  locator: string;
  digest: string;
  content: string;
}

export interface AssetCapability {
  schema: typeof ASSET_CAPABILITY_SCHEMA;
  descriptorVersion: number;
  provider: ConfigAgent;
  providerVersionRange: string;
  surface: string;
  kind: AssetKind;
  support: AssetSupport;
  strategies: readonly AssetDestinationStrategy[];
  note: string;
}

export interface AssetPlanDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  assetKey: string | null;
  message: string;
}

export interface AssetPlanItem {
  assetId: string;
  sourceConfigId: string;
  sourceConfigVersion: number;
  assetKey: string;
  kind: AssetKind;
  selector: {
    provider: ConfigAgent;
    versionRange: string;
    surface: string;
    scope: AssetScope;
  };
  source: {
    locator: string;
    digest: string;
    immutable: boolean;
    allowed: boolean;
  };
  destination: {
    strategy: AssetDestinationStrategy;
    root: "target-home" | "project-root";
    relativePath: string;
  };
  support: AssetSupport;
  action: AssetAction;
  mutationMode: AssetPlanMode;
  enabled: boolean;
  required: boolean;
  uninstall: ProfileAssetBindingSpec["uninstall"];
  rollback: ProfileAssetBindingSpec["rollback"];
  validation: {
    pathSafe: boolean;
    digestVerified: boolean;
    collisionFree: boolean;
    sourceAllowed: boolean;
  };
  exactOnceKey: string;
}

export interface AssetPlan {
  schema: typeof ASSET_PLAN_SCHEMA;
  planDigest: string;
  profileId: string;
  provider: ConfigAgent;
  providerVersion: string;
  surface: string;
  scope: AssetScope;
  mode: AssetPlanMode;
  assets: AssetPlanItem[];
  diagnostics: AssetPlanDiagnostic[];
}

export interface CompileAssetPlanInput {
  profileId: string;
  provider: ConfigAgent;
  providerVersion: string;
  surface: string;
  scope?: AssetScope;
  mode: AssetPlanMode;
  configs: Config[];
  bindings: ProfileAssetBinding[];
  allowInstallers?: boolean;
}

function assetCapability(
  provider: ConfigAgent,
  surface: string,
  kind: AssetKind,
  support: AssetSupport,
  strategies: readonly AssetDestinationStrategy[],
  note: string,
  providerVersionRange = "*",
): AssetCapability {
  return Object.freeze({
    schema: ASSET_CAPABILITY_SCHEMA,
    descriptorVersion: 1,
    provider,
    providerVersionRange,
    surface,
    kind,
    support,
    strategies,
    note,
  });
}

/**
 * Code-owned provider support. Unknown combinations remain unsupported rather
 * than being guessed from a similarly named provider or surface.
 */
export const ASSET_CAPABILITY_DESCRIPTORS: readonly AssetCapability[] = Object.freeze([
  assetCapability("claude", "code", "skill", "supported", ["emit-file"], "Claude Code project or profile skill files."),
  assetCapability("claude", "code", "workflow", "supported", ["emit-file"], "Claude Code command and workflow files."),
  assetCapability("claude", "code", "hook", "supported", ["emit-file"], "Claude Code hook configuration fragments."),
  assetCapability("claude", "code", "plugin", "conditional", ["install-marketplace"], "Claude marketplace installation requires an explicit installer."),
  assetCapability("codex", "cli", "skill", "supported", ["emit-file"], "Codex skill bundle files."),
  assetCapability("codex", "cli", "plugin", "conditional", ["install-local", "install-marketplace"], "Codex plugin installation requires an explicit installer."),
  assetCapability("cursor", "ide", "skill", "supported", ["emit-file"], "Cursor project skill files."),
  assetCapability("cursor", "ide", "extension", "conditional", ["install-marketplace"], "Cursor extension installation requires an explicit installer."),
  assetCapability("opencode", "cli", "skill", "supported", ["emit-file"], "OpenCode local skill files."),
  assetCapability("opencode", "cli", "workflow", "supported", ["emit-file"], "OpenCode command/workflow files."),
  assetCapability("opencode", "cli", "plugin", "supported", ["emit-file"], "OpenCode local plugin modules."),
  assetCapability("opencode", "cli", "custom-agent", "supported", ["emit-file"], "OpenCode custom agent files."),
  assetCapability("codewith", "cli", "skill", "supported", ["emit-file"], "Codewith skill bundle files."),
  assetCapability("codewith", "cli", "plugin", "conditional", ["install-local", "install-marketplace"], "Codewith plugin installation requires an explicit installer."),
  assetCapability("aicopilot", "cli", "skill", "supported", ["emit-file"], "AICopilot discovered skill files."),
  assetCapability("aicopilot", "cli", "plugin", "supported", ["emit-file"], "AICopilot plugin entry files remain separate from instructions."),
  assetCapability("qwen", "cli", "skill", "supported", ["emit-file"], "Qwen Code skill files."),
  assetCapability("qwen", "cli", "extension", "conditional", ["install-local", "install-marketplace"], "Qwen extension installation requires an explicit installer."),
  assetCapability("qwen", "cli", "hook", "supported", ["emit-file"], "Qwen native hook configuration files."),
  assetCapability("antigravity", "project", "skill", "supported", ["emit-file"], "Antigravity project skill bundle files."),
  assetCapability("antigravity", "project", "workflow", "supported", ["emit-file"], "Antigravity slash-triggered workflow files."),
  assetCapability("antigravity", "global-compat", "skill", "supported", ["emit-file"], "Antigravity compatibility skill bundle files."),
  assetCapability("grok", "build", "skill", "supported", ["emit-file"], "Grok Build skill files."),
  assetCapability("grok", "build", "plugin", "conditional", ["install-marketplace"], "Grok Build marketplace installation requires an explicit installer."),
  assetCapability("copilot", "repository", "skill", "supported", ["emit-file"], "GitHub Copilot repository skill files."),
  assetCapability("copilot", "repository", "plugin", "unsupported", ["unsupported"], "GitHub Copilot repository instructions do not install IDE plugins."),
  assetCapability("copilot", "app", "plugin", "conditional", ["install-marketplace"], "GitHub Copilot app plugin installation requires an explicit installer."),
  assetCapability("copilot", "ide", "extension", "conditional", ["install-marketplace"], "GitHub Copilot IDE extension installation requires an explicit installer."),
  assetCapability("devin", "repository", "skill", "supported", ["emit-file"], "Devin Desktop project skill files."),
  assetCapability("devin", "repository", "workflow", "supported", ["emit-file"], "Devin Desktop manual workflow files."),
  assetCapability("windsurf-legacy", "legacy", "skill", "supported", ["emit-file"], "Legacy Windsurf project skill files."),
  assetCapability("windsurf-legacy", "legacy", "workflow", "supported", ["emit-file"], "Legacy Windsurf workflow files."),
  assetCapability("cline", "cli", "skill", "supported", ["emit-file"], "Cline CLI skill files."),
  assetCapability("cline", "cli", "workflow", "supported", ["emit-file"], "Cline CLI workflow files."),
  assetCapability("cline", "cli", "plugin", "supported", ["install-local"], "Cline CLI/SDK plugin installation requires an explicit installer."),
  assetCapability("cline", "ide", "skill", "supported", ["emit-file"], "Cline IDE skill files."),
  assetCapability("cline", "ide", "workflow", "supported", ["emit-file"], "Cline IDE workflow files."),
  assetCapability("cline", "ide", "plugin", "unsupported", ["unsupported"], "Cline VS Code and JetBrains surfaces do not load CLI plugins."),
]);

export const DEFAULT_ASSET_SURFACES: Readonly<Partial<Record<ConfigAgent, string>>> = Object.freeze({
  claude: "code",
  codex: "cli",
  cursor: "ide",
  opencode: "cli",
  codewith: "cli",
  qwen: "cli",
  aicopilot: "cli",
  antigravity: "project",
  grok: "build",
  copilot: "repository",
  devin: "repository",
  "windsurf-legacy": "legacy",
  cline: "ide",
});

export function configAssetLocator(configId: string, version: number): string {
  return `config://${encodeURIComponent(configId)}@${version}`;
}

export function configAssetDigest(content: string): string {
  return `sha256:${sha256(content)}`;
}

export function assetBundleFromConfig(config: Config, kind: AssetKind): AssetBundle {
  if (!ASSET_KINDS.includes(kind)) throw new Error(`Invalid asset bundle kind: ${String(kind)}`);
  const locator = configAssetLocator(config.id, config.version);
  return deepFreeze({
    schema: ASSET_BUNDLE_SCHEMA,
    bundleId: `${locator}#${kind}`,
    sourceConfigId: config.id,
    sourceConfigVersion: config.version,
    kind,
    locator,
    digest: configAssetDigest(config.content),
    content: config.content,
  });
}

export function normalizeProfileAssetBinding(value: unknown): ProfileAssetBindingSpec {
  const raw = typeof value === "string" ? parseJson(value) : value;
  const record = objectRecord(raw, "Profile asset binding");
  if (record["schema"] !== PROFILE_ASSET_BINDING_SCHEMA) {
    throw new Error(`Unsupported profile asset binding schema: ${String(record["schema"])}`);
  }
  const assetKey = nonEmptyString(record["assetKey"], "assetKey");
  const kind = record["kind"] as AssetKind;
  if (!ASSET_KINDS.includes(kind)) throw new Error(`Invalid asset kind: ${String(record["kind"])}`);
  const enabled = booleanValue(record["enabled"], "enabled");
  const required = booleanValue(record["required"], "required");
  const selectorRecord = objectRecord(record["selector"], "selector");
  const provider = nonEmptyString(selectorRecord["provider"], "selector.provider") as ConfigAgent;
  if (!CONFIG_AGENTS.includes(provider)) throw new Error(`Invalid asset provider: ${provider}`);
  const versionRange = nonEmptyString(selectorRecord["versionRange"], "selector.versionRange");
  providerVersionSatisfies("0.0.0", versionRange);
  const surface = nonEmptyString(selectorRecord["surface"], "selector.surface");
  const scope = selectorRecord["scope"] as AssetScope;
  if (!ASSET_SCOPES.includes(scope)) throw new Error(`Invalid asset scope: ${String(selectorRecord["scope"])}`);
  const sourceRecord = objectRecord(record["source"], "source");
  const sourceKind = sourceRecord["kind"] as AssetKind;
  if (!ASSET_KINDS.includes(sourceKind)) throw new Error(`Invalid source kind: ${String(sourceRecord["kind"])}`);
  const destinationRecord = objectRecord(record["destination"], "destination");
  const strategy = destinationRecord["strategy"] as AssetDestinationStrategy;
  if (!ASSET_DESTINATION_STRATEGIES.includes(strategy)) throw new Error(`Invalid asset destination strategy: ${String(destinationRecord["strategy"])}`);
  const root = destinationRecord["root"];
  if (root !== "target-home" && root !== "project-root") throw new Error(`Invalid asset destination root: ${String(root)}`);
  const uninstall = record["uninstall"] as ProfileAssetBindingSpec["uninstall"];
  if (!ASSET_UNINSTALL_POLICIES.includes(uninstall)) throw new Error(`Invalid asset uninstall policy: ${String(uninstall)}`);
  const rollback = record["rollback"] as ProfileAssetBindingSpec["rollback"];
  if (!ASSET_ROLLBACK_POLICIES.includes(rollback)) throw new Error(`Invalid asset rollback policy: ${String(rollback)}`);
  return {
    schema: PROFILE_ASSET_BINDING_SCHEMA,
    assetKey,
    kind,
    enabled,
    required,
    selector: { provider, versionRange, surface, scope },
    source: {
      kind: sourceKind,
      locator: nonEmptyString(sourceRecord["locator"], "source.locator"),
      digest: nonEmptyString(sourceRecord["digest"], "source.digest"),
      immutable: booleanValue(sourceRecord["immutable"], "source.immutable"),
      allowed: booleanValue(sourceRecord["allowed"], "source.allowed"),
    },
    destination: {
      strategy,
      root,
      relativePath: nonEmptyString(destinationRecord["relativePath"], "destination.relativePath"),
    },
    uninstall,
    rollback,
  };
}

export function compileAssetPlan(input: CompileAssetPlanInput): AssetPlan {
  if (!input.profileId.trim()) throw new Error("Asset plan profileId is required.");
  if (!CONFIG_AGENTS.includes(input.provider)) throw new Error(`Unsupported asset provider: ${input.provider}`);
  providerVersionSatisfies(input.providerVersion, "*");
  if (!input.surface.trim()) throw new Error("Asset plan surface is required.");
  const scope = input.scope ?? "session";
  if (!ASSET_SCOPES.includes(scope)) throw new Error(`Invalid asset plan scope: ${String(scope)}`);
  const diagnostics: AssetPlanDiagnostic[] = [];
  const configs = new Map(input.configs.map((config) => [config.id, config]));
  if (configs.size !== input.configs.length) throw new Error("Asset plan contains duplicate config identities.");
  const selected: AssetPlanItem[] = [];

  for (const row of [...input.bindings].sort(compareBindings)) {
    if (row.profile_id !== input.profileId) throw new Error(`Asset binding ${row.binding.assetKey} belongs to another profile.`);
    const binding = normalizeProfileAssetBinding(row.binding);
    if (binding.selector.provider !== input.provider || binding.selector.surface !== input.surface || binding.selector.scope !== scope) continue;
    if (!providerVersionSatisfies(input.providerVersion, binding.selector.versionRange)) {
      diagnostics.push(diagnostic(binding.required ? "error" : "warning", "ASSET_PROVIDER_VERSION_UNSUPPORTED", binding.assetKey, `${binding.assetKey} requires ${input.provider} ${binding.selector.versionRange}; current version is ${input.providerVersion}.`));
      continue;
    }
    const config = configs.get(row.source_config_id);
    if (!config) {
      diagnostics.push(diagnostic("error", "ASSET_SOURCE_MISSING", binding.assetKey, `Asset source config does not exist: ${row.source_config_id}.`));
      continue;
    }
    const bundle = assetBundleFromConfig(config, binding.kind);
    const validation = validateAssetSourceAndDestination(bundle, binding, diagnostics);
    const capability = selectAssetCapability(input.provider, input.providerVersion, input.surface, binding.kind);
    let support = capability.support;
    let action: AssetAction;
    if (!binding.enabled) {
      action = "skip";
      diagnostics.push(diagnostic("info", "ASSET_DISABLED", binding.assetKey, `${binding.assetKey} is disabled.`));
    } else if (support === "unsupported" || !capability.strategies.includes(binding.destination.strategy)) {
      support = "unsupported";
      action = "skip";
      diagnostics.push(diagnostic(binding.required ? "error" : "warning", "ASSET_CAPABILITY_UNSUPPORTED", binding.assetKey, `${input.provider} ${input.surface} does not support ${binding.required ? "required " : "optional "}${binding.kind} strategy ${binding.destination.strategy}. ${capability.note}`));
    } else if (input.mode === "explain") {
      action = "explain";
    } else if (binding.destination.strategy === "emit-file") {
      action = "write";
    } else if (binding.destination.strategy === "install-local" || binding.destination.strategy === "install-marketplace") {
      if (input.mode === "apply" && input.allowInstallers !== true) {
        action = "skip";
        diagnostics.push(diagnostic(binding.required ? "error" : "warning", "ASSET_INSTALLER_OPT_IN_REQUIRED", binding.assetKey, `${binding.assetKey} requires explicit installer opt-in.`));
      } else {
        action = "install";
      }
    } else {
      action = "skip";
    }
    selected.push({
      assetId: `${input.profileId}:${binding.assetKey}`,
      sourceConfigId: config.id,
      sourceConfigVersion: config.version,
      assetKey: binding.assetKey,
      kind: binding.kind,
      selector: binding.selector,
      source: {
        locator: binding.source.locator,
        digest: binding.source.digest,
        immutable: binding.source.immutable,
        allowed: binding.source.allowed,
      },
      destination: binding.destination,
      support,
      action,
      mutationMode: input.mode,
      enabled: binding.enabled,
      required: binding.required,
      uninstall: binding.uninstall,
      rollback: binding.rollback,
      validation,
      exactOnceKey: `${input.profileId}|${input.provider}|${input.surface}|${scope}|${binding.assetKey}`,
    });
  }

  validateCollisions(selected, diagnostics);
  if (diagnostics.some((entry) => entry.severity === "error")) throw new AssetPlanValidationError(diagnostics);
  const planWithoutDigest = {
    schema: ASSET_PLAN_SCHEMA,
    profileId: input.profileId,
    provider: input.provider,
    providerVersion: input.providerVersion,
    surface: input.surface,
    scope,
    mode: input.mode,
    assets: selected,
    diagnostics,
  };
  return deepFreeze({ ...planWithoutDigest, planDigest: sha256(stableJson(planWithoutDigest)) });
}

export function selectAssetCapability(provider: ConfigAgent, version: string, surface: string, kind: AssetKind): AssetCapability {
  const candidates = ASSET_CAPABILITY_DESCRIPTORS.filter((entry) => entry.provider === provider && entry.surface === surface && entry.kind === kind);
  const selected = candidates.find((entry) => providerVersionSatisfies(version, entry.providerVersionRange));
  return selected ?? assetCapability(provider, surface, kind, "unsupported", ["unsupported"], `No ${kind} adapter is declared for ${provider} ${surface}.`);
}

export function resolveAssetDestination(
  item: Pick<AssetPlanItem, "destination" | "assetKey">,
  roots: { targetHome: string; projectRoot?: string },
): string {
  const root = item.destination.root === "target-home" ? roots.targetHome : roots.projectRoot;
  if (!root) throw new Error(`Asset ${item.assetKey} requires an explicit project root.`);
  if (!isAbsolute(root)) throw new Error(`Asset ${item.assetKey} destination root must be absolute.`);
  const relativePath = safeRelativePath(item.destination.relativePath);
  const target = resolve(root, ...relativePath.split("/"));
  const normalizedRoot = resolve(root);
  if (target === normalizedRoot) throw new Error(`Asset ${item.assetKey} destination cannot replace its root.`);
  if (!target.startsWith(`${normalizedRoot}/`)) throw new Error(`Asset ${item.assetKey} destination escapes its root.`);
  return target;
}

export class AssetPlanValidationError extends Error {
  constructor(readonly diagnostics: AssetPlanDiagnostic[]) {
    super(diagnostics.filter((entry) => entry.severity === "error").map((entry) => `${entry.code}: ${entry.message}`).join("; "));
    this.name = "AssetPlanValidationError";
  }
}

function validateAssetSourceAndDestination(
  bundle: AssetBundle,
  binding: ProfileAssetBindingSpec,
  diagnostics: AssetPlanDiagnostic[],
): AssetPlanItem["validation"] {
  let pathSafe = true;
  try { safeRelativePath(binding.destination.relativePath); } catch (error) {
    pathSafe = false;
    diagnostics.push(diagnostic("error", "ASSET_DESTINATION_UNSAFE", binding.assetKey, (error as Error).message));
  }
  const expectedLocator = bundle.locator;
  if (!binding.source.immutable || binding.source.locator !== expectedLocator) {
    diagnostics.push(diagnostic("error", "ASSET_SOURCE_MUTABLE_OR_UNPINNED", binding.assetKey, `Asset source must be pinned to ${expectedLocator}.`));
  }
  const digestKnown = /^sha256:[a-f0-9]{64}$/.test(binding.source.digest);
  const digestVerified = digestKnown && binding.source.digest === bundle.digest;
  if (!digestKnown) diagnostics.push(diagnostic("error", "ASSET_DIGEST_UNKNOWN", binding.assetKey, "Asset source digest must be a lowercase sha256 digest."));
  else if (!digestVerified) diagnostics.push(diagnostic("error", "ASSET_DIGEST_MISMATCH", binding.assetKey, "Asset source digest does not match the pinned config bytes."));
  if (binding.source.kind !== binding.kind) diagnostics.push(diagnostic("error", "ASSET_SOURCE_KIND_MISMATCH", binding.assetKey, `Asset kind ${binding.kind} cannot consume source kind ${binding.source.kind}.`));
  if (!binding.source.allowed) diagnostics.push(diagnostic("error", "ASSET_SOURCE_NOT_ALLOWED", binding.assetKey, "Asset source is not trusted for materialization."));
  if (binding.destination.strategy === "emit-file" && binding.rollback !== "snapshot") {
    diagnostics.push(diagnostic("error", "ASSET_ROLLBACK_INVALID", binding.assetKey, "emit-file assets require snapshot rollback."));
  }
  if ((binding.destination.strategy === "install-local" || binding.destination.strategy === "install-marketplace") && binding.rollback !== "installer-receipt") {
    diagnostics.push(diagnostic("error", "ASSET_ROLLBACK_INVALID", binding.assetKey, "installer assets require installer-receipt rollback."));
  }
  return { pathSafe, digestVerified, collisionFree: true, sourceAllowed: binding.source.allowed };
}

function validateCollisions(items: AssetPlanItem[], diagnostics: AssetPlanDiagnostic[]): void {
  const exact = new Map<string, AssetPlanItem>();
  const destinations = new Map<string, AssetPlanItem>();
  for (const item of items) {
    const duplicate = exact.get(item.exactOnceKey);
    if (duplicate) diagnostics.push(diagnostic("error", "ASSET_EXACT_ONCE_DUPLICATE", item.assetKey, `${item.assetKey} duplicates exact-once key ${duplicate.assetKey}.`));
    else exact.set(item.exactOnceKey, item);
    if (item.action === "skip" || !item.validation.pathSafe) continue;
    const destinationKey = `${item.destination.root}|${safeRelativePath(item.destination.relativePath)}`;
    const collision = destinations.get(destinationKey);
    if (collision) {
      item.validation.collisionFree = false;
      collision.validation.collisionFree = false;
      diagnostics.push(diagnostic("error", "ASSET_DESTINATION_COLLISION", item.assetKey, `${item.assetKey} collides with ${collision.assetKey} at ${item.destination.relativePath}.`));
    } else destinations.set(destinationKey, item);
  }
}

function compareBindings(left: ProfileAssetBinding, right: ProfileAssetBinding): number {
  return left.sort_order - right.sort_order
    || left.binding.assetKey.localeCompare(right.binding.assetKey)
    || left.source_config_id.localeCompare(right.source_config_id);
}

function safeRelativePath(value: string): string {
  if (!value.trim() || value.includes("\\")) throw new Error(`Asset relative path is invalid: ${value}`);
  const normalized = posix.normalize(value);
  if (normalized === "." || posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Asset relative path escapes its destination root: ${value}`);
  }
  return normalized;
}

function diagnostic(severity: AssetPlanDiagnostic["severity"], code: string, assetKey: string | null, message: string): AssetPlanDiagnostic {
  return { severity, code, assetKey, message };
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error("Profile asset binding is not valid JSON."); }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function stableJson(value: unknown): string {
  const canonical = (entry: unknown): unknown => Array.isArray(entry)
    ? entry.map(canonical)
    : entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]))
      : entry;
  return JSON.stringify(canonical(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
