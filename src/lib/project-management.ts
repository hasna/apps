import { existsSync } from "node:fs";
import type { JsonObject, Workspace, WorkspaceIntegrations } from "../types/workspace.js";
import type { WorkspaceTmuxWindowSpec } from "./workspace-runtime.js";

export const PROJECT_STAGES = ["idea", "planned", "active", "paused", "shipped", "maintenance"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const PROJECT_START_AGENTS = ["codewith", "claude", "opencode", "cursor", "none"] as const;
export type ProjectStartAgent = (typeof PROJECT_START_AGENTS)[number];
export const PROJECT_START_SESSION_POLICIES = ["reuse", "new", "error-if-running"] as const;
export type ProjectStartSessionPolicy = (typeof PROJECT_START_SESSION_POLICIES)[number];
export type ProjectIntegrationUnlinkGroup = "github" | "todos" | "brief" | "canvases" | "mementos" | "conversations" | "files";

export const FINANCE_PROJECT_METADATA_SCHEMA = "hasna.projects.finance_project_metadata.v1" as const;
export const FINANCE_PROJECT_METADATA_FIELDS = [
  "business_area",
  "jurisdiction",
  "legal_entities",
  "fiscal_cycle",
  "data_classification",
  "retention_policy",
  "ledger_authority",
  "evidence_store",
  "approver",
  "external_recipient_policy",
] as const;
export type FinanceProjectMetadataField = (typeof FINANCE_PROJECT_METADATA_FIELDS)[number];

export const FINANCE_FISCAL_CYCLES = ["monthly", "quarterly", "annual", "event-driven"] as const;
export type FinanceFiscalCycle = (typeof FINANCE_FISCAL_CYCLES)[number];

export const FINANCE_DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type FinanceDataClassification = (typeof FINANCE_DATA_CLASSIFICATIONS)[number];

export interface FinanceProjectMetadata {
  schema: typeof FINANCE_PROJECT_METADATA_SCHEMA;
  business_area: "finance";
  jurisdiction: string;
  legal_entities: string[];
  fiscal_cycle: FinanceFiscalCycle;
  data_classification: FinanceDataClassification;
  retention_policy: string;
  ledger_authority: string;
  evidence_store: string;
  approver: string;
  external_recipient_policy: string;
}

export const PROJECT_MANAGEMENT_TAXONOMY = {
  stages: PROJECT_STAGES,
  priorities: PROJECT_PRIORITIES,
  start_agents: PROJECT_START_AGENTS,
  start_session_policies: PROJECT_START_SESSION_POLICIES,
  integration_keys: ["todos_project_id", "todos_task_list_id", "brief_id", "brief_path", "canvases_project_id", "canvases_default_canvas_id"] as const,
} as const;

const FINANCE_AUTHORITY_FIELDS = FINANCE_PROJECT_METADATA_FIELDS.filter(
  (field): field is Exclude<FinanceProjectMetadataField, "business_area"> => field !== "business_area",
);
const FINANCE_JURISDICTION_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const FINANCE_METADATA_TEXT_MAX_LENGTH = 512;
const FINANCE_LEGAL_ENTITY_MAX_LENGTH = 256;
const FINANCE_LEGAL_ENTITY_MAX_ITEMS = 100;

function metadataHasOwn(metadata: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function normalizedLowerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return normalized || null;
}

function hasFinanceProjectMetadataIntent(metadata: JsonObject): boolean {
  const businessArea = normalizedLowerToken(metadata["business_area"]);
  return businessArea === "finance"
    || FINANCE_AUTHORITY_FIELDS.some((field) => metadataHasOwn(metadata, field));
}

function requiredFinanceMetadataString(metadata: JsonObject, field: FinanceProjectMetadataField): string {
  const value = metadata[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Finance project metadata ${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > FINANCE_METADATA_TEXT_MAX_LENGTH) {
    throw new Error(
      `Finance project metadata ${field} must be at most ${FINANCE_METADATA_TEXT_MAX_LENGTH} characters`,
    );
  }
  return normalized;
}

function normalizeFinanceLegalEntities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Finance project metadata legal_entities must be a non-empty array of strings");
  }
  if (value.length > FINANCE_LEGAL_ENTITY_MAX_ITEMS) {
    throw new Error(
      `Finance project metadata legal_entities must contain at most ${FINANCE_LEGAL_ENTITY_MAX_ITEMS} items`,
    );
  }
  const entities: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("Finance project metadata legal_entities must be a non-empty array of strings");
    }
    const entity = item.trim();
    if (entity.length > FINANCE_LEGAL_ENTITY_MAX_LENGTH) {
      throw new Error(
        `Finance project metadata legal_entities entries must be at most ${FINANCE_LEGAL_ENTITY_MAX_LENGTH} characters`,
      );
    }
    if (seen.has(entity)) continue;
    seen.add(entity);
    entities.push(entity);
  }
  if (entities.length === 0) {
    throw new Error("Finance project metadata legal_entities must be a non-empty array of strings");
  }
  return entities;
}

/**
 * Normalize the authoritative finance-project metadata contract.
 *
 * Finance authority is activated by `business_area: finance` or by any of the
 * finance-specific authority fields. Tags are intentionally ignored: they
 * remain free-form discovery labels and cannot establish authority.
 *
 * When `existingMetadata` is already finance-authoritative, replacement
 * metadata must preserve the complete contract rather than silently stripping
 * it during an update.
 */
export function normalizeProjectMetadata(
  metadata: JsonObject | undefined,
  existingMetadata?: JsonObject,
): JsonObject {
  const next: JsonObject = { ...(metadata ?? {}) };
  const isFinance = hasFinanceProjectMetadataIntent(next)
    || (existingMetadata ? hasFinanceProjectMetadataIntent(existingMetadata) : false);
  if (!isFinance) return next;

  const missing = FINANCE_PROJECT_METADATA_FIELDS.filter((field) => !metadataHasOwn(next, field));
  if (missing.length > 0) {
    throw new Error(`Finance project metadata is missing required fields: ${missing.join(", ")}`);
  }

  const businessArea = normalizedLowerToken(next["business_area"]);
  if (businessArea !== "finance") {
    throw new Error('Finance project metadata business_area must be "finance"');
  }

  const jurisdiction = requiredFinanceMetadataString(next, "jurisdiction").toUpperCase();
  if (!FINANCE_JURISDICTION_PATTERN.test(jurisdiction)) {
    throw new Error("Finance project metadata jurisdiction must be a stable 2-64 character identifier");
  }

  const fiscalCycle = normalizedLowerToken(next["fiscal_cycle"]);
  if (!fiscalCycle || !FINANCE_FISCAL_CYCLES.includes(fiscalCycle as FinanceFiscalCycle)) {
    throw new Error(`Finance project metadata fiscal_cycle must be one of: ${FINANCE_FISCAL_CYCLES.join(", ")}`);
  }

  const classification = normalizedLowerToken(next["data_classification"]);
  if (
    !classification
    || !FINANCE_DATA_CLASSIFICATIONS.includes(classification as FinanceDataClassification)
  ) {
    throw new Error(
      `Finance project metadata data_classification must be one of: ${FINANCE_DATA_CLASSIFICATIONS.join(", ")}`,
    );
  }

  return {
    ...next,
    business_area: "finance",
    jurisdiction,
    legal_entities: normalizeFinanceLegalEntities(next["legal_entities"]),
    fiscal_cycle: fiscalCycle,
    data_classification: classification,
    retention_policy: requiredFinanceMetadataString(next, "retention_policy"),
    ledger_authority: requiredFinanceMetadataString(next, "ledger_authority"),
    evidence_store: requiredFinanceMetadataString(next, "evidence_store"),
    approver: requiredFinanceMetadataString(next, "approver"),
    external_recipient_policy: requiredFinanceMetadataString(next, "external_recipient_policy"),
  };
}

export function financeProjectMetadata(
  project: { metadata: JsonObject; tags?: string[] },
): FinanceProjectMetadata | null {
  if (!hasFinanceProjectMetadataIntent(project.metadata)) return null;
  const normalized = normalizeProjectMetadata(project.metadata);
  return {
    schema: FINANCE_PROJECT_METADATA_SCHEMA,
    business_area: "finance",
    jurisdiction: normalized["jurisdiction"] as string,
    legal_entities: normalized["legal_entities"] as string[],
    fiscal_cycle: normalized["fiscal_cycle"] as FinanceFiscalCycle,
    data_classification: normalized["data_classification"] as FinanceDataClassification,
    retention_policy: normalized["retention_policy"] as string,
    ledger_authority: normalized["ledger_authority"] as string,
    evidence_store: normalized["evidence_store"] as string,
    approver: normalized["approver"] as string,
    external_recipient_policy: normalized["external_recipient_policy"] as string,
  };
}

export interface ProjectManagementMetadataInput {
  stage?: string | null;
  priority?: string | null;
  owner?: string | null;
  launch_profile?: string | null;
  start_agent?: string | null;
  start_command?: string | null;
  start_session_policy?: string | null;
  start_windows?: WorkspaceTmuxWindowSpec[] | null;
}

export interface ProjectIntegrationInput {
  todos_project_id?: string | null;
  todos_task_list_id?: string | null;
  brief_id?: string | null;
  brief_path?: string | null;
  canvases_project_id?: string | null;
  canvases_default_canvas_id?: string | null;
}

export interface ProjectManagementSummary {
  stage: string | null;
  priority: string | null;
  owner: string | null;
  launch_profile: string | null;
  start_agent: string | null;
  start_command: string | null;
  start_session_policy: string | null;
  start_windows: WorkspaceTmuxWindowSpec[];
  todos_project_id: string | null;
  todos_task_list_id: string | null;
  brief_id: string | null;
  brief_path: string | null;
  canvases_project_id: string | null;
  canvases_default_canvas_id: string | null;
}

export interface ProjectExternalLinksSummary {
  todos: {
    linked: boolean;
    status: "linked" | "unlinked";
    project_id: string | null;
    task_list_id: string | null;
  };
  brief: {
    linked: boolean;
    status: "linked" | "unlinked";
    id: string | null;
    path: string | null;
    path_exists: boolean | null;
  };
  canvases: {
    linked: boolean;
    status: "linked" | "unlinked";
    project_id: string | null;
    default_canvas_id: string | null;
  };
}

function cleanProjectTag(value: string): string | null {
  const tag = value.trim();
  return tag ? tag : null;
}

export function mergeProjectTags(existing: string[], tags: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...tags]) {
    const tag = cleanProjectTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }
  return next;
}

export function removeProjectTags(existing: string[], tags: string[]): string[] {
  const removals = new Set(tags.map(cleanProjectTag).filter((tag): tag is string => Boolean(tag)));
  if (removals.size === 0) return mergeProjectTags(existing, []);
  return mergeProjectTags(existing, []).filter((tag) => !removals.has(tag));
}

export function expandProjectIntegrationUnlinkKey(key: string): string[] {
  const normalized = key.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!normalized) return [];
  switch (normalized) {
    case "github":
      return ["github_repo", "github_url"];
    case "repo":
    case "github_repo":
    case "github_full_name":
      return ["github_repo"];
    case "github_url":
      return ["github_url"];
    case "todos":
    case "todo":
      return ["todos_project_id", "todos_task_list_id"];
    case "todos_project":
    case "todos_project_id":
      return ["todos_project_id"];
    case "todos_task_list":
    case "todos_task_list_id":
      return ["todos_task_list_id"];
    case "brief":
    case "spec":
      return ["brief_id", "brief_path"];
    case "brief_id":
    case "spec_id":
      return ["brief_id"];
    case "brief_path":
    case "spec_path":
      return ["brief_path"];
    case "canvases":
    case "canvas":
      return ["canvases_project_id", "canvases_default_canvas_id"];
    case "canvases_project":
    case "canvases_project_id":
      return ["canvases_project_id"];
    case "canvases_default_canvas":
    case "canvases_default_canvas_id":
    case "canvas_id":
      return ["canvases_default_canvas_id"];
    case "mementos":
    case "memento":
    case "mementos_project":
    case "mementos_project_id":
      return ["mementos_project_id"];
    case "conversations":
    case "conversation":
      return ["conversations_space", "conversations_channel"];
    case "conversations_space":
      return ["conversations_space"];
    case "conversations_channel":
    case "channel":
      return ["conversations_channel"];
    case "files":
    case "file_index":
    case "files_index":
    case "files_index_id":
      return ["files_index_id"];
    default:
      return [normalized];
  }
}

export function expandProjectIntegrationUnlinkKeys(keys: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const key of keys.flatMap(expandProjectIntegrationUnlinkKey)) {
    if (seen.has(key)) continue;
    seen.add(key);
    expanded.push(key);
  }
  return expanded;
}

export function unlinkProjectIntegrationFields(integrations: WorkspaceIntegrations, keys: string[]): WorkspaceIntegrations {
  const next: WorkspaceIntegrations = { ...integrations };
  for (const key of expandProjectIntegrationUnlinkKeys(keys)) {
    delete next[key];
  }
  return next;
}

/**
 * Merge incoming integration fields into an existing set: values are trimmed,
 * empty/whitespace values are dropped, and existing keys survive. Mirrors the
 * persistence-time merge in `linkWorkspaceIntegrations` so the Store-routed
 * link path (local + api) produces an identical record without touching sqlite
 * directly. Callers should alias-normalize the incoming map first.
 */
export function mergeProjectIntegrations(
  existing: WorkspaceIntegrations,
  incoming: WorkspaceIntegrations,
): WorkspaceIntegrations {
  const merged: WorkspaceIntegrations = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const trimmed = String(value).trim();
    if (trimmed.length > 0) merged[key] = trimmed;
  }
  return merged;
}

export interface ProjectPathHealth {
  status: "ok" | "missing" | "remote-only" | "unknown";
  path: string | null;
  exists: boolean | null;
}

export interface ProjectDashboardSummary {
  management: ProjectManagementSummary;
  external_links: ProjectExternalLinksSummary;
  path_health: ProjectPathHealth;
  launch: {
    default_agent: string | null;
    default_command: string | null;
    default_profile: string | null;
    default_session_policy: string | null;
    default_windows: WorkspaceTmuxWindowSpec[];
    last_opened_at: string | null;
  };
}

function cleanString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStage(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanString(value);
  if (cleaned === undefined || cleaned === null) return cleaned;
  const normalized = cleaned.toLowerCase();
  if ((PROJECT_STAGES as readonly string[]).includes(normalized)) return normalized;
  throw new Error(`Invalid project stage: ${cleaned}. Expected one of: ${PROJECT_STAGES.join(", ")}`);
}

function normalizePriority(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanString(value);
  if (cleaned === undefined || cleaned === null) return cleaned;
  const normalized = cleaned.toLowerCase();
  if ((PROJECT_PRIORITIES as readonly string[]).includes(normalized)) return normalized;
  throw new Error(`Invalid project priority: ${cleaned}. Expected one of: ${PROJECT_PRIORITIES.join(", ")}`);
}

function normalizeStartAgent(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanString(value);
  if (cleaned === undefined || cleaned === null) return cleaned;
  const normalized = cleaned.toLowerCase();
  if ((PROJECT_START_AGENTS as readonly string[]).includes(normalized)) return normalized;
  throw new Error(`Invalid project start_agent: ${cleaned}. Expected one of: ${PROJECT_START_AGENTS.join(", ")}`);
}

function normalizeStartSessionPolicy(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanString(value);
  if (cleaned === undefined || cleaned === null) return cleaned;
  const normalized = cleaned.toLowerCase();
  if ((PROJECT_START_SESSION_POLICIES as readonly string[]).includes(normalized)) return normalized;
  throw new Error(`Invalid project start_session_policy: ${cleaned}. Expected one of: ${PROJECT_START_SESSION_POLICIES.join(", ")}`);
}

function normalizeStartWindows(value: WorkspaceTmuxWindowSpec[] | null | undefined): WorkspaceTmuxWindowSpec[] | null | undefined {
  if (value === undefined || value === null) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Project start_windows entries must be objects");
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) throw new Error("Project start_windows entries need a non-empty name");
    return {
      name,
      path: typeof item.path === "string" && item.path.trim() ? item.path.trim() : undefined,
      command: typeof item.command === "string" && item.command.trim() ? item.command.trim() : undefined,
      index: typeof item.index === "number" ? item.index : undefined,
      detached: typeof item.detached === "boolean" ? item.detached : undefined,
    };
  });
}

export function hasProjectManagementFields(input: ProjectManagementMetadataInput): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

export function hasProjectIntegrationFields(input: ProjectIntegrationInput): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

export function mergeProjectManagementMetadata(
  base: JsonObject | undefined,
  input: ProjectManagementMetadataInput,
): JsonObject | undefined {
  if (!hasProjectManagementFields(input)) return undefined;
  const metadata: JsonObject = { ...(base ?? {}) };
  const fields: Record<string, unknown> = {
    stage: normalizeStage(input.stage),
    priority: normalizePriority(input.priority),
    owner: cleanString(input.owner),
    launch_profile: cleanString(input.launch_profile),
    start_agent: normalizeStartAgent(input.start_agent),
    start_command: cleanString(input.start_command),
    start_session_policy: normalizeStartSessionPolicy(input.start_session_policy),
    start_windows: normalizeStartWindows(input.start_windows),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) delete metadata[key];
    else metadata[key] = value;
  }
  return metadata;
}

export function mergeProjectIntegrationFields(
  base: WorkspaceIntegrations | undefined,
  input: ProjectIntegrationInput,
): WorkspaceIntegrations | undefined {
  if (!hasProjectIntegrationFields(input)) return undefined;
  const integrations: WorkspaceIntegrations = { ...(base ?? {}) };
  for (const [key, rawValue] of Object.entries(input)) {
    const value = cleanString(rawValue);
    if (value === undefined) continue;
    if (value === null) delete integrations[key];
    else integrations[key] = value;
  }
  return integrations;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function startWindowsValue(value: unknown): WorkspaceTmuxWindowSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const window = item as Record<string, unknown>;
    const name = typeof window.name === "string" ? window.name.trim() : "";
    if (!name) return [];
    return [{
      name,
      path: typeof window.path === "string" && window.path.trim() ? window.path.trim() : undefined,
      command: typeof window.command === "string" && window.command.trim() ? window.command.trim() : undefined,
      index: typeof window.index === "number" ? window.index : undefined,
      detached: typeof window.detached === "boolean" ? window.detached : undefined,
    }];
  });
}

export function projectManagementSummary(project: Workspace): ProjectManagementSummary {
  return {
    stage: stringValue(project.metadata.stage),
    priority: stringValue(project.metadata.priority),
    owner: stringValue(project.metadata.owner),
    launch_profile: stringValue(project.metadata.launch_profile),
    start_agent: stringValue(project.metadata.start_agent),
    start_command: stringValue(project.metadata.start_command),
    start_session_policy: stringValue(project.metadata.start_session_policy),
    start_windows: startWindowsValue(project.metadata.start_windows),
    todos_project_id: project.integrations.todos_project_id ?? null,
    todos_task_list_id: project.integrations.todos_task_list_id ?? null,
    brief_id: project.integrations.brief_id ?? null,
    brief_path: project.integrations.brief_path ?? null,
    canvases_project_id: project.integrations.canvases_project_id ?? null,
    canvases_default_canvas_id: project.integrations.canvases_default_canvas_id ?? null,
  };
}

export function projectExternalLinksSummary(project: Workspace): ProjectExternalLinksSummary {
  const todosProjectId = project.integrations.todos_project_id ?? null;
  const todosTaskListId = project.integrations.todos_task_list_id ?? null;
  const briefId = project.integrations.brief_id ?? null;
  const briefPath = project.integrations.brief_path ?? null;
  const briefLinked = Boolean(briefId || briefPath);
  const canvasesProjectId = project.integrations.canvases_project_id ?? null;
  const canvasesDefaultCanvasId = project.integrations.canvases_default_canvas_id ?? null;

  return {
    todos: {
      linked: Boolean(todosProjectId || todosTaskListId),
      status: todosProjectId || todosTaskListId ? "linked" : "unlinked",
      project_id: todosProjectId,
      task_list_id: todosTaskListId,
    },
    brief: {
      linked: briefLinked,
      status: briefLinked ? "linked" : "unlinked",
      id: briefId,
      path: briefPath,
      path_exists: briefPath ? existsSync(briefPath) : null,
    },
    canvases: {
      linked: Boolean(canvasesProjectId || canvasesDefaultCanvasId),
      status: canvasesProjectId || canvasesDefaultCanvasId ? "linked" : "unlinked",
      project_id: canvasesProjectId,
      default_canvas_id: canvasesDefaultCanvasId,
    },
  };
}

export function projectPathHealth(project: Workspace): ProjectPathHealth {
  if (!project.primary_path) {
    return {
      status: project.kind === "remote-only" ? "remote-only" : "unknown",
      path: null,
      exists: null,
    };
  }
  const exists = existsSync(project.primary_path);
  return {
    status: exists ? "ok" : "missing",
    path: project.primary_path,
    exists,
  };
}

export function projectDashboardSummary(project: Workspace): ProjectDashboardSummary {
  const management = projectManagementSummary(project);
  return {
    management,
    external_links: projectExternalLinksSummary(project),
    path_health: projectPathHealth(project),
    launch: {
      default_agent: management.start_agent,
      default_command: management.start_command,
      default_profile: management.launch_profile,
      default_session_policy: management.start_session_policy,
      default_windows: management.start_windows,
      last_opened_at: project.last_opened_at,
    },
  };
}

export function projectWithManagement(project: Workspace): Workspace & { management: ProjectManagementSummary; external_links: ProjectExternalLinksSummary; dashboard: ProjectDashboardSummary } {
  return {
    ...project,
    management: projectManagementSummary(project),
    external_links: projectExternalLinksSummary(project),
    dashboard: projectDashboardSummary(project),
  };
}
