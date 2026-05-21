import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateVariable, TemplateTaskInput } from "../types/index.js";
import { getDatabase } from "./database.js";
import { createTemplate, listTemplates } from "./templates.js";
import type { TemplateExport } from "./templates.js";

export const BUILTIN_TEMPLATE_LIBRARY_VERSION = "2026-05-21";
export const BUILTIN_TEMPLATE_LIBRARY_SOURCE = "bundled-local-template-library";

export interface BuiltinTemplate {
  name: string;
  description: string;
  category: string;
  version: string;
  variables: TemplateVariable[];
  tasks: (TemplateTaskInput & { position: number; depends_on_positions?: number[] })[];
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: "bug-fix",
    description: "Reproduce, diagnose, fix, test, and release a defect.",
    category: "bug-fix",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "bug", required: true, description: "Bug description" }],
    tasks: [
      { position: 0, title_pattern: "Reproduce: {bug}", priority: "critical", tags: ["bug", "repro"] },
      { position: 1, title_pattern: "Diagnose root cause of {bug}", priority: "critical", tags: ["bug", "diagnosis"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Write regression test for {bug}", priority: "high", tags: ["bug", "test"], depends_on_positions: [1] },
      { position: 3, title_pattern: "Implement fix for {bug}", priority: "critical", tags: ["bug", "implementation"], depends_on_positions: [2] },
      { position: 4, title_pattern: "Run full verification for {bug}", priority: "high", tags: ["bug", "verification"], depends_on_positions: [3] },
      { position: 5, title_pattern: "Publish and smoke test fix for {bug}", priority: "high", tags: ["bug", "release"], depends_on_positions: [4] },
    ],
  },
  {
    name: "feature-implementation",
    description: "Plan, build, test, document, and release a product feature.",
    category: "feature",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [
      { name: "feature", required: true, description: "Feature name" },
      { name: "scope", required: false, default: "medium", description: "Implementation size or risk" },
    ],
    tasks: [
      { position: 0, title_pattern: "Define acceptance criteria for {feature}", priority: "high", tags: ["feature", "spec"] },
      { position: 1, title_pattern: "Design {scope} implementation plan for {feature}", priority: "high", tags: ["feature", "design"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Implement {feature}", priority: "critical", tags: ["feature", "implementation"], depends_on_positions: [1] },
      { position: 3, title_pattern: "Add tests for {feature}", priority: "high", tags: ["feature", "test"], depends_on_positions: [2] },
      { position: 4, title_pattern: "Update docs for {feature}", priority: "medium", tags: ["feature", "docs"], depends_on_positions: [2] },
      { position: 5, title_pattern: "Run release checks for {feature}", priority: "high", tags: ["feature", "verification"], depends_on_positions: [3, 4] },
    ],
  },
  {
    name: "security-review",
    description: "Threat model, test, remediate, and report on security posture.",
    category: "security",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "target", required: true, description: "System, package, or change under review" }],
    tasks: [
      { position: 0, title_pattern: "Map trust boundaries for {target}", priority: "critical", tags: ["security", "threat-model"] },
      { position: 1, title_pattern: "Scan {target} for vulnerabilities and secret exposure", priority: "critical", tags: ["security", "scan"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Review authz, data access, and dependency risks in {target}", priority: "critical", tags: ["security", "review"], depends_on_positions: [0] },
      { position: 3, title_pattern: "Fix critical security findings in {target}", priority: "critical", tags: ["security", "fix"], depends_on_positions: [1, 2] },
      { position: 4, title_pattern: "Retest {target} security fixes", priority: "high", tags: ["security", "verification"], depends_on_positions: [3] },
      { position: 5, title_pattern: "Write local security review report for {target}", priority: "medium", tags: ["security", "report"], depends_on_positions: [4] },
    ],
  },
  {
    name: "release",
    description: "Prepare, verify, publish, install, and smoke test a package release.",
    category: "release",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [
      { name: "package", required: true, description: "Package name" },
      { name: "version", required: false, default: "patch", description: "Release version or bump type" },
    ],
    tasks: [
      { position: 0, title_pattern: "Prepare {package} {version} release notes", priority: "medium", tags: ["release", "docs"] },
      { position: 1, title_pattern: "Run full tests for {package}", priority: "critical", tags: ["release", "test"] },
      { position: 2, title_pattern: "Run build and release verification for {package}", priority: "critical", tags: ["release", "verification"], depends_on_positions: [1] },
      { position: 3, title_pattern: "Scan {package} release diff for secrets", priority: "critical", tags: ["release", "security"], depends_on_positions: [2] },
      { position: 4, title_pattern: "Publish {package} {version}", priority: "high", tags: ["release", "publish"], depends_on_positions: [3] },
      { position: 5, title_pattern: "Install and smoke test published {package}", priority: "high", tags: ["release", "smoke"], depends_on_positions: [4] },
    ],
  },
  {
    name: "migration",
    description: "Plan, test, apply, and verify a schema or data migration.",
    category: "migration",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "migration", required: true, description: "Migration name or objective" }],
    tasks: [
      { position: 0, title_pattern: "Design migration plan for {migration}", priority: "critical", tags: ["migration", "plan"] },
      { position: 1, title_pattern: "Write rollback plan for {migration}", priority: "critical", tags: ["migration", "rollback"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Implement migration {migration}", priority: "critical", tags: ["migration", "implementation"], depends_on_positions: [0] },
      { position: 3, title_pattern: "Test migration {migration} on fixture data", priority: "high", tags: ["migration", "test"], depends_on_positions: [2] },
      { position: 4, title_pattern: "Run migration {migration} verification and drift checks", priority: "high", tags: ["migration", "verification"], depends_on_positions: [1, 3] },
      { position: 5, title_pattern: "Document migration {migration} evidence", priority: "medium", tags: ["migration", "docs"], depends_on_positions: [4] },
    ],
  },
  {
    name: "incident",
    description: "Triage, mitigate, repair, verify, and retrospect an incident.",
    category: "incident",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "incident", required: true, description: "Incident summary" }],
    tasks: [
      { position: 0, title_pattern: "Triage incident: {incident}", priority: "critical", tags: ["incident", "triage"] },
      { position: 1, title_pattern: "Mitigate customer impact for {incident}", priority: "critical", tags: ["incident", "mitigation"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Diagnose root cause for {incident}", priority: "critical", tags: ["incident", "diagnosis"], depends_on_positions: [0] },
      { position: 3, title_pattern: "Implement durable repair for {incident}", priority: "critical", tags: ["incident", "repair"], depends_on_positions: [2] },
      { position: 4, title_pattern: "Verify recovery from {incident}", priority: "high", tags: ["incident", "verification"], depends_on_positions: [1, 3] },
      { position: 5, title_pattern: "Write retrospective for {incident}", priority: "medium", tags: ["incident", "retro"], depends_on_positions: [4] },
    ],
  },
  {
    name: "docs-refresh",
    description: "Audit, update, validate, and publish documentation changes.",
    category: "docs",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "area", required: true, description: "Documentation area or product surface" }],
    tasks: [
      { position: 0, title_pattern: "Audit current docs for {area}", priority: "medium", tags: ["docs", "audit"] },
      { position: 1, title_pattern: "Update examples and commands for {area}", priority: "medium", tags: ["docs", "examples"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Validate docs snippets for {area}", priority: "high", tags: ["docs", "verification"], depends_on_positions: [1] },
      { position: 3, title_pattern: "Refresh screenshots or generated artifacts for {area}", priority: "medium", tags: ["docs", "assets"], depends_on_positions: [1] },
      { position: 4, title_pattern: "Publish docs refresh for {area}", priority: "medium", tags: ["docs", "release"], depends_on_positions: [2, 3] },
    ],
  },
  {
    name: "qa",
    description: "Build a focused QA plan, execute checks, file defects, and sign off.",
    category: "qa",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [{ name: "target", required: true, description: "Feature, release, or workflow under QA" }],
    tasks: [
      { position: 0, title_pattern: "Create QA matrix for {target}", priority: "high", tags: ["qa", "plan"] },
      { position: 1, title_pattern: "Run happy-path QA for {target}", priority: "high", tags: ["qa", "manual"], depends_on_positions: [0] },
      { position: 2, title_pattern: "Run edge-case QA for {target}", priority: "high", tags: ["qa", "edge-cases"], depends_on_positions: [0] },
      { position: 3, title_pattern: "File and dedupe QA defects for {target}", priority: "medium", tags: ["qa", "bugs"], depends_on_positions: [1, 2] },
      { position: 4, title_pattern: "Verify QA fixes for {target}", priority: "high", tags: ["qa", "verification"], depends_on_positions: [3] },
      { position: 5, title_pattern: "Record QA signoff for {target}", priority: "medium", tags: ["qa", "signoff"], depends_on_positions: [4] },
    ],
  },
  {
    name: "open-source-project",
    description: "Full open-source project bootstrap — scaffold to publish",
    category: "open-source",
    version: BUILTIN_TEMPLATE_LIBRARY_VERSION,
    variables: [
      { name: "name", required: true, description: "Service name" },
      { name: "org", required: false, default: "hasna", description: "GitHub org" },
    ],
    tasks: [
      { position: 0, title_pattern: "Scaffold {name} package structure", priority: "critical" },
      { position: 1, title_pattern: "Create {name} SQLite database + migrations", priority: "critical", depends_on_positions: [0] },
      { position: 2, title_pattern: "Implement {name} CRUD operations", priority: "high", depends_on_positions: [1] },
      { position: 3, title_pattern: "Build {name} MCP server with standard tools", priority: "high", depends_on_positions: [2] },
      { position: 4, title_pattern: "Build {name} CLI with Commander.js", priority: "high", depends_on_positions: [2] },
      { position: 5, title_pattern: "Build {name} REST API", priority: "medium", depends_on_positions: [2] },
      { position: 6, title_pattern: "Write unit tests for {name}", priority: "high", depends_on_positions: [2, 3, 4] },
      { position: 7, title_pattern: "Add Apache 2.0 license and README", priority: "medium", depends_on_positions: [0] },
      { position: 8, title_pattern: "Create GitHub repo {org}/{name}", priority: "medium", depends_on_positions: [7] },
      { position: 9, title_pattern: "Add local backup and restore workflow for {name}", priority: "medium", depends_on_positions: [1] },
      { position: 10, title_pattern: "Add agent tools (register_agent, heartbeat, set_focus, list_agents)", priority: "medium", depends_on_positions: [3] },
      { position: 11, title_pattern: "Publish @hasna/{name} to npm", priority: "high", depends_on_positions: [6, 7, 8] },
      { position: 12, title_pattern: "Install @hasna/{name} globally and verify", priority: "medium", depends_on_positions: [11] },
    ],
  },
];

function templateMetadata(template: BuiltinTemplate): Record<string, unknown> {
  return {
    source: BUILTIN_TEMPLATE_LIBRARY_SOURCE,
    library_version: template.version,
    category: template.category,
    template_file: `${template.name}.json`,
    local_only: true,
    marketplace_free: true,
  };
}

export function listBuiltinTemplates(): BuiltinTemplate[] {
  return BUILTIN_TEMPLATES.map((template) => ({
    ...template,
    variables: template.variables.map((variable) => ({ ...variable })),
    tasks: template.tasks.map((task) => ({ ...task, tags: task.tags ? [...task.tags] : undefined })),
  }));
}

export function getBuiltinTemplate(name: string): BuiltinTemplate | null {
  return listBuiltinTemplates().find((template) => template.name === name) ?? null;
}

export function exportBuiltinTemplate(name: string): TemplateExport {
  const template = getBuiltinTemplate(name);
  if (!template) throw new Error(`Built-in template not found: ${name}`);
  return {
    name: template.name,
    title_pattern: `${template.name}: {${template.variables[0]?.name ?? "name"}}`,
    description: template.description,
    priority: "medium",
    tags: [template.category, "local-template"],
    variables: template.variables,
    project_id: null,
    plan_id: null,
    metadata: templateMetadata(template),
    tasks: template.tasks.map((task) => ({
      position: task.position,
      title_pattern: task.title_pattern,
      description: task.description ?? null,
      priority: task.priority ?? "medium",
      tags: task.tags ?? [template.category],
      task_type: task.task_type ?? null,
      condition: task.condition ?? null,
      include_template_id: task.include_template_id ?? null,
      depends_on_positions: task.depends_on_positions ?? task.depends_on ?? [],
      metadata: task.metadata ?? { category: template.category },
    })),
  };
}

export function exportBuiltinTemplateFiles(): Array<{ filename: string; template: TemplateExport }> {
  return BUILTIN_TEMPLATES.map((template) => ({
    filename: `${template.name}.json`,
    template: exportBuiltinTemplate(template.name),
  }));
}

export function writeBuiltinTemplateFiles(directory: string): { directory: string; written: number; files: string[] } {
  mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  for (const entry of exportBuiltinTemplateFiles()) {
    const path = join(directory, entry.filename);
    writeFileSync(path, `${JSON.stringify(entry.template, null, 2)}\n`, "utf-8");
    files.push(path);
  }
  return { directory, written: files.length, files };
}

/**
 * Initialize built-in templates. Skips any template whose name already exists.
 * Returns the count of templates created.
 */
export function initBuiltinTemplates(db?: Database): { created: number; skipped: number; names: string[] } {
  const d = db || getDatabase();
  const existing = listTemplates(d);
  const existingNames = new Set(existing.map(t => t.name));

  let created = 0;
  let skipped = 0;
  const names: string[] = [];

  for (const bt of BUILTIN_TEMPLATES) {
    if (existingNames.has(bt.name)) {
      skipped++;
      continue;
    }

    // Convert builtin format to CreateTemplateInput
    const tasks = bt.tasks.map(t => ({
      title_pattern: t.title_pattern,
      description: t.description,
      priority: t.priority as any,
      tags: t.tags,
      task_type: t.task_type,
      depends_on: t.depends_on_positions || t.depends_on,
      metadata: t.metadata,
    }));

    createTemplate({
      name: bt.name,
      title_pattern: `${bt.name}: {${bt.variables[0]?.name || "name"}}`,
      description: bt.description,
      tags: [bt.category, "local-template"],
      variables: bt.variables,
      metadata: templateMetadata(bt),
      tasks,
    }, d);

    created++;
    names.push(bt.name);
  }

  return { created, skipped, names };
}
