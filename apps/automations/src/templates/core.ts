import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "@hasna/actions";
import type {
  AutomationActionStep,
  AutomationRecord,
  AutomationSpec,
  AutomationStatus,
  AutomationTrigger,
} from "../types.js";
import { AUTOMATION_SCHEMA_VERSION } from "../types.js";
import { validateAutomationSpec } from "../lib/store.js";

export const AUTOMATION_TEMPLATE_SCHEMA_VERSION = "1.0" as const;
export const AUTOMATION_TEMPLATE_RECEIPT_SCHEMA_VERSION = "1.0" as const;

export const AUTOMATION_TEMPLATE_INPUT_TYPES = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
] as const;

export type AutomationTemplateInputType = (typeof AUTOMATION_TEMPLATE_INPUT_TYPES)[number];

export interface AutomationTemplateInputDefinition {
  type: AutomationTemplateInputType;
  required?: boolean;
  default?: JsonValue;
  description?: string;
}

/** A relative JSON Pointer into the completed action result. Empty means the whole result. */
export interface AutomationTemplateStepOutputDefinition {
  path: string;
  description?: string;
}

export interface AutomationTemplatePublicOutputDefinition {
  /** Exact `${{ steps.<step-id>.outputs.<output-name> }}` reference. */
  source: string;
  description?: string;
}

export type AutomationTemplateAuthorityMode = "read-only" | "write";
export type AutomationTemplateEffectKind = "read" | "write";

export interface AutomationTemplateAuthority {
  mode: AutomationTemplateAuthorityMode;
  readPermissions: string[];
  writePermissions: string[];
}

export type AutomationTemplateCompensationPlan =
  | { kind: "not-applicable"; reason: string }
  | { kind: "per-created-binding"; actionId: string };

export interface AutomationTemplateEffect {
  id: string;
  stepId: string;
  sink: string;
  kind: AutomationTemplateEffectKind;
  operation: string;
  compensation: AutomationTemplateCompensationPlan;
}

export interface AutomationTemplateActionStep
  extends Omit<AutomationActionStep, "dependsOn"> {
  dependsOn?: string[];
  outputs?: Record<string, AutomationTemplateStepOutputDefinition>;
}

export interface AutomationTemplateDefinition {
  schemaVersion: typeof AUTOMATION_TEMPLATE_SCHEMA_VERSION;
  slug: string;
  version: string;
  name: string;
  description?: string;
  authority: AutomationTemplateAuthority;
  effects: AutomationTemplateEffect[];
  inputs?: Record<string, AutomationTemplateInputDefinition>;
  outputs?: Record<string, AutomationTemplatePublicOutputDefinition>;
  automation: {
    status?: AutomationStatus;
    triggers: AutomationTrigger[];
    actions: AutomationTemplateActionStep[];
    concurrency?: AutomationSpec["concurrency"];
    audit?: AutomationSpec["audit"];
    metadata?: JsonObject;
  };
}

export interface AutomationTemplateCompileRequest {
  slug: string;
  version: string;
  inputs?: Record<string, JsonValue>;
}

export interface AutomationTemplateReceipt {
  schemaVersion: typeof AUTOMATION_TEMPLATE_RECEIPT_SCHEMA_VERSION;
  id: string;
  operation: "preview" | "install";
  template: {
    slug: string;
    version: string;
    digest: string;
  };
  automation: {
    id: string;
    version: string;
    specDigest: string;
  };
  inputs: {
    names: string[];
    digest: string;
  };
  plan: {
    authority: AutomationTemplateAuthority;
    effects: AutomationTemplateEffect[];
  };
  effect:
    | { kind: "none" }
    | { kind: "automation.ensure"; automationId: string };
}

export interface AutomationTemplateResult {
  spec: AutomationSpec;
  receipt: AutomationTemplateReceipt;
}

export interface AutomationTemplateExecutionPreview {
  schemaVersion: typeof AUTOMATION_TEMPLATE_RECEIPT_SCHEMA_VERSION;
  id: string;
  operation: "execution-preview";
  template: {
    slug: string;
    version: string;
    digest: string;
  };
  automation: {
    id: string;
    version: string;
    specDigest: string;
  };
  authority: AutomationTemplateAuthority;
  effects: AutomationTemplateEffect[];
  actionPlan: Array<{
    stepId: string;
    actionId: string;
    manifestVersion: string;
    effects: string[];
  }>;
  effect: {
    kind: "none";
    executorCalls: 0;
    adapterCalls: 0;
    writes: 0;
  };
}

export interface AutomationTemplateInstaller {
  /** Atomically insert exact content, return identical content, or reject a conflict without mutation. */
  ensureAutomation(spec: AutomationSpec): AutomationRecord;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const STEP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const REFERENCE_SOURCE = String.raw`(?:inputs\.([a-zA-Z][a-zA-Z0-9_-]*)|steps\.([a-zA-Z0-9][a-zA-Z0-9._:-]*)\.outputs\.([a-zA-Z][a-zA-Z0-9_-]*))`;
const FULL_REFERENCE_PATTERN = new RegExp(String.raw`^\$\{\{\s*${REFERENCE_SOURCE}\s*\}\}$`);
const REFERENCE_PATTERN = new RegExp(String.raw`\$\{\{\s*${REFERENCE_SOURCE}\s*\}\}`, "g");

interface ParsedReference {
  input?: string;
  stepId?: string;
  output?: string;
}

interface TemplateValidation {
  dependencies: Map<string, Set<string>>;
  actionOrder: Map<string, number>;
}

interface RenderContext {
  template: AutomationTemplateDefinition;
  values: Record<string, JsonValue>;
  currentStepId?: string;
  dependencies?: Set<string>;
}

/**
 * In-memory immutable registry for versioned template definitions.
 * Re-registering byte-equivalent content is idempotent; changing an existing
 * `(slug, version)` is rejected and versions of one slug coexist.
 */
export class AutomationTemplateRegistry {
  private readonly templates = new Map<string, AutomationTemplateDefinition>();
  private readonly digests = new Map<string, string>();

  register(template: AutomationTemplateDefinition): AutomationTemplateDefinition {
    const normalized = normalizeTemplate(template);
    const key = templateKey(normalized.slug, normalized.version);
    const digest = sha256(canonicalStringify(normalized));
    const existing = this.templates.get(key);
    if (existing) {
      if (this.digests.get(key) !== digest) {
        throw new Error(`automation template ${key} is immutable and already registered with different content`);
      }
      return existing;
    }
    this.templates.set(key, normalized);
    this.digests.set(key, digest);
    return normalized;
  }

  resolve(slug: string, version: string): AutomationTemplateDefinition {
    validateSlug(slug);
    validateSemver(version, "automation template version");
    const template = this.templates.get(templateKey(slug, version));
    if (!template) throw new Error(`automation template not found: ${slug}@${version}`);
    return template;
  }

  versions(slug: string): string[] {
    validateSlug(slug);
    return [...this.templates.values()]
      .filter((template) => template.slug === slug)
      .map((template) => template.version)
      .sort(compareSemver);
  }

  list(): AutomationTemplateDefinition[] {
    return [...this.templates.values()].sort((left, right) => {
      const slugOrder = left.slug.localeCompare(right.slug);
      return slugOrder === 0 ? compareSemver(left.version, right.version) : slugOrder;
    });
  }
}

export function validateAutomationTemplate(template: AutomationTemplateDefinition): void {
  validateTemplateStructure(template);
}

export function compileAutomationTemplate(
  template: AutomationTemplateDefinition,
  inputs: Record<string, JsonValue> = {},
): AutomationSpec {
  const normalized = normalizeTemplate(template);
  const validation = validateTemplateStructure(normalized);
  const values = resolveInputs(normalized, inputs);
  const baseContext: RenderContext = { template: normalized, values };
  const actionsById = new Map(normalized.automation.actions.map((action) => [action.id, action]));
  const orderedStepIds = topologicalStepIds(validation.dependencies, validation.actionOrder);
  const actions = orderedStepIds.map((stepId): AutomationActionStep => {
    const action = actionsById.get(stepId)!;
    const dependencies = new Set(validation.dependencies.get(stepId));
    const context: RenderContext = {
      ...baseContext,
      currentStepId: stepId,
      dependencies,
    };
    const actionId = action.actionId;
    const manifestVersion = action.manifestVersion;
    const input = action.input === undefined
      ? undefined
      : renderJsonValue(action.input, context, `automation action ${stepId} input`);
    const when = action.when === undefined
      ? undefined
      : renderJsonValue(action.when, context, `automation action ${stepId} when`) as JsonObject;
    const metadata = action.metadata === undefined
      ? undefined
      : renderJsonValue(action.metadata, context, `automation action ${stepId} metadata`) as JsonObject;
    return pruneUndefined({
      id: stepId,
      actionId,
      manifestVersion,
      input,
      dependsOn: [...dependencies].sort((left, right) => validation.actionOrder.get(left)! - validation.actionOrder.get(right)!),
      when,
      approval: action.approval,
      approvalGate: action.approvalGate,
      metadata,
    });
  });

  const templateMetadata = templateCompilationMetadata(normalized);
  const renderedMetadata = normalized.automation.metadata === undefined
    ? {}
    : renderJsonValue(normalized.automation.metadata, baseContext, "automation metadata") as JsonObject;
  const spec: AutomationSpec = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: compiledAutomationId(normalized.slug, normalized.version),
    name: renderRequiredString(normalized.name, baseContext, "automation template name", false),
    version: normalized.version,
    description: normalized.description === undefined
      ? undefined
      : renderRequiredString(normalized.description, baseContext, "automation template description", false),
    status: normalized.automation.status ?? "active",
    triggers: renderJsonValue(normalized.automation.triggers as unknown as JsonValue, baseContext, "automation triggers") as unknown as AutomationTrigger[],
    actions,
    concurrency: normalized.automation.concurrency === undefined
      ? undefined
      : renderJsonValue(normalized.automation.concurrency as unknown as JsonValue, baseContext, "automation concurrency") as AutomationSpec["concurrency"],
    audit: normalized.automation.audit === undefined
      ? undefined
      : renderJsonValue(normalized.automation.audit as unknown as JsonValue, baseContext, "automation audit") as AutomationSpec["audit"],
    metadata: {
      ...renderedMetadata,
      template: templateMetadata,
    },
  };
  validateAutomationSpec(spec);
  return deepFreeze(canonicalClone(spec));
}

export function previewAutomationTemplate(
  registry: AutomationTemplateRegistry,
  request: AutomationTemplateCompileRequest,
): AutomationTemplateResult {
  return createTemplateResult(registry, request, "preview");
}

/**
 * Compile and declare the exact runtime effect plan without invoking an
 * executor, adapter, installer, or persistence surface.
 */
export function previewAutomationTemplateExecution(
  registry: AutomationTemplateRegistry,
  request: AutomationTemplateCompileRequest,
): AutomationTemplateExecutionPreview {
  const result = createTemplateResult(registry, request, "preview");
  const byStep = new Map<string, string[]>();
  for (const effect of result.receipt.plan.effects) {
    const effects = byStep.get(effect.stepId) ?? [];
    effects.push(effect.id);
    byStep.set(effect.stepId, effects);
  }
  const previewWithoutId = {
    schemaVersion: AUTOMATION_TEMPLATE_RECEIPT_SCHEMA_VERSION,
    operation: "execution-preview" as const,
    template: result.receipt.template,
    automation: result.receipt.automation,
    authority: result.receipt.plan.authority,
    effects: result.receipt.plan.effects,
    actionPlan: result.spec.actions.map((action) => ({
      stepId: action.id,
      actionId: action.actionId,
      manifestVersion: action.manifestVersion ?? "1.0.0",
      effects: [...(byStep.get(action.id) ?? [])].sort(),
    })),
    effect: {
      kind: "none" as const,
      executorCalls: 0 as const,
      adapterCalls: 0 as const,
      writes: 0 as const,
    },
  };
  return deepFreeze(canonicalClone({
    ...previewWithoutId,
    id: `template_execution_preview_${sha256(canonicalStringify(previewWithoutId)).slice(0, 32)}`,
  }));
}

export function installAutomationTemplate(
  registry: AutomationTemplateRegistry,
  request: AutomationTemplateCompileRequest,
  installer: AutomationTemplateInstaller,
): AutomationTemplateResult {
  const result = createTemplateResult(registry, request, "install");
  const expectedDigest = result.receipt.automation.specDigest;
  const installed = installer.ensureAutomation(canonicalClone(result.spec));
  if (installed.id !== result.spec.id || sha256(canonicalStringify(installed.spec)) !== expectedDigest) {
    throw new Error(`automation installer did not persist the exact compiled template: ${result.spec.id}`);
  }
  return result;
}

function createTemplateResult(
  registry: AutomationTemplateRegistry,
  request: AutomationTemplateCompileRequest,
  operation: "preview" | "install",
): AutomationTemplateResult {
  const template = registry.resolve(request.slug, request.version);
  const callerInputs = canonicalClone(request.inputs ?? {});
  const spec = compileAutomationTemplate(template, callerInputs);
  const templateDigest = sha256(canonicalStringify(template));
  const specDigest = sha256(canonicalStringify(spec));
  const receiptWithoutId = {
    schemaVersion: AUTOMATION_TEMPLATE_RECEIPT_SCHEMA_VERSION,
    operation,
    template: {
      slug: template.slug,
      version: template.version,
      digest: templateDigest,
    },
    automation: {
      id: spec.id,
      version: spec.version,
      specDigest,
    },
    inputs: {
      names: Object.keys(callerInputs).sort(),
      digest: sha256(canonicalStringify(callerInputs)),
    },
    plan: {
      authority: template.authority,
      effects: template.effects,
    },
    effect: operation === "preview"
      ? { kind: "none" as const }
      : { kind: "automation.ensure" as const, automationId: spec.id },
  };
  const receipt: AutomationTemplateReceipt = {
    ...receiptWithoutId,
    id: `template_receipt_${sha256(canonicalStringify(receiptWithoutId)).slice(0, 32)}`,
  };
  return deepFreeze(canonicalClone({ spec, receipt }));
}

function normalizeTemplate(template: AutomationTemplateDefinition): AutomationTemplateDefinition {
  validateTemplateStructure(template);
  return deepFreeze(canonicalClone(template));
}

function validateTemplateStructure(template: AutomationTemplateDefinition): TemplateValidation {
  if (!isPlainObject(template)) throw new Error("automation template must be an object");
  if (template.schemaVersion !== AUTOMATION_TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`unsupported automation template schemaVersion: ${String(template.schemaVersion)}`);
  }
  validateSlug(template.slug);
  validateSemver(template.version, "automation template version");
  if (typeof template.name !== "string" || template.name.trim() === "") {
    throw new Error("automation template name is required");
  }
  if (template.description !== undefined && typeof template.description !== "string") {
    throw new Error("automation template description must be a string");
  }
  if (!isPlainObject(template.automation)) throw new Error("automation template automation must be an object");
  if (!Array.isArray(template.automation.triggers) || template.automation.triggers.length === 0) {
    throw new Error("automation template requires at least one trigger");
  }
  if (!Array.isArray(template.automation.actions) || template.automation.actions.length === 0) {
    throw new Error("automation template requires at least one action step");
  }
  validateAuthority(template.authority);
  validateEffects(template.effects, template.automation.actions);
  validateInputDefinitions(template.inputs ?? {});

  const actionsById = new Map<string, AutomationTemplateActionStep>();
  const actionOrder = new Map<string, number>();
  for (const [index, action] of template.automation.actions.entries()) {
    if (!isPlainObject(action)) throw new Error(`automation template action at index ${index} must be an object`);
    if (typeof action.id !== "string" || !STEP_ID_PATTERN.test(action.id)) {
      throw new Error(`automation template action at index ${index} requires a valid step id`);
    }
    if (actionsById.has(action.id)) throw new Error(`duplicate automation template action step id: ${action.id}`);
    if (typeof action.actionId !== "string" || action.actionId.trim() === "") {
      throw new Error(`automation template action ${action.id} requires an actionId`);
    }
    if (action.dependsOn !== undefined && !Array.isArray(action.dependsOn)) {
      throw new Error(`automation template action ${action.id} dependsOn must be an array`);
    }
    validateStepOutputs(action.id, action.outputs ?? {});
    actionsById.set(action.id, action);
    actionOrder.set(action.id, index);
  }

  const dependencies = new Map<string, Set<string>>();
  for (const action of template.automation.actions) {
    const stepDependencies = new Set(action.dependsOn ?? []);
    for (const dependency of stepDependencies) {
      if (dependency === action.id) throw new Error(`automation template action ${action.id} cannot depend on itself`);
      if (!actionsById.has(dependency)) {
        throw new Error(`automation template action ${action.id} depends on unknown step: ${dependency}`);
      }
    }
    inspectValueReferences(action.input, template, actionsById, action.id, stepDependencies, `automation action ${action.id} input`);
    inspectValueReferences(action.when, template, actionsById, action.id, stepDependencies, `automation action ${action.id} when`);
    inspectValueReferences(action.metadata, template, actionsById, action.id, stepDependencies, `automation action ${action.id} metadata`);
    assertStaticDeclaredString(action.actionId, `automation action ${action.id} actionId`);
    if (action.manifestVersion !== undefined) {
      assertStaticDeclaredString(action.manifestVersion, `automation action ${action.id} manifestVersion`);
    }
    dependencies.set(action.id, stepDependencies);
  }

  inspectInputOnlyString(template.name, template, "automation template name");
  if (template.description !== undefined) inspectInputOnlyString(template.description, template, "automation template description");
  inspectValueReferences(template.automation.triggers, template, actionsById, undefined, undefined, "automation triggers");
  inspectValueReferences(template.automation.concurrency, template, actionsById, undefined, undefined, "automation concurrency");
  inspectValueReferences(template.automation.audit, template, actionsById, undefined, undefined, "automation audit");
  inspectValueReferences(template.automation.metadata, template, actionsById, undefined, undefined, "automation metadata");
  validatePublicOutputs(template.outputs ?? {}, template, actionsById);
  topologicalStepIds(dependencies, actionOrder);
  return { dependencies, actionOrder };
}

function validateInputDefinitions(definitions: Record<string, AutomationTemplateInputDefinition>): void {
  if (!isPlainObject(definitions)) throw new Error("automation template inputs must be an object");
  for (const [name, definition] of Object.entries(definitions)) {
    if (!IDENTIFIER_PATTERN.test(name)) throw new Error(`invalid automation template input name: ${name}`);
    if (!isPlainObject(definition)) throw new Error(`automation template input ${name} must be an object`);
    if (!(AUTOMATION_TEMPLATE_INPUT_TYPES as readonly string[]).includes(definition.type)) {
      throw new Error(`automation template input ${name} has unsupported type: ${String(definition.type)}`);
    }
    if (definition.required !== undefined && typeof definition.required !== "boolean") {
      throw new Error(`automation template input ${name} required must be a boolean`);
    }
    if (definition.description !== undefined && typeof definition.description !== "string") {
      throw new Error(`automation template input ${name} description must be a string`);
    }
    if (definition.default !== undefined) assertInputType(name, definition.type, definition.default);
  }
}

function validateAuthority(authority: AutomationTemplateAuthority): void {
  if (!isPlainObject(authority)) throw new Error("automation template authority must be an object");
  if (authority.mode !== "read-only" && authority.mode !== "write") {
    throw new Error("automation template authority mode must be read-only or write");
  }
  for (const [label, values] of [
    ["readPermissions", authority.readPermissions],
    ["writePermissions", authority.writePermissions],
  ] as const) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "")) {
      throw new Error(`automation template authority ${label} must contain non-empty strings`);
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`automation template authority ${label} must not contain duplicates`);
    }
  }
  if (authority.mode === "read-only" && authority.writePermissions.length > 0) {
    throw new Error("read-only automation template authority cannot declare write permissions");
  }
}

function validateEffects(
  effects: AutomationTemplateEffect[],
  actions: AutomationTemplateActionStep[],
): void {
  if (!Array.isArray(effects)) throw new Error("automation template effects must be an array");
  const actionIds = new Set(actions.map((action) => action.id));
  const effectIds = new Set<string>();
  for (const effect of effects) {
    if (!isPlainObject(effect)) throw new Error("automation template effect must be an object");
    if (typeof effect.id !== "string" || !STEP_ID_PATTERN.test(effect.id)) {
      throw new Error("automation template effect requires a valid id");
    }
    if (effectIds.has(effect.id)) throw new Error(`duplicate automation template effect id: ${effect.id}`);
    effectIds.add(effect.id);
    if (typeof effect.stepId !== "string" || !actionIds.has(effect.stepId)) {
      throw new Error(`automation template effect ${effect.id} references unknown step: ${String(effect.stepId)}`);
    }
    if (typeof effect.sink !== "string" || effect.sink.trim() === "") {
      throw new Error(`automation template effect ${effect.id} requires a sink`);
    }
    if (effect.kind !== "read" && effect.kind !== "write") {
      throw new Error(`automation template effect ${effect.id} kind must be read or write`);
    }
    if (typeof effect.operation !== "string" || effect.operation.trim() === "") {
      throw new Error(`automation template effect ${effect.id} requires an operation`);
    }
    if (!isPlainObject(effect.compensation)) {
      throw new Error(`automation template effect ${effect.id} requires compensation semantics`);
    }
    if (effect.compensation.kind === "not-applicable") {
      if (typeof effect.compensation.reason !== "string" || effect.compensation.reason.trim() === "") {
        throw new Error(`automation template effect ${effect.id} not-applicable compensation requires a reason`);
      }
    } else if (effect.compensation.kind === "per-created-binding") {
      if (typeof effect.compensation.actionId !== "string" || effect.compensation.actionId.trim() === "") {
        throw new Error(`automation template effect ${effect.id} per-created-binding compensation requires an actionId`);
      }
    } else {
      throw new Error(`automation template effect ${effect.id} has unsupported compensation semantics`);
    }
  }
}

function validateStepOutputs(stepId: string, outputs: Record<string, AutomationTemplateStepOutputDefinition>): void {
  if (!isPlainObject(outputs)) throw new Error(`automation template action ${stepId} outputs must be an object`);
  for (const [name, definition] of Object.entries(outputs)) {
    if (!IDENTIFIER_PATTERN.test(name)) throw new Error(`invalid output name ${name} on automation template action ${stepId}`);
    if (!isPlainObject(definition) || typeof definition.path !== "string" || !isJsonPointer(definition.path)) {
      throw new Error(`automation template action ${stepId} output ${name} requires a valid relative JSON Pointer path`);
    }
    if (definition.description !== undefined && typeof definition.description !== "string") {
      throw new Error(`automation template action ${stepId} output ${name} description must be a string`);
    }
  }
}

function validatePublicOutputs(
  outputs: Record<string, AutomationTemplatePublicOutputDefinition>,
  template: AutomationTemplateDefinition,
  actionsById: Map<string, AutomationTemplateActionStep>,
): void {
  if (!isPlainObject(outputs)) throw new Error("automation template outputs must be an object");
  for (const [name, definition] of Object.entries(outputs)) {
    if (!IDENTIFIER_PATTERN.test(name)) throw new Error(`invalid automation template public output name: ${name}`);
    if (!isPlainObject(definition) || typeof definition.source !== "string") {
      throw new Error(`automation template public output ${name} requires a source reference`);
    }
    const reference = parseFullReference(definition.source);
    if (!reference?.stepId || !reference.output) {
      throw new Error(`automation template public output ${name} source must be an exact step output reference`);
    }
    validateReference(reference, template, actionsById, undefined, undefined, `automation template public output ${name}`);
  }
}

function resolveInputs(
  template: AutomationTemplateDefinition,
  provided: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (!isPlainObject(provided)) throw new Error("automation template input values must be an object");
  const definitions = template.inputs ?? {};
  for (const name of Object.keys(provided)) {
    if (!Object.hasOwn(definitions, name)) throw new Error(`undeclared automation template input: ${name}`);
  }
  const resolved: Record<string, JsonValue> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (Object.hasOwn(provided, name)) {
      const value = provided[name]!;
      assertInputType(name, definition.type, value);
      resolved[name] = canonicalClone(value);
    } else if (definition.default !== undefined) {
      resolved[name] = canonicalClone(definition.default);
    } else if (definition.required) {
      throw new Error(`required automation template input is missing: ${name}`);
    }
  }
  return resolved;
}

function assertInputType(name: string, expected: AutomationTemplateInputType, value: JsonValue): void {
  const actual = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value === "object"
        ? "object"
        : typeof value;
  if (actual !== expected || (expected === "number" && !Number.isFinite(value as number))) {
    throw new Error(`automation template input ${name} expected ${expected}, got ${actual}`);
  }
}

function renderJsonValue(value: JsonValue, context: RenderContext, path: string): JsonValue {
  if (typeof value === "string") return renderString(value, context, path, true);
  if (Array.isArray(value)) return value.map((entry, index) => renderJsonValue(entry, context, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      renderJsonValue(entry, context, `${path}.${key}`),
    ])) as JsonObject;
  }
  return value;
}

function renderRequiredString(
  value: string,
  context: RenderContext,
  path: string,
  allowStepOutputs: boolean,
): string {
  const rendered = renderString(value, context, path, allowStepOutputs);
  if (typeof rendered !== "string") throw new Error(`${path} interpolation must resolve to a string`);
  return rendered;
}

function renderString(value: string, context: RenderContext, path: string, allowStepOutputs: boolean): JsonValue {
  const full = parseFullReference(value);
  if (full) {
    validateReference(full, context.template, actionMap(context.template), context.currentStepId, context.dependencies, path);
    if (full.input) {
      if (!Object.hasOwn(context.values, full.input)) throw new Error(`unresolved automation template input ${full.input} at ${path}`);
      return canonicalClone(context.values[full.input]!);
    }
    if (!allowStepOutputs) throw new Error(`step output references are not allowed at ${path}`);
    return canonicalStepOutputReference(full.stepId!, full.output!);
  }
  let matched = false;
  const rendered = value.replace(REFERENCE_PATTERN, (_match, input: string | undefined, stepId: string | undefined, output: string | undefined) => {
    matched = true;
    const reference: ParsedReference = input ? { input } : { stepId, output };
    validateReference(reference, context.template, actionMap(context.template), context.currentStepId, context.dependencies, path);
    if (input) {
      if (!Object.hasOwn(context.values, input)) throw new Error(`unresolved automation template input ${input} at ${path}`);
      const resolved = context.values[input]!;
      if (resolved === null || typeof resolved === "object") {
        throw new Error(`automation template input ${input} must be scalar when embedded in a string at ${path}`);
      }
      return String(resolved);
    }
    if (!allowStepOutputs) throw new Error(`step output references are not allowed at ${path}`);
    return canonicalStepOutputReference(stepId!, output!);
  });
  if (rendered.includes("${{") || (!matched && value.includes("}}"))) {
    throw new Error(`unresolved automation template reference at ${path}: ${value}`);
  }
  return rendered;
}

function inspectValueReferences(
  value: unknown,
  template: AutomationTemplateDefinition,
  actionsById: Map<string, AutomationTemplateActionStep>,
  currentStepId: string | undefined,
  dependencies: Set<string> | undefined,
  path: string,
): void {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    inspectStringReferences(value, template, actionsById, currentStepId, dependencies, path, currentStepId !== undefined);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValueReferences(entry, template, actionsById, currentStepId, dependencies, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) throw new Error(`${path} must contain JSON-compatible values`);
  for (const [key, entry] of Object.entries(value)) {
    inspectValueReferences(entry, template, actionsById, currentStepId, dependencies, `${path}.${key}`);
  }
}

function inspectInputOnlyString(value: string, template: AutomationTemplateDefinition, path: string): void {
  inspectStringReferences(value, template, actionMap(template), undefined, undefined, path, false);
}

function assertStaticDeclaredString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("${{") || value.includes("}}")) {
    throw new Error(`${path} must be a static declared string`);
  }
}

function inspectStringReferences(
  value: string,
  template: AutomationTemplateDefinition,
  actionsById: Map<string, AutomationTemplateActionStep>,
  currentStepId: string | undefined,
  dependencies: Set<string> | undefined,
  path: string,
  allowStepOutputs: boolean,
): void {
  let matched = false;
  for (const match of value.matchAll(REFERENCE_PATTERN)) {
    matched = true;
    const reference: ParsedReference = match[1]
      ? { input: match[1] }
      : { stepId: match[2], output: match[3] };
    validateReference(reference, template, actionsById, currentStepId, dependencies, path);
    if (reference.stepId && !allowStepOutputs) throw new Error(`step output references are not allowed at ${path}`);
  }
  if (value.includes("${{") && !matched) throw new Error(`unresolved automation template reference at ${path}: ${value}`);
  const stripped = value.replace(REFERENCE_PATTERN, "");
  if (stripped.includes("${{") || stripped.includes("}}")) {
    throw new Error(`unresolved automation template reference at ${path}: ${value}`);
  }
}

function validateReference(
  reference: ParsedReference,
  template: AutomationTemplateDefinition,
  actionsById: Map<string, AutomationTemplateActionStep>,
  currentStepId: string | undefined,
  dependencies: Set<string> | undefined,
  path: string,
): void {
  if (reference.input) {
    if (!Object.hasOwn(template.inputs ?? {}, reference.input)) {
      throw new Error(`undeclared automation template input ${reference.input} referenced at ${path}`);
    }
    return;
  }
  const stepId = reference.stepId!;
  const output = reference.output!;
  const action = actionsById.get(stepId);
  if (!action) throw new Error(`unknown automation template step ${stepId} referenced at ${path}`);
  if (!Object.hasOwn(action.outputs ?? {}, output)) {
    throw new Error(`undeclared output ${output} on automation template step ${stepId} referenced at ${path}`);
  }
  if (currentStepId !== undefined) dependencies?.add(stepId);
}

function parseFullReference(value: string): ParsedReference | undefined {
  const match = FULL_REFERENCE_PATTERN.exec(value);
  if (!match) return undefined;
  return match[1]
    ? { input: match[1] }
    : { stepId: match[2], output: match[3] };
}

function canonicalStepOutputReference(stepId: string, output: string): string {
  return `\${{ steps.${stepId}.outputs.${output} }}`;
}

function templateCompilationMetadata(template: AutomationTemplateDefinition): JsonObject {
  const stepOutputs = Object.fromEntries(template.automation.actions
    .filter((action) => Object.keys(action.outputs ?? {}).length > 0)
    .map((action) => [action.id, Object.fromEntries(Object.entries(action.outputs ?? {}).map(([name, definition]) => [name, definition.path]))]));
  const publicOutputs = Object.fromEntries(Object.entries(template.outputs ?? {}).map(([name, definition]) => [name, definition.source]));
  return {
    slug: template.slug,
    version: template.version,
    schemaVersion: template.schemaVersion,
    authority: template.authority as unknown as JsonObject,
    effects: template.effects as unknown as JsonValue,
    stepOutputs,
    publicOutputs,
  };
}

function topologicalStepIds(dependencies: Map<string, Set<string>>, order: Map<string, number>): string[] {
  const remaining = new Map([...dependencies].map(([id, values]) => [id, new Set(values)]));
  const result: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, values]) => values.size === 0)
      .map(([id]) => id)
      .sort((left, right) => order.get(left)! - order.get(right)!);
    if (ready.length === 0) {
      const cycleAt = [...remaining.keys()].sort((left, right) => order.get(left)! - order.get(right)!)[0]!;
      throw new Error(`automation template action dependency cycle detected at step: ${cycleAt}`);
    }
    for (const id of ready) {
      result.push(id);
      remaining.delete(id);
      for (const values of remaining.values()) values.delete(id);
    }
  }
  return result;
}

function actionMap(template: AutomationTemplateDefinition): Map<string, AutomationTemplateActionStep> {
  return new Map(template.automation.actions.map((action) => [action.id, action]));
}

export function compiledAutomationId(slug: string, version: string): string {
  return `template:${slug}:${version.replaceAll("+", "_")}`;
}

function validateSlug(slug: string): void {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    throw new Error(`invalid automation template slug: ${String(slug)}`);
  }
}

function validateSemver(version: string, label: string): void {
  const match = typeof version === "string" ? SEMVER_PATTERN.exec(version) : null;
  const hasInvalidNumericPrerelease = match?.[4]
    ?.split(".")
    .some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) ?? false;
  if (!match || hasInvalidNumericPrerelease) {
    throw new Error(`${label} must be a valid semantic version: ${String(version)}`);
  }
}

function compareSemver(left: string, right: string): number {
  const leftMatch = SEMVER_PATTERN.exec(left)!;
  const rightMatch = SEMVER_PATTERN.exec(right)!;
  for (let index = 1; index <= 3; index += 1) {
    const comparison = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (comparison !== 0) return comparison;
  }
  const leftPrerelease = leftMatch[4];
  const rightPrerelease = rightMatch[4];
  if (leftPrerelease === undefined) return rightPrerelease === undefined ? left.localeCompare(right) : 1;
  if (rightPrerelease === undefined) return -1;
  const leftParts = leftPrerelease.split(".");
  const rightParts = rightPrerelease.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return left.localeCompare(right);
}

function isJsonPointer(path: string): boolean {
  if (path === "") return true;
  if (!path.startsWith("/")) return false;
  return path.split("/").slice(1).every((segment) => !/~(?![01])/u.test(segment));
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function templateKey(slug: string, version: string): string {
  return `${slug}@${version}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

function canonicalStringify(value: unknown): string {
  const seen = new Set<object>();
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error("automation template values must contain finite numbers");
      return entry;
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) throw new Error("automation template values must not contain cycles");
      seen.add(entry);
      const result = entry.map(normalize);
      seen.delete(entry);
      return result;
    }
    if (isPlainObject(entry)) {
      if (seen.has(entry)) throw new Error("automation template values must not contain cycles");
      seen.add(entry);
      const result = Object.fromEntries(Object.keys(entry).sort().map((key) => {
        const child = entry[key];
        if (child === undefined) return [key, undefined];
        return [key, normalize(child)];
      }).filter(([, child]) => child !== undefined));
      seen.delete(entry);
      return result;
    }
    throw new Error(`automation template values must be JSON-compatible, got ${typeof entry}`);
  };
  return JSON.stringify(normalize(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
