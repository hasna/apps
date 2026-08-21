import { createHash } from "node:crypto";
import type {
  Config,
  ConfigAgent,
  InstructionActivation,
  InstructionActivationMode,
  InstructionFallback,
  ProfileConfigBinding,
  ProfileConfigBindingSpec,
  ProfileAssetBinding,
} from "../types/index.js";
import {
  CONFIG_AGENTS,
  INSTRUCTION_ACTIVATION_MODES,
  INSTRUCTION_FALLBACKS,
  PROFILE_CONFIG_BINDING_SCHEMA,
} from "../types/index.js";
import type {
  SessionInstructionSource,
  SessionRenderInput,
  SessionRenderPlan,
  SessionProviderSurface,
  SessionRenderTool,
} from "./session-render.js";
import { planSessionRender, sourceFromConfig } from "./session-render.js";
import { providerVersionSatisfies } from "./provider-version.js";
import { compileAssetPlan, type AssetPlanMode } from "./asset-plan.js";

export { providerVersionSatisfies } from "./provider-version.js";

export const INSTRUCTION_GRAPH_PLAN_SCHEMA = "hasna.instructions.render-plan/v1" as const;
export const PROVIDER_CAPABILITY_SCHEMA = "hasna.instructions.provider-capability/v1" as const;

export interface ProviderCapability {
  schema: typeof PROVIDER_CAPABILITY_SCHEMA;
  provider: SessionRenderTool;
  descriptor_version: number;
  provider_version_range: string;
  provider_variant: string;
  default_variant: boolean;
  selected_representation: string;
  loading_path: string;
  session_surface?: SessionProviderSurface;
  asset_surface: string;
  activation_modes: readonly InstructionActivationMode[];
  native_imports: boolean;
  conditional_artifacts: boolean;
  supported_fallbacks: readonly InstructionFallback[];
}

const COMMON_FALLBACKS = ["fail", "flatten", "promote-always", "omit"] as const;

function capability(
  provider: SessionRenderTool,
  providerVersionRange: string,
  selectedRepresentation: string,
  loadingPath: string,
  options: Partial<Pick<ProviderCapability, "provider_variant" | "default_variant" | "session_surface" | "asset_surface" | "activation_modes" | "native_imports" | "conditional_artifacts">> = {},
): ProviderCapability {
  return Object.freeze({
    schema: PROVIDER_CAPABILITY_SCHEMA,
    provider,
    descriptor_version: 1,
    provider_version_range: providerVersionRange,
    provider_variant: options.provider_variant ?? "default",
    default_variant: options.default_variant ?? true,
    selected_representation: selectedRepresentation,
    loading_path: loadingPath,
    asset_surface: options.asset_surface ?? "cli",
    activation_modes: options.activation_modes ?? (["always"] as const),
    native_imports: options.native_imports ?? false,
    conditional_artifacts: options.conditional_artifacts ?? false,
    supported_fallbacks: COMMON_FALLBACKS,
    ...(options.session_surface ? { session_surface: options.session_surface } : {}),
  });
}

/**
 * Code-owned and versioned on purpose: provider output capabilities are an
 * implementation contract, not mutable profile data. Provider releases are
 * matched independently through provider_version_range.
 */
const DEFAULT_PROVIDER_CAPABILITIES: Readonly<Record<SessionRenderTool, ProviderCapability>> = Object.freeze({
  claude: capability("claude", ">=1.0.0", "native-import", "CLAUDE.md @ imports plus path-gated rules", {
    activation_modes: ["always", "glob"],
    native_imports: true,
    conditional_artifacts: true,
    asset_surface: "code",
  }),
  codex: capability("codex", ">=0.1.0", "flattened", "AGENTS.md", { asset_surface: "cli" }),
  cursor: capability("cursor", ">=1.0.0", "cursor-rule", ".cursor/rules/*.mdc", { activation_modes: ["always", "glob"], conditional_artifacts: true, asset_surface: "ide" }),
  opencode: capability("opencode", ">=1.0.0", "managed-fragment", "opencode.json instructions", { provider_variant: "v1-instructions", session_surface: "opencode-config-instructions" }),
  codewith: capability("codewith", ">=0.1.0", "flattened", "CODEWITH.md"),
  qwen: capability("qwen", ">=0.1.0", "flattened", "QWEN.md"),
  aicopilot: capability("aicopilot", ">=0.1.0", "flattened", "AICOPILOT.md"),
  antigravity: capability("antigravity", ">=1.0.0", "provider-rule", ".agents/rules/*.md", { asset_surface: "project" }),
  grok: capability("grok", ">=1.0.0", "flattened", "AGENTS.md", { asset_surface: "build" }),
  copilot: capability("copilot", ">=1.0.0", "flattened", ".github/copilot-instructions.md", {
    provider_variant: "repository",
    session_surface: "copilot-repository-instructions",
    asset_surface: "repository",
  }),
  devin: capability("devin", ">=1.0.0", "provider-rule", ".devin/rules/*.md", {
    activation_modes: ["always", "glob", "model", "manual"],
    conditional_artifacts: true,
    asset_surface: "repository",
  }),
  "windsurf-legacy": capability("windsurf-legacy", ">=1.0.0", "provider-rule", ".windsurf/rules/*.md", {
    activation_modes: ["always", "glob", "model", "manual"],
    conditional_artifacts: true,
    asset_surface: "legacy",
  }),
  cline: capability("cline", ">=1.0.0", "provider-rule", ".clinerules/*.md", {
    provider_variant: "ide",
    asset_surface: "ide",
  }),
});

export const PROVIDER_CAPABILITY_DESCRIPTORS: readonly ProviderCapability[] = Object.freeze([
  ...Object.values(DEFAULT_PROVIDER_CAPABILITIES),
  capability("opencode", "*", "flattened", "AGENTS.md", {
    provider_variant: "v2-agents",
    default_variant: false,
    session_surface: "opencode-agents-md",
  }),
  capability("copilot", ">=1.0.0", "conditional-rule", ".github/instructions/*.instructions.md", {
    provider_variant: "path-instructions",
    default_variant: false,
    session_surface: "copilot-path-instructions",
    activation_modes: ["always", "glob"],
    conditional_artifacts: true,
    asset_surface: "repository",
  }),
  capability("cline", ">=1.0.0", "provider-rule", ".clinerules/*.md", {
    provider_variant: "cli",
    default_variant: false,
    asset_surface: "cli",
  }),
  capability("cline", ">=1.0.0", "provider-rule", ".clinerules/*.md", {
    provider_variant: "sdk",
    default_variant: false,
    asset_surface: "cli",
  }),
]);

/** Backward-compatible default descriptor lookup for callers without variants. */
export const PROVIDER_CAPABILITIES = DEFAULT_PROVIDER_CAPABILITIES;

export interface InstructionGraphContext {
  provider: SessionRenderTool;
  provider_version: string;
  provider_variant?: string;
  model?: string;
  path?: string;
  manual?: string[];
}

export interface InstructionGraphDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  config_id: string | null;
  message: string;
}

export interface InstructionGraphUnit {
  unit_id: string;
  config_id: string;
  config_slug: string;
  config_version: number;
  sort_order: number;
  activation: InstructionActivation;
  effective_activation: InstructionActivation;
  fallback: InstructionFallback;
  required: boolean;
  content_sha256: string;
  dependencies: string[];
}

export interface InstructionGraphArtifact {
  artifact_id: string;
  unit_id: string;
  provider: SessionRenderTool;
  representation: string;
  loading_path: string;
}

export interface InstructionGraphRenderPlan {
  schema: typeof INSTRUCTION_GRAPH_PLAN_SCHEMA;
  profile_id: string;
  provider: SessionRenderTool;
  provider_version: string;
  capability_descriptor_version: number;
  capability: {
    schema: typeof PROVIDER_CAPABILITY_SCHEMA;
    descriptor_version: number;
    provider_version_range: string;
    provider_variant: string;
    selected_representation: string;
    loading_path: string;
    session_surface?: SessionProviderSurface;
    asset_surface: string;
  };
  units: InstructionGraphUnit[];
  artifacts: InstructionGraphArtifact[];
  diagnostics: InstructionGraphDiagnostic[];
  source_hash: string;
}

export interface CompiledInstructionGraph {
  plan: InstructionGraphRenderPlan;
  sources: SessionInstructionSource[];
  capability: ProviderCapability;
}

export interface ProfileSessionRenderPlan extends SessionRenderPlan {
  instructionGraph: InstructionGraphRenderPlan;
}

export function legacyProfileConfigBinding(): ProfileConfigBindingSpec {
  return {
    schema: PROFILE_CONFIG_BINDING_SCHEMA,
    activation: { mode: "always" },
    required: true,
    fallback: "fail",
  };
}

export function normalizeProfileConfigBinding(value: unknown): ProfileConfigBindingSpec {
  if (value === null || value === undefined || value === "") return legacyProfileConfigBinding();
  const raw = typeof value === "string" ? parseBindingJson(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Profile config binding must be an object.");
  const record = raw as Record<string, unknown>;
  if (record["schema"] !== PROFILE_CONFIG_BINDING_SCHEMA) throw new Error(`Unsupported profile config binding schema: ${String(record["schema"])}`);
  const activation = normalizeActivation(record["activation"]);
  const required = record["required"] === undefined ? true : record["required"];
  if (typeof required !== "boolean") throw new Error("Profile config binding required must be boolean.");
  const fallback = record["fallback"];
  if (!INSTRUCTION_FALLBACKS.includes(fallback as InstructionFallback)) throw new Error(`Invalid instruction fallback: ${String(fallback)}`);
  const providers = normalizeProviders(record["providers"]);
  return {
    schema: PROFILE_CONFIG_BINDING_SCHEMA,
    activation,
    required,
    fallback: fallback as InstructionFallback,
    ...(providers ? { providers } : {}),
    ...normalizeEdges(record, "depends_on"),
    ...normalizeEdges(record, "replaces"),
    ...normalizeEdges(record, "conflicts_with"),
  };
}

function parseBindingJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error("Profile config binding is not valid JSON."); }
}

function normalizeActivation(value: unknown): InstructionActivation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Profile config binding activation is required.");
  const record = value as Record<string, unknown>;
  if (!INSTRUCTION_ACTIVATION_MODES.includes(record["mode"] as InstructionActivationMode)) {
    throw new Error(`Invalid instruction activation mode: ${String(record["mode"])}`);
  }
  const mode = record["mode"] as InstructionActivationMode;
  const globs = stringArray(record["globs"], "activation.globs");
  const models = stringArray(record["models"], "activation.models");
  if (mode === "glob" && (!globs || globs.length === 0)) throw new Error("Glob activation requires at least one glob.");
  if (mode === "model" && (!models || models.length === 0)) throw new Error("Model activation requires at least one model.");
  return {
    mode,
    ...(globs ? { globs } : {}),
    ...(models ? { models } : {}),
    ...(optionalString(record["description"], "activation.description") ? { description: record["description"] as string } : {}),
    ...(optionalString(record["directory_scope"], "activation.directory_scope") ? { directory_scope: record["directory_scope"] as string } : {}),
  };
}

function normalizeProviders(value: unknown): ProfileConfigBindingSpec["providers"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Profile config binding providers must be an array.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Provider selector must be an object.");
    const record = entry as Record<string, unknown>;
    const provider = requiredString(record["provider"], "provider selector provider") as ConfigAgent;
    if (!CONFIG_AGENTS.includes(provider)) throw new Error(`Invalid provider selector provider: ${provider}`);
    const versionRange = optionalString(record["version_range"], "provider selector version_range");
    if (versionRange) providerVersionSatisfies("0.0.0", versionRange);
    return { provider, ...(versionRange ? { version_range: versionRange } : {}) };
  });
}

function normalizeEdges(record: Record<string, unknown>, key: "depends_on" | "replaces" | "conflicts_with"): Partial<ProfileConfigBindingSpec> {
  const values = stringArray(record[key], key);
  return values ? { [key]: [...new Set(values)].sort() } : {};
}

function stringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error(`${label} must be an array of non-empty strings.`);
  return value.map((entry) => entry.trim());
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

export function selectProviderCapability(context: InstructionGraphContext): ProviderCapability {
  const candidates = PROVIDER_CAPABILITY_DESCRIPTORS.filter((entry) => entry.provider === context.provider);
  const requestedVariant = context.provider_variant?.trim();
  if (context.provider_variant !== undefined && !requestedVariant) {
    throw new InstructionGraphValidationError([
      errorDiagnostic(null, "PROVIDER_VARIANT_INVALID", "Provider variant cannot be empty."),
    ]);
  }
  const selected = requestedVariant
    ? candidates.find((entry) => entry.provider_variant === requestedVariant)
    : candidates.find((entry) => entry.default_variant);
  if (!selected) {
    const available = candidates.map((entry) => entry.provider_variant).sort().join(", ");
    throw new InstructionGraphValidationError([
      errorDiagnostic(null, "PROVIDER_VARIANT_UNSUPPORTED", `${context.provider} variant ${requestedVariant ?? "<default>"} is unsupported; available variants: ${available}.`),
    ]);
  }
  return selected;
}

export function compileInstructionGraph(input: {
  profile_id: string;
  configs: Config[];
  bindings: ProfileConfigBinding[];
  context: InstructionGraphContext;
  capability?: ProviderCapability;
}): CompiledInstructionGraph {
  const capability = input.capability ?? selectProviderCapability(input.context);
  if (capability.provider !== input.context.provider) throw new Error(`Provider capability ${capability.provider} cannot compile ${input.context.provider}.`);
  if (input.context.provider_variant && capability.provider_variant !== input.context.provider_variant) {
    throw new InstructionGraphValidationError([
      errorDiagnostic(null, "PROVIDER_VARIANT_MISMATCH", `${input.context.provider} capability variant ${capability.provider_variant} cannot compile requested variant ${input.context.provider_variant}.`),
    ]);
  }
  const diagnostics: InstructionGraphDiagnostic[] = [];
  if (!providerVersionSatisfies(input.context.provider_version, capability.provider_version_range)) {
    diagnostics.push(errorDiagnostic(null, "PROVIDER_VERSION_UNSUPPORTED", `${input.context.provider} ${input.context.provider_version} does not satisfy capability range ${capability.provider_version_range}.`));
  }
  const configs = new Map(input.configs.map((config) => [config.id, config]));
  const slugs = new Map(input.configs.map((config) => [config.slug, config.id]));
  if (configs.size !== input.configs.length) throw new Error("Instruction graph contains duplicate config identities.");
  const normalizedBindings = input.bindings.map((row) => ({ ...row, binding: normalizeProfileConfigBinding(row.binding) }));
  const rows = new Map<string, ProfileConfigBinding>();
  for (const row of normalizedBindings) {
    if (row.profile_id !== input.profile_id) throw new Error(`Binding ${row.config_id} belongs to another profile.`);
    if (!configs.has(row.config_id)) throw new Error(`Binding references missing config: ${row.config_id}`);
    if (rows.has(row.config_id)) throw new Error(`Duplicate profile binding for config: ${row.config_id}`);
    rows.set(row.config_id, row);
  }
  // Legacy callers that supply configs but not the new rows retain historical order.
  input.configs.forEach((config, index) => {
    if (!rows.has(config.id)) rows.set(config.id, { profile_id: input.profile_id, config_id: config.id, sort_order: index, binding: legacyProfileConfigBinding() });
  });
  const resolveRef = (ref: string): string | null => configs.has(ref) ? ref : (slugs.get(ref) ?? null);
  const selected = new Set<string>();
  const effective = new Map<string, InstructionActivation>();
  for (const [configId, row] of rows) {
    const config = configs.get(configId)!;
    const binding = row.binding;
    const selector = binding.providers?.find((entry) => entry.provider === input.context.provider || entry.provider === "global");
    if (binding.providers?.length && !selector) continue;
    if (selector?.version_range && !providerVersionSatisfies(input.context.provider_version, selector.version_range)) {
      diagnostics.push({ severity: binding.required ? "error" : "warning", code: "PROVIDER_SELECTOR_VERSION_MISMATCH", config_id: configId, message: `${config.slug} requires ${input.context.provider} ${selector.version_range}; current version is ${input.context.provider_version}.` });
      continue;
    }
    if (!activationMatches(binding.activation, config, input.context)) continue;
    if (capability.activation_modes.includes(binding.activation.mode)) {
      selected.add(configId);
      effective.set(configId, binding.activation);
      continue;
    }
    if (!capability.supported_fallbacks.includes(binding.fallback)) {
      diagnostics.push(errorDiagnostic(configId, "FALLBACK_UNDECLARED", `${input.context.provider} capability does not declare fallback ${binding.fallback}.`));
      continue;
    }
    if (binding.fallback === "fail" || (binding.required && binding.fallback === "omit")) {
      diagnostics.push(errorDiagnostic(configId, "REQUIRED_CAPABILITY_UNSUPPORTED", `${config.slug} requires unsupported ${binding.activation.mode} activation on ${input.context.provider}; fallback=${binding.fallback}.`));
      continue;
    }
    if (binding.fallback === "omit") {
      diagnostics.push({ severity: "warning", code: "OPTIONAL_BINDING_OMITTED", config_id: configId, message: `${config.slug} was omitted because ${input.context.provider} does not support ${binding.activation.mode}.` });
      continue;
    }
    selected.add(configId);
    effective.set(configId, { ...binding.activation, mode: "always" });
    diagnostics.push({ severity: "warning", code: "FALLBACK_APPLIED", config_id: configId, message: `${config.slug} ${binding.activation.mode} activation used ${binding.fallback} on ${input.context.provider}.` });
  }
  applyReplacements(selected, rows, configs, resolveRef, diagnostics);
  const dependencies = new Map<string, string[]>();
  for (const configId of selected) {
    const row = rows.get(configId)!;
    const deps: string[] = [];
    for (const raw of row.binding.depends_on ?? []) {
      const target = resolveRef(raw);
      if (!target) diagnostics.push(errorDiagnostic(configId, "GRAPH_TARGET_MISSING", `Dependency target does not exist: ${raw}`));
      else if (!selected.has(target)) diagnostics.push(errorDiagnostic(configId, "DEPENDENCY_NOT_SELECTED", `${configs.get(configId)!.slug} depends on inactive ${configs.get(target)!.slug}.`));
      else deps.push(target);
    }
    for (const raw of row.binding.conflicts_with ?? []) {
      const target = resolveRef(raw);
      if (!target) diagnostics.push(errorDiagnostic(configId, "GRAPH_TARGET_MISSING", `Conflict target does not exist: ${raw}`));
      else if (selected.has(target)) diagnostics.push(errorDiagnostic(configId, "GRAPH_CONFLICT", `${configs.get(configId)!.slug} conflicts with ${configs.get(target)!.slug}.`));
    }
    dependencies.set(configId, [...new Set(deps)]);
  }
  const order = topologicalOrder(selected, dependencies, rows, configs, diagnostics);
  if (diagnostics.some((entry) => entry.severity === "error")) throw new InstructionGraphValidationError(diagnostics);
  const units: InstructionGraphUnit[] = order.map((configId) => {
    const config = configs.get(configId)!;
    const row = rows.get(configId)!;
    return {
      unit_id: `${input.profile_id}:${config.id}`,
      config_id: config.id,
      config_slug: config.slug,
      config_version: config.version,
      sort_order: row.sort_order,
      activation: row.binding.activation,
      effective_activation: effective.get(configId)!,
      fallback: row.binding.fallback,
      required: row.binding.required,
      content_sha256: sha256(config.content),
      dependencies: dependencies.get(configId) ?? [],
    };
  });
  const artifacts: InstructionGraphArtifact[] = units.map((unit) => ({
    artifact_id: `${input.context.provider}:${unit.unit_id}`,
    unit_id: unit.unit_id,
    provider: input.context.provider,
    representation: unit.effective_activation.mode === "glob"
      ? "conditional-rule"
      : capability.selected_representation,
    loading_path: capability.loading_path,
  }));
  assertExactOnce(units, artifacts);
  const sources = units.map((unit, index) => {
    const config = configs.get(unit.config_id)!;
    return sourceForUnit(config, unit, index);
  });
  const planWithoutHash = {
    schema: INSTRUCTION_GRAPH_PLAN_SCHEMA,
    profile_id: input.profile_id,
    provider: input.context.provider,
    provider_version: input.context.provider_version,
    capability_descriptor_version: capability.descriptor_version,
    capability: {
      schema: capability.schema,
      descriptor_version: capability.descriptor_version,
      provider_version_range: capability.provider_version_range,
      provider_variant: capability.provider_variant,
      selected_representation: capability.selected_representation,
      loading_path: capability.loading_path,
      ...(capability.session_surface ? { session_surface: capability.session_surface } : {}),
      asset_surface: capability.asset_surface,
    },
    units,
    artifacts,
    diagnostics,
  };
  return {
    plan: deepFreeze({ ...planWithoutHash, source_hash: sha256(stableJson(planWithoutHash)) }),
    sources,
    capability,
  };
}

export function planProfileSessionRender(input: Omit<SessionRenderInput, "sources"> & {
  profile_id: string;
  provider_version: string;
  configs: Config[];
  bindings: ProfileConfigBinding[];
  asset_configs?: Config[];
  asset_bindings?: ProfileAssetBinding[];
  asset_plan_mode?: AssetPlanMode;
  asset_scope?: "global" | "project" | "session";
  asset_surface?: string;
  allow_asset_installers?: boolean;
  graph_context?: Omit<InstructionGraphContext, "provider" | "provider_version">;
}): ProfileSessionRenderPlan {
  const compiled = compileInstructionGraph({
    profile_id: input.profile_id,
    configs: input.configs,
    bindings: input.bindings,
    context: { provider: input.tool, provider_version: input.provider_version, ...input.graph_context },
  });
  const assetPlan = compileAssetPlan({
    profileId: input.profile_id,
    provider: input.tool,
    providerVersion: input.provider_version,
    surface: input.asset_surface ?? compiled.capability.asset_surface,
    scope: input.asset_scope ?? (input.projectRoot ? "project" : "session"),
    mode: input.asset_plan_mode ?? "dry-run",
    configs: input.asset_configs ?? [],
    bindings: input.asset_bindings ?? [],
    allowInstallers: input.allow_asset_installers,
  });
  const {
    profile_id: _profileId,
    provider_version: _providerVersion,
    configs: _configs,
    bindings: _bindings,
    asset_configs: _assetConfigs,
    asset_bindings: _assetBindings,
    asset_plan_mode: _assetPlanMode,
    asset_scope: _assetScope,
    asset_surface: _assetSurface,
    allow_asset_installers: _allowAssetInstallers,
    graph_context: _graphContext,
    assetPlan: _callerAssetPlan,
    assetContents: _callerAssetContents,
    ...renderInput
  } = input;
  if (renderInput.providerSurface && renderInput.providerSurface !== compiled.capability.session_surface) {
    throw new InstructionGraphValidationError([
      errorDiagnostic(null, "PROVIDER_SURFACE_MISMATCH", `Requested render surface ${renderInput.providerSurface} does not match capability ${compiled.capability.provider_variant}.`),
    ]);
  }
  return deepFreeze({
    ...planSessionRender({
      ...renderInput,
      ...(compiled.capability.session_surface ? { providerSurface: compiled.capability.session_surface } : {}),
      sources: compiled.sources,
      assetPlan,
      assetContents: Object.fromEntries((input.asset_configs ?? []).map((config) => [config.id, config.content])),
    }),
    instructionGraph: compiled.plan,
  });
}

function sourceForUnit(config: Config, unit: InstructionGraphUnit, order: number): SessionInstructionSource {
  const source = sourceFromConfig(config, order);
  return {
    ...source,
    globs: unit.effective_activation.mode === "glob" ? unit.effective_activation.globs : undefined,
    provenance: { ...(source.provenance ?? {}), profileBinding: { unitId: unit.unit_id, configId: unit.config_id, configVersion: unit.config_version } },
    metadata: { ...(source.metadata ?? {}), activation: unit.effective_activation, originalActivation: unit.activation, fallback: unit.fallback, required: unit.required },
  };
}

function activationMatches(activation: InstructionActivation, config: Config, context: InstructionGraphContext): boolean {
  if (activation.mode === "always" || activation.mode === "glob") return true;
  if (activation.mode === "model") return Boolean(context.model && activation.models?.includes(context.model));
  return (context.manual ?? []).some((entry) => entry === config.id || entry === config.slug);
}

function applyReplacements(
  selected: Set<string>,
  rows: Map<string, ProfileConfigBinding>,
  configs: Map<string, Config>,
  resolveRef: (ref: string) => string | null,
  diagnostics: InstructionGraphDiagnostic[],
): void {
  const initiallySelected = new Set(selected);
  const stableIds = [...initiallySelected].sort((left, right) => {
    return configs.get(left)!.slug.localeCompare(configs.get(right)!.slug) || left.localeCompare(right);
  });
  const edges = new Map<string, string[]>();
  for (const configId of stableIds) {
    const targets: string[] = [];
    for (const raw of [...(rows.get(configId)!.binding.replaces ?? [])].sort()) {
      const target = resolveRef(raw);
      if (!target) {
        diagnostics.push(errorDiagnostic(configId, "GRAPH_TARGET_MISSING", `Replacement target does not exist: ${raw}`));
      } else if (initiallySelected.has(target)) {
        targets.push(target);
      }
    }
    edges.set(configId, [...new Set(targets)].sort((left, right) => stableIds.indexOf(left) - stableIds.indexOf(right)));
  }

  const state = new Map<string, 0 | 1 | 2>();
  const reportedCycles = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    const status = state.get(id) ?? 0;
    if (status === 2) return;
    if (status === 1) {
      const start = trail.indexOf(id);
      const cycleIds = canonicalReplacementCycle([...trail.slice(start), id], configs);
      const key = cycleIds.slice(0, -1).sort().join("\0");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        diagnostics.push(errorDiagnostic(cycleIds[0]!, "GRAPH_REPLACEMENT_CYCLE", `Instruction replacement cycle: ${cycleIds.map((entry) => configs.get(entry)!.slug).join(" -> ")}`));
      }
      return;
    }
    state.set(id, 1);
    for (const target of edges.get(id) ?? []) visit(target, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of stableIds) visit(id, []);
  if (reportedCycles.size > 0) return;

  // Resolve every edge against the same initial selection, then remove all
  // targets together. A replaced node therefore still contributes its own
  // replacement edges, making A -> B -> C collapse to A regardless of input.
  for (const source of stableIds) {
    for (const target of edges.get(source) ?? []) {
      selected.delete(target);
      diagnostics.push({ severity: "info", code: "GRAPH_REPLACED", config_id: target, message: `${configs.get(source)!.slug} replaced ${configs.get(target)!.slug}.` });
    }
  }
}

function canonicalReplacementCycle(cycle: string[], configs: Map<string, Config>): string[] {
  const members = cycle.slice(0, -1);
  let best = 0;
  for (let index = 1; index < members.length; index++) {
    const current = `${configs.get(members[index]!)!.slug}\0${members[index]}`;
    const candidate = `${configs.get(members[best]!)!.slug}\0${members[best]}`;
    if (current.localeCompare(candidate) < 0) best = index;
  }
  const rotated = [...members.slice(best), ...members.slice(0, best)];
  return [...rotated, rotated[0]!];
}

function topologicalOrder(
  selected: Set<string>,
  dependencies: Map<string, string[]>,
  rows: Map<string, ProfileConfigBinding>,
  configs: Map<string, Config>,
  diagnostics: InstructionGraphDiagnostic[],
): string[] {
  const state = new Map<string, 0 | 1 | 2>();
  const output: string[] = [];
  const stable = [...selected].sort((left, right) => {
    const delta = rows.get(left)!.sort_order - rows.get(right)!.sort_order;
    return delta || configs.get(left)!.slug.localeCompare(configs.get(right)!.slug) || left.localeCompare(right);
  });
  const visit = (id: string, trail: string[]) => {
    const status = state.get(id) ?? 0;
    if (status === 2) return;
    if (status === 1) {
      const start = trail.indexOf(id);
      const cycle = [...trail.slice(start), id].map((entry) => configs.get(entry)!.slug).join(" -> ");
      diagnostics.push(errorDiagnostic(id, "GRAPH_CYCLE", `Instruction dependency cycle: ${cycle}`));
      return;
    }
    state.set(id, 1);
    const deps = [...(dependencies.get(id) ?? [])].sort((left, right) => stable.indexOf(left) - stable.indexOf(right));
    for (const dep of deps) visit(dep, [...trail, id]);
    state.set(id, 2);
    output.push(id);
  };
  for (const id of stable) visit(id, []);
  return [...new Set(output)];
}

function assertExactOnce(units: InstructionGraphUnit[], artifacts: InstructionGraphArtifact[]): void {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) counts.set(artifact.unit_id, (counts.get(artifact.unit_id) ?? 0) + 1);
  const invalid = units.filter((unit) => counts.get(unit.unit_id) !== 1);
  if (invalid.length > 0 || counts.size !== units.length) throw new Error(`Instruction graph exact-once artifact coverage failed: ${invalid.map((unit) => unit.config_slug).join(", ")}`);
  if (new Set(artifacts.map((artifact) => artifact.artifact_id)).size !== artifacts.length) throw new Error("Instruction graph artifact identity collision.");
}

function errorDiagnostic(configId: string | null, code: string, message: string): InstructionGraphDiagnostic {
  return { severity: "error", code, config_id: configId, message };
}

export class InstructionGraphValidationError extends Error {
  constructor(readonly diagnostics: InstructionGraphDiagnostic[]) {
    super(diagnostics.filter((entry) => entry.severity === "error").map((entry) => `${entry.code}: ${entry.message}`).join("; "));
    this.name = "InstructionGraphValidationError";
  }
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
