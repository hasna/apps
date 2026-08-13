import { createHash } from "node:crypto";
import type {
  Config,
  ConfigAgent,
  InstructionActivation,
  InstructionActivationMode,
  InstructionFallback,
  ProfileConfigBinding,
  ProfileConfigBindingSpec,
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
  SessionRenderTool,
} from "./session-render.js";
import { planSessionRender, sourceFromConfig } from "./session-render.js";

export const INSTRUCTION_GRAPH_PLAN_SCHEMA = "hasna.instructions.render-plan/v1" as const;
export const PROVIDER_CAPABILITY_SCHEMA = "hasna.instructions.provider-capability/v1" as const;

export interface ProviderCapability {
  schema: typeof PROVIDER_CAPABILITY_SCHEMA;
  provider: SessionRenderTool;
  descriptor_version: number;
  provider_version_range: string;
  activation_modes: readonly InstructionActivationMode[];
  native_imports: boolean;
  conditional_artifacts: boolean;
  supported_fallbacks: readonly InstructionFallback[];
}

const COMMON_FALLBACKS = ["fail", "flatten", "promote-always", "omit"] as const;

/**
 * Code-owned and versioned on purpose: provider output capabilities are an
 * implementation contract, not mutable profile data. Provider releases are
 * matched independently through provider_version_range.
 */
export const PROVIDER_CAPABILITIES: Readonly<Record<SessionRenderTool, ProviderCapability>> = Object.freeze({
  claude: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "claude", descriptor_version: 1, provider_version_range: ">=1.0.0", activation_modes: ["always"] as const, native_imports: true, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  codex: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "codex", descriptor_version: 1, provider_version_range: ">=0.1.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  cursor: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "cursor", descriptor_version: 1, provider_version_range: ">=1.0.0", activation_modes: ["always", "glob"] as const, native_imports: false, conditional_artifacts: true, supported_fallbacks: COMMON_FALLBACKS }),
  opencode: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "opencode", descriptor_version: 1, provider_version_range: ">=1.0.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  codewith: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "codewith", descriptor_version: 1, provider_version_range: ">=0.1.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  qwen: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "qwen", descriptor_version: 1, provider_version_range: ">=0.1.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  aicopilot: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "aicopilot", descriptor_version: 1, provider_version_range: ">=0.1.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
  antigravity: Object.freeze({ schema: PROVIDER_CAPABILITY_SCHEMA, provider: "antigravity", descriptor_version: 1, provider_version_range: ">=1.0.0", activation_modes: ["always"] as const, native_imports: false, conditional_artifacts: false, supported_fallbacks: COMMON_FALLBACKS }),
});

export interface InstructionGraphContext {
  provider: SessionRenderTool;
  provider_version: string;
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
  representation: "native-import" | "conditional-rule" | "flattened";
}

export interface InstructionGraphRenderPlan {
  schema: typeof INSTRUCTION_GRAPH_PLAN_SCHEMA;
  profile_id: string;
  provider: SessionRenderTool;
  provider_version: string;
  capability_descriptor_version: number;
  units: InstructionGraphUnit[];
  artifacts: InstructionGraphArtifact[];
  diagnostics: InstructionGraphDiagnostic[];
  source_hash: string;
}

export interface CompiledInstructionGraph {
  plan: InstructionGraphRenderPlan;
  sources: SessionInstructionSource[];
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
    if (versionRange) versionSatisfies("0.0.0", versionRange);
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

export function compileInstructionGraph(input: {
  profile_id: string;
  configs: Config[];
  bindings: ProfileConfigBinding[];
  context: InstructionGraphContext;
  capability?: ProviderCapability;
}): CompiledInstructionGraph {
  const capability = input.capability ?? PROVIDER_CAPABILITIES[input.context.provider];
  if (capability.provider !== input.context.provider) throw new Error(`Provider capability ${capability.provider} cannot compile ${input.context.provider}.`);
  const diagnostics: InstructionGraphDiagnostic[] = [];
  if (!versionSatisfies(input.context.provider_version, capability.provider_version_range)) {
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
    if (selector?.version_range && !versionSatisfies(input.context.provider_version, selector.version_range)) {
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
      : capability.native_imports ? "native-import" : "flattened",
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
    units,
    artifacts,
    diagnostics,
  };
  return {
    plan: deepFreeze({ ...planWithoutHash, source_hash: sha256(stableJson(planWithoutHash)) }),
    sources,
  };
}

export function planProfileSessionRender(input: Omit<SessionRenderInput, "sources"> & {
  profile_id: string;
  provider_version: string;
  configs: Config[];
  bindings: ProfileConfigBinding[];
  graph_context?: Omit<InstructionGraphContext, "provider" | "provider_version">;
}): ProfileSessionRenderPlan {
  const compiled = compileInstructionGraph({
    profile_id: input.profile_id,
    configs: input.configs,
    bindings: input.bindings,
    context: { provider: input.tool, provider_version: input.provider_version, ...input.graph_context },
  });
  const { profile_id: _profileId, provider_version: _providerVersion, configs: _configs, bindings: _bindings, graph_context: _graphContext, ...renderInput } = input;
  return deepFreeze({ ...planSessionRender({ ...renderInput, sources: compiled.sources }), instructionGraph: compiled.plan });
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

function versionSatisfies(version: string, range: string): boolean {
  const current = parseVersion(version);
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;
  return trimmed.split(/\s+/).every((part) => {
    const match = /^(>=|<=|>|<|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(part);
    if (!match) throw new Error(`Unsupported provider version range: ${range}`);
    const target: [number, number, number] = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
    const cmp = compareVersion(current, target);
    switch (match[1] ?? "=") {
      case ">=": return cmp >= 0;
      case "<=": return cmp <= 0;
      case ">": return cmp > 0;
      case "<": return cmp < 0;
      case "^": return cmp >= 0 && current[0] === target[0];
      case "~": return cmp >= 0 && current[0] === target[0] && current[1] === target[1];
      default: return cmp === 0;
    }
  });
}

function parseVersion(value: string): [number, number, number] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid provider version: ${value}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
