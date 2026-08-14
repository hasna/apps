import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CreateWorkflowInput,
  LoopTemplateSummary,
  LoopTemplateVariable,
  LoopTemplateVariableType,
} from "../types.js";
import { dataDir } from "./paths.js";
import { workflowBodyFromJson } from "./workflow-spec.js";

/**
 * Custom loop template registry: JSON-defined workflow templates stored under
 * the data dir. Rendering fails closed on danger-full-access/bypass flags and
 * on collisions with the builtin template keys (passed in as reservedKeys).
 */

export interface CustomLoopTemplateImportOptions {
  replace?: boolean;
}

export interface CustomLoopTemplateImportResult {
  template: LoopTemplateSummary;
  path: string;
  replaced: boolean;
}

interface CustomLoopTemplateDefinition {
  id: string;
  name: string;
  description: string;
  kind: "workflow";
  variables: LoopTemplateVariable[];
  workflow: unknown;
}

export interface CustomLoopTemplateEntry {
  definition: CustomLoopTemplateDefinition;
  summary: LoopTemplateSummary;
  path: string;
}

const CUSTOM_TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CUSTOM_TEMPLATE_VARIABLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CUSTOM_TEMPLATE_VARIABLE_TYPES = new Set<LoopTemplateVariableType>(["string", "number", "boolean", "json", "string[]"]);
const CUSTOM_TEMPLATE_PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const CUSTOM_TEMPLATE_EXACT_PLACEHOLDER = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS = [
  "danger-full-access",
  "dangerously-bypass",
  "dangerously-skip",
];

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertTemplateString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function assertTemplateKind(value: unknown, label: string): "workflow" {
  const kind = assertTemplateString(value, label);
  if (kind !== "workflow") throw new Error(`${label} must be workflow; custom loop templates are not supported yet`);
  return kind;
}

export function customLoopTemplatesDir(): string {
  return join(dataDir(), "templates");
}

function ensureCustomLoopTemplatesDir(): string {
  const dir = customLoopTemplatesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function validateCustomTemplateId(id: string, label: string): void {
  if (!CUSTOM_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`${label} must match ${CUSTOM_TEMPLATE_ID_PATTERN.source}`);
  }
}

function optionalTemplateBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function validateCustomTemplateVariables(value: unknown, label: string): LoopTemplateVariable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    assertRecord(entry, entryLabel);
    const name = assertTemplateString(entry.name, `${entryLabel}.name`);
    if (!CUSTOM_TEMPLATE_VARIABLE_PATTERN.test(name)) {
      throw new Error(`${entryLabel}.name must match ${CUSTOM_TEMPLATE_VARIABLE_PATTERN.source}`);
    }
    if (seen.has(name)) throw new Error(`duplicate custom template variable: ${name}`);
    seen.add(name);
    const description = entry.description === undefined ? undefined : assertTemplateString(entry.description, `${entryLabel}.description`);
    const defaultValue = entry.default === undefined ? undefined : assertTemplateString(entry.default, `${entryLabel}.default`);
    const type = entry.type === undefined ? undefined : assertTemplateString(entry.type, `${entryLabel}.type`) as LoopTemplateVariableType;
    if (type && !CUSTOM_TEMPLATE_VARIABLE_TYPES.has(type)) {
      throw new Error(`${entryLabel}.type must be one of ${[...CUSTOM_TEMPLATE_VARIABLE_TYPES].join(", ")}`);
    }
    if (defaultValue && CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS.some((pattern) => defaultValue.includes(pattern))) {
      throw new Error(`${entryLabel}.default cannot contain dangerous sandbox or bypass flags in a custom template`);
    }
    return {
      name,
      description,
      required: optionalTemplateBoolean(entry.required, `${entryLabel}.required`),
      default: defaultValue,
      type,
    };
  });
}

function hasDangerousArg(value: string): boolean {
  return CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS.some((pattern) => value.includes(pattern));
}

function assertNoDangerousCustomTemplateScalars(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (hasDangerousArg(value)) {
      throw new Error(`${label} contains a dangerous sandbox or bypass flag; custom templates must not request danger-full-access`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDangerousCustomTemplateScalars(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoDangerousCustomTemplateScalars(entry, `${label}.${key}`);
  }
}

function assertNoImplicitDangerFullAccess(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoImplicitDangerFullAccess(entry, `${label}[${index}]`));
    return;
  }
  const object = value as Record<string, unknown>;
  if (
    object.type === "agent" &&
    (object.provider === "codewith" || object.provider === "codex") &&
    object.permissionMode === "bypass" &&
    object.sandbox === undefined
  ) {
    throw new Error(`${label} uses permissionMode=bypass for ${object.provider} without an explicit sandbox; set sandbox=workspace-write or read-only`);
  }
  for (const [key, entry] of Object.entries(object)) {
    assertNoImplicitDangerFullAccess(entry, `${label}.${key}`);
  }
}

function assertNoCustomTemplatePromptFiles(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCustomTemplatePromptFiles(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "promptFile") {
      throw new Error(`${label}.${key} is not allowed in custom templates; use direct workflow JSON for prompt-file-backed workflows`);
    }
    assertNoCustomTemplatePromptFiles(entry, `${label}.${key}`);
  }
}

function assertCustomTemplateSafety(value: unknown, label: string): void {
  assertNoDangerousCustomTemplateScalars(value, label);
  assertNoImplicitDangerFullAccess(value, label);
  assertNoCustomTemplatePromptFiles(value, label);
}

function customTemplateDefinitionFromJson(value: unknown, sourcePath: string): CustomLoopTemplateDefinition {
  assertRecord(value, sourcePath);
  const id = assertTemplateString(value.id, `${sourcePath}.id`);
  validateCustomTemplateId(id, `${sourcePath}.id`);
  const name = assertTemplateString(value.name, `${sourcePath}.name`);
  const description = assertTemplateString(value.description, `${sourcePath}.description`);
  const kind = assertTemplateKind(value.kind ?? "workflow", `${sourcePath}.kind`);
  const variables = validateCustomTemplateVariables(value.variables, `${sourcePath}.variables`);
  if (value.workflow === undefined) throw new Error(`${sourcePath}.workflow is required`);
  assertRecord(value.workflow, `${sourcePath}.workflow`);
  assertCustomTemplateSafety(value.workflow, `${sourcePath}.workflow`);
  return { id, name, description, kind, variables, workflow: value.workflow };
}

function customTemplateSummary(definition: CustomLoopTemplateDefinition, sourcePath: string): LoopTemplateSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    variables: structuredClone(definition.variables),
    source: "custom",
    sourcePath,
  };
}

function readCustomTemplateFile(file: string): CustomLoopTemplateEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read custom template ${file}: ${message}`);
  }
  const definition = customTemplateDefinitionFromJson(parsed, file);
  return { definition, summary: customTemplateSummary(definition, file), path: file };
}

function assertNoTemplateCollisions(entries: CustomLoopTemplateEntry[], reservedKeys: Set<string>): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const key of [entry.definition.id, entry.definition.name]) {
      if (reservedKeys.has(key)) {
        throw new Error(`custom template ${entry.definition.id} collides with built-in template key ${key}; choose a different id or name`);
      }
      const existing = seen.get(key);
      if (existing) {
        throw new Error(`custom template ${entry.definition.id} collides with ${existing} on key ${key}`);
      }
      seen.set(key, entry.definition.id);
    }
  }
}

function loadCustomLoopTemplatesRaw(): CustomLoopTemplateEntry[] {
  const dir = customLoopTemplatesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`refusing symlinked custom template file: ${file}`);
      if (!entry.isFile()) throw new Error(`custom template registry entry is not a regular file: ${file}`);
      return readCustomTemplateFile(file);
    });
}

export function loadCustomLoopTemplates(reservedKeys: Set<string>): CustomLoopTemplateEntry[] {
  const entries = loadCustomLoopTemplatesRaw();
  assertNoTemplateCollisions(entries, reservedKeys);
  return entries;
}

export function getCustomLoopTemplate(id: string, reservedKeys: Set<string>): CustomLoopTemplateEntry | undefined {
  return loadCustomLoopTemplates(reservedKeys).find((template) => template.definition.id === id || template.definition.name === id);
}

function coerceCustomTemplateValue(raw: unknown, type: LoopTemplateVariableType | undefined, label: string): unknown {
  const normalizedType = type ?? "string";
  if (normalizedType === "string") return String(raw);
  if (normalizedType === "number") {
    const value = typeof raw === "number" ? raw : Number(String(raw));
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
    return value;
  }
  if (normalizedType === "boolean") {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    throw new Error(`${label} must be a boolean`);
  }
  if (normalizedType === "json") {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} must be valid JSON: ${message}`);
    }
  }
  if (normalizedType === "string[]") {
    if (Array.isArray(raw)) return raw.map((entry) => String(entry));
    return String(raw).split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return String(raw);
}

function customTemplateValues(
  definition: CustomLoopTemplateDefinition,
  values: Record<string, string | undefined>,
): Record<string, unknown> {
  const variablesByName = new Map(definition.variables.map((variable) => [variable.name, variable]));
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && !variablesByName.has(name)) {
      throw new Error(`unknown variable for custom template ${definition.id}: ${name}`);
    }
  }
  const rendered: Record<string, unknown> = {};
  for (const variable of definition.variables) {
    const raw = values[variable.name] ?? variable.default;
    if (raw === undefined || raw === "") {
      if (variable.required) throw new Error(`${variable.name} is required`);
      continue;
    }
    rendered[variable.name] = coerceCustomTemplateValue(raw, variable.type, variable.name);
  }
  return rendered;
}

function customTemplateValueForPlaceholder(values: Record<string, unknown>, name: string, templateId: string): unknown {
  if (!(name in values)) throw new Error(`custom template ${templateId} requires variable ${name}`);
  return values[name];
}

function stringifyCustomTemplateValue(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  throw new Error(`custom template variable ${name} cannot be rendered as a string`);
}

function renderCustomTemplateNode(value: unknown, values: Record<string, unknown>, templateId: string): unknown {
  if (typeof value === "string") {
    const exact = CUSTOM_TEMPLATE_EXACT_PLACEHOLDER.exec(value);
    if (exact) return customTemplateValueForPlaceholder(values, exact[1], templateId);
    return value.replace(CUSTOM_TEMPLATE_PLACEHOLDER, (_match, name: string) =>
      stringifyCustomTemplateValue(customTemplateValueForPlaceholder(values, name, templateId), name),
    );
  }
  if (Array.isArray(value)) return value.map((entry) => renderCustomTemplateNode(entry, values, templateId));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, renderCustomTemplateNode(entry, values, templateId)]),
  );
}

export function renderCustomLoopTemplate(entry: CustomLoopTemplateEntry, values: Record<string, string | undefined>): CreateWorkflowInput {
  const renderedValues = customTemplateValues(entry.definition, values);
  const rendered = renderCustomTemplateNode(entry.definition.workflow, renderedValues, entry.definition.id);
  assertCustomTemplateSafety(rendered, `custom template ${entry.definition.id}.workflow`);
  const workflow = workflowBodyFromJson(rendered);
  assertCustomTemplateSafety(workflow, `custom template ${entry.definition.id}.workflow`);
  return workflow;
}

export function validateCustomLoopTemplateFile(file: string, reservedKeys: Set<string>): LoopTemplateSummary {
  const source = resolve(file);
  const entry = readCustomTemplateFile(source);
  const existing = loadCustomLoopTemplatesRaw().filter((template) => resolve(template.path) !== source);
  assertNoTemplateCollisions([...existing, entry], reservedKeys);
  return structuredClone(entry.summary);
}

export function importCustomLoopTemplate(
  file: string,
  reservedKeys: Set<string>,
  opts: CustomLoopTemplateImportOptions = {},
): CustomLoopTemplateImportResult {
  const source = resolve(file);
  const entry = readCustomTemplateFile(source);
  const dir = ensureCustomLoopTemplatesDir();
  const destination = join(dir, `${entry.definition.id}.json`);
  const replaced = existsSync(destination);
  const existing = loadCustomLoopTemplatesRaw().filter((template) => resolve(template.path) !== resolve(destination));
  assertNoTemplateCollisions(
    [...existing, { ...entry, path: destination, summary: customTemplateSummary(entry.definition, destination) }],
    reservedKeys,
  );
  if (replaced) {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`refusing to replace non-regular custom template file: ${destination}`);
    if (!opts.replace) throw new Error(`custom template already exists: ${entry.definition.id}; use --replace to overwrite it`);
  }
  writeFileSync(destination, `${JSON.stringify(entry.definition, null, 2)}\n`, { mode: 0o600 });
  const imported = readCustomTemplateFile(destination);
  return { template: structuredClone(imported.summary), path: destination, replaced };
}
