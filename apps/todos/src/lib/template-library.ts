/**
 * Marketplace-free local template library — bundled workflows, preview, import/export.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import {
  BUILTIN_TEMPLATES,
  TEMPLATE_LIBRARY_SCHEMA,
  initBuiltinTemplates,
  type BuiltinTemplate,
} from "../db/builtin-templates.js";
import { previewTemplate, exportTemplate, importTemplate, listTemplates } from "../db/templates.js";

export { TEMPLATE_LIBRARY_SCHEMA, BUILTIN_TEMPLATES };

export interface TemplateLibraryEntry {
  schema_version: typeof TEMPLATE_LIBRARY_SCHEMA;
  name: string;
  version: string;
  category: BuiltinTemplate["category"];
  description: string;
  task_count: number;
  variables: BuiltinTemplate["variables"];
  installed: boolean;
}

export interface TemplateLibraryCatalog {
  schema_version: typeof TEMPLATE_LIBRARY_SCHEMA;
  exported_at: string;
  templates: TemplateLibraryEntry[];
}

export interface TemplateLibraryExport {
  schema_version: typeof TEMPLATE_LIBRARY_SCHEMA;
  exported_at: string;
  template: ReturnType<typeof exportTemplate>;
}

export function listTemplateLibrary(db?: Database): TemplateLibraryEntry[] {
  const d = getDatabase(db);
  const installed = new Set(listTemplates(d).map((t) => t.name));

  return BUILTIN_TEMPLATES.map((bt) => ({
    schema_version: TEMPLATE_LIBRARY_SCHEMA,
    name: bt.name,
    version: bt.version,
    category: bt.category,
    description: bt.description,
    task_count: bt.tasks.length,
    variables: bt.variables,
    installed: installed.has(bt.name),
  }));
}

export function getBuiltinTemplate(name: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.name === name) ?? null;
}

export function previewBuiltinTemplate(
  name: string,
  variables: Record<string, string> = {},
): { name: string; tasks: Array<{ position: number; title: string; priority?: string }> } | null {
  const bt = getBuiltinTemplate(name);
  if (!bt) return null;

  const resolved = { ...Object.fromEntries(bt.variables.filter((v) => v.default).map((v) => [v.name, v.default!])), ...variables };

  return {
    name: bt.name,
    tasks: bt.tasks.map((t) => ({
      position: t.position,
      title: t.title_pattern.replace(/\{(\w+)\}/g, (_, k) => resolved[k] ?? `{${k}}`),
      priority: t.priority,
    })),
  };
}

export function installTemplateLibrary(db?: Database): ReturnType<typeof initBuiltinTemplates> {
  return initBuiltinTemplates(db);
}

export function exportTemplateLibraryCatalog(path?: string, db?: Database): TemplateLibraryCatalog {
  const catalog: TemplateLibraryCatalog = {
    schema_version: TEMPLATE_LIBRARY_SCHEMA,
    exported_at: new Date().toISOString(),
    templates: listTemplateLibrary(db),
  };
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(catalog, null, 2), "utf8");
  }
  return catalog;
}

export function exportInstalledTemplate(name: string, db?: Database): TemplateLibraryExport | null {
  const d = getDatabase(db);
  const template = listTemplates(d).find((t) => t.name === name);
  if (!template) return null;
  return {
    schema_version: TEMPLATE_LIBRARY_SCHEMA,
    exported_at: new Date().toISOString(),
    template: exportTemplate(template.id, d),
  };
}

export function importTemplateFromFile(path: string, db?: Database): { id: string; name: string } {
  const d = getDatabase(db);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const payload = raw.template ?? raw;
  const created = importTemplate(payload, d);
  return { id: created.id, name: created.name };
}

export function previewInstalledTemplate(
  name: string,
  variables: Record<string, string> = {},
  db?: Database,
): ReturnType<typeof previewTemplate> | null {
  const d = getDatabase(db);
  const template = listTemplates(d).find((t) => t.name === name);
  if (!template) return previewBuiltinTemplate(name, variables) as ReturnType<typeof previewTemplate> | null;
  return previewTemplate(template.id, variables, d);
}

export function getTemplateLibraryDocs(): string {
  return `# Local Template Library (${TEMPLATE_LIBRARY_SCHEMA})

Marketplace-free bundled workflows — no network required.

## Categories
- **bug-fix** — defect reproduction, diagnosis, test, implementation, release
- **feature** — feature-implementation
- **security** — security-review
- **release** — release verification and publishing
- **migration** — schema and data migration
- **incident** — incident and incident-response
- **docs** — docs-refresh
- **qa** — QA matrix, checks, defects, signoff
- **project** — open-source-project bootstrap

## CLI
\`\`\`bash
todos templates library list
todos templates library preview bug-fix --var bug="login fails"
todos templates library install
todos templates library export ./catalog.json
\`\`\`
`;
}
