/**
 * User-authored local scaffolds — tasks, projects, plans, checklists, contracts,
 * verification policies. Versioned, variable-driven, fully offline.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import {
  getTemplate,
  updateTemplate,
  exportTemplate,
  importTemplate,
  previewTemplate,
  tasksFromTemplate,
  listTemplates,
  type TemplateExport,
} from "../db/templates.js";
import { createPlan } from "../db/plans.js";
import type { TemplateVariable } from "../types/index.js";

export const USER_SCAFFOLD_SCHEMA = "todos.user_scaffold.v1";

export const SCAFFOLD_KINDS = ["task", "project", "plan", "checklist", "contract", "verification_policy"] as const;
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number];

export interface UserScaffold {
  schema_version: typeof USER_SCAFFOLD_SCHEMA;
  id: string;
  name: string;
  slug: string;
  kind: ScaffoldKind;
  version: number;
  description: string | null;
  variables: TemplateVariable[];
  payload: Record<string, unknown>;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserScaffoldStore {
  schema_version: typeof USER_SCAFFOLD_SCHEMA;
  scaffolds: Record<string, UserScaffold>;
  updated_at: string;
}

export interface ScaffoldPreview {
  schema_version: typeof USER_SCAFFOLD_SCHEMA;
  scaffold_id: string;
  kind: ScaffoldKind;
  dry_run: true;
  resolved_variables: Record<string, string>;
  preview: Record<string, unknown>;
}

function storeDir(cwd = process.cwd()): string {
  return join(cwd, ".todos", "scaffolds");
}

function storePath(cwd?: string): string {
  return join(storeDir(cwd), "store.json");
}

function versionsDir(cwd?: string): string {
  return join(storeDir(cwd), "versions");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function emptyStore(): UserScaffoldStore {
  return { schema_version: USER_SCAFFOLD_SCHEMA, scaffolds: {}, updated_at: new Date(0).toISOString() };
}

export function loadUserScaffoldStore(cwd?: string): UserScaffoldStore {
  const path = storePath(cwd);
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as UserScaffoldStore;
  if (parsed.schema_version !== USER_SCAFFOLD_SCHEMA) {
    throw new Error(`Unsupported scaffold store schema: ${parsed.schema_version}`);
  }
  return parsed;
}

export function saveUserScaffoldStore(store: UserScaffoldStore, cwd?: string): void {
  mkdirSync(storeDir(cwd), { recursive: true });
  store.updated_at = now();
  writeFileSync(storePath(cwd), JSON.stringify(store, null, 2), "utf8");
}

function snapshotVersion(scaffold: UserScaffold, cwd?: string): void {
  mkdirSync(versionsDir(cwd), { recursive: true });
  const path = join(versionsDir(cwd), `${scaffold.id}-v${scaffold.version}.json`);
  writeFileSync(path, JSON.stringify(scaffold, null, 2), "utf8");
}

export function listUserScaffolds(kind?: ScaffoldKind, cwd?: string): UserScaffold[] {
  const store = loadUserScaffoldStore(cwd);
  return Object.values(store.scaffolds)
    .filter((s) => !kind || s.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUserScaffold(idOrSlug: string, cwd?: string): UserScaffold | null {
  const store = loadUserScaffoldStore(cwd);
  return (
    store.scaffolds[idOrSlug]
    ?? Object.values(store.scaffolds).find((s) => s.slug === idOrSlug || s.id.startsWith(idOrSlug))
    ?? null
  );
}

export function createUserScaffold(
  input: {
    name: string;
    kind: ScaffoldKind;
    description?: string;
    variables?: TemplateVariable[];
    payload?: Record<string, unknown>;
    template_export?: TemplateExport;
  },
  db?: Database,
  cwd?: string,
): UserScaffold {
  const d = db || getDatabase();
  const store = loadUserScaffoldStore(cwd);
  const id = uuid();
  const ts = now();
  const slug = slugify(input.name);

  if (Object.values(store.scaffolds).some((s) => s.slug === slug)) {
    throw new Error(`Scaffold slug already exists: ${slug}`);
  }

  let templateId: string | null = null;
  if (input.kind === "task" && input.template_export) {
    const imported = importTemplate(input.template_export, d);
    templateId = imported.id;
  } else if (input.kind === "task" && input.payload?.template_id) {
    templateId = String(input.payload.template_id);
  }

  const scaffold: UserScaffold = {
    schema_version: USER_SCAFFOLD_SCHEMA,
    id,
    name: input.name,
    slug,
    kind: input.kind,
    version: 1,
    description: input.description ?? null,
    variables: input.variables ?? [],
    payload: input.payload ?? {},
    template_id: templateId,
    created_at: ts,
    updated_at: ts,
  };

  store.scaffolds[id] = scaffold;
  saveUserScaffoldStore(store, cwd);
  snapshotVersion(scaffold, cwd);
  return scaffold;
}

export function updateUserScaffold(
  idOrSlug: string,
  updates: {
    name?: string;
    description?: string;
    variables?: TemplateVariable[];
    payload?: Record<string, unknown>;
    template_export?: TemplateExport;
    migrate?: "safe" | "force";
  },
  db?: Database,
  cwd?: string,
): UserScaffold {
  const d = db || getDatabase();
  const store = loadUserScaffoldStore(cwd);
  const existing = getUserScaffold(idOrSlug, cwd);
  if (!existing) throw new Error(`Scaffold not found: ${idOrSlug}`);

  snapshotVersion(existing, cwd);

  if (updates.name && slugify(updates.name) !== existing.slug) {
    const newSlug = slugify(updates.name);
    if (Object.values(store.scaffolds).some((s) => s.id !== existing.id && s.slug === newSlug)) {
      throw new Error(`Scaffold slug conflict: ${newSlug}`);
    }
    existing.slug = newSlug;
    existing.name = updates.name;
  }

  if (updates.description !== undefined) existing.description = updates.description;
  if (updates.variables !== undefined) existing.variables = updates.variables;
  if (updates.payload !== undefined) {
    if (updates.migrate === "force" || !existing.payload || updates.migrate === "safe") {
      existing.payload = { ...existing.payload, ...updates.payload };
    }
  }

  if (existing.kind === "task" && updates.template_export) {
    if (existing.template_id && updates.migrate !== "force") {
      updateTemplate(existing.template_id, {
        name: updates.template_export.name,
        title_pattern: updates.template_export.title_pattern,
        description: updates.template_export.description,
        priority: updates.template_export.priority as "low" | "medium" | "high" | "critical",
        tags: updates.template_export.tags,
        variables: updates.template_export.variables,
        metadata: updates.template_export.metadata,
      }, d);
    } else {
      const imported = importTemplate(updates.template_export, d);
      existing.template_id = imported.id;
    }
  }

  existing.version += 1;
  existing.updated_at = now();
  store.scaffolds[existing.id] = existing;
  saveUserScaffoldStore(store, cwd);
  snapshotVersion(existing, cwd);
  return existing;
}

function resolveVariables(variables: TemplateVariable[], provided: Record<string, string> = {}): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const v of variables) {
    resolved[v.name] = provided[v.name] ?? v.default ?? "";
  }
  return resolved;
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export function previewUserScaffold(
  idOrSlug: string,
  variables: Record<string, string> = {},
  db?: Database,
  cwd?: string,
): ScaffoldPreview {
  const d = db || getDatabase();
  const scaffold = getUserScaffold(idOrSlug, cwd);
  if (!scaffold) throw new Error(`Scaffold not found: ${idOrSlug}`);

  const resolved = resolveVariables(scaffold.variables, variables);
  const preview: Record<string, unknown> = { kind: scaffold.kind, name: scaffold.name };

  switch (scaffold.kind) {
    case "task":
      if (scaffold.template_id) {
        preview.template = previewTemplate(scaffold.template_id, variables, d);
      } else {
        preview.title = substitute(String(scaffold.payload.title ?? scaffold.name), resolved);
      }
      break;
    case "plan":
      preview.plan = {
        name: substitute(String(scaffold.payload.name ?? scaffold.name), resolved),
        description: scaffold.payload.description ? substitute(String(scaffold.payload.description), resolved) : null,
        steps: scaffold.payload.steps ?? [],
      };
      break;
    case "project":
      preview.project = {
        name: substitute(String(scaffold.payload.name ?? scaffold.name), resolved),
        path: substitute(String(scaffold.payload.path ?? ""), resolved),
      };
      break;
    case "checklist":
      preview.checklist = scaffold.payload.items ?? [];
      break;
    case "contract":
      preview.contract = scaffold.payload.criteria ?? scaffold.payload;
      break;
    case "verification_policy":
      preview.policy = scaffold.payload;
      break;
  }

  return {
    schema_version: USER_SCAFFOLD_SCHEMA,
    scaffold_id: scaffold.id,
    kind: scaffold.kind,
    dry_run: true,
    resolved_variables: resolved,
    preview,
  };
}

export function applyUserScaffold(
  idOrSlug: string,
  variables: Record<string, string> = {},
  db?: Database,
  cwd?: string,
): Record<string, unknown> {
  const d = db || getDatabase();
  const scaffold = getUserScaffold(idOrSlug, cwd);
  if (!scaffold) throw new Error(`Scaffold not found: ${idOrSlug}`);

  switch (scaffold.kind) {
    case "task": {
      if (!scaffold.template_id) throw new Error("Task scaffold missing template_id");
      const tasks = tasksFromTemplate(scaffold.template_id, undefined, variables, undefined, d);
      return { kind: scaffold.kind, tasks };
    }
    case "plan": {
      const preview = previewUserScaffold(idOrSlug, variables, d, cwd);
      const p = preview.preview.plan as { name: string; description?: string };
      const plan = createPlan({ name: p.name, description: p.description }, d);
      return { kind: scaffold.kind, plan };
    }
    default: {
      const preview = previewUserScaffold(idOrSlug, variables, d, cwd);
      return { kind: scaffold.kind, applied: false, preview: preview.preview, message: "Dry-run only for this kind; use preview" };
    }
  }
}

export function exportUserScaffold(idOrSlug: string, db?: Database, cwd?: string): UserScaffold & { template?: TemplateExport } {
  const scaffold = getUserScaffold(idOrSlug, cwd);
  if (!scaffold) throw new Error(`Scaffold not found: ${idOrSlug}`);
  const out: UserScaffold & { template?: TemplateExport } = { ...scaffold };
  if (scaffold.template_id) {
    out.template = exportTemplate(scaffold.template_id, db);
  }
  return out;
}

export function importUserScaffold(
  payload: UserScaffold & { template?: TemplateExport },
  strategy: "skip" | "overwrite" = "skip",
  db?: Database,
  cwd?: string,
): UserScaffold {
  if (payload.schema_version !== USER_SCAFFOLD_SCHEMA) {
    throw new Error(`Unsupported scaffold schema: ${payload.schema_version}`);
  }

  const existing = getUserScaffold(payload.slug, cwd) ?? getUserScaffold(payload.id, cwd);
  if (existing && strategy === "skip") return existing;

  if (existing) {
    return updateUserScaffold(existing.id, {
      name: payload.name,
      description: payload.description ?? undefined,
      variables: payload.variables,
      payload: payload.payload,
      template_export: payload.template,
      migrate: "force",
    }, db, cwd);
  }

  return createUserScaffold({
    name: payload.name,
    kind: payload.kind,
    description: payload.description ?? undefined,
    variables: payload.variables,
    payload: payload.payload,
    template_export: payload.template,
  }, db, cwd);
}

export function linkTemplateAsScaffold(templateId: string, name?: string, db?: Database, cwd?: string): UserScaffold {
  const template = getTemplate(templateId, db);
  if (!template) throw new Error(`Template not found: ${templateId}`);
  return createUserScaffold({
    name: name ?? template.name,
    kind: "task",
    description: template.description ?? undefined,
    variables: template.variables,
    payload: { template_id: template.id },
  }, db, cwd);
}

export function getUserScaffoldDocs(): string {
  return `# User scaffolds

Project-local scaffolds in \`.todos/scaffolds/\` with version snapshots.

\`\`\`bash
todos scaffolds list
todos scaffolds create --kind plan --name "Release train" --file plan.json
todos scaffolds preview <slug> --var env=staging
todos scaffolds apply <slug> --var feature=auth
todos scaffolds export <slug> --out scaffold.json
\`\`\`
`;
}

export function listLinkedTemplates(db?: Database, cwd?: string): Array<{ template_id: string; template_name: string; scaffold: UserScaffold }> {
  const templates = listTemplates(db);
  const scaffolds = listUserScaffolds(undefined, cwd);
  return templates
    .map((t) => {
      const scaffold = scaffolds.find((s) => s.template_id === t.id);
      return scaffold ? { template_id: t.id, template_name: t.name, scaffold } : null;
    })
    .filter(Boolean) as Array<{ template_id: string; template_name: string; scaffold: UserScaffold }>;
}
