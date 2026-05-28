import type { Database } from "bun:sqlite";
import type { TemplateVariable, TemplateTaskInput } from "../types/index.js";
import { getDatabase } from "./database.js";
import { createTemplate, listTemplates } from "./templates.js";

export interface BuiltinTemplate {
  name: string;
  description: string;
  variables: TemplateVariable[];
  tasks: (TemplateTaskInput & { position: number; depends_on_positions?: number[] })[];
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: "open-source-project",
    description: "Full open-source project bootstrap — scaffold to publish",
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
      { position: 9, title_pattern: "Add @hasna/cloud adapter", priority: "medium", depends_on_positions: [1] },
      { position: 10, title_pattern: "Write PostgreSQL migrations for {name}", priority: "medium", depends_on_positions: [1] },
      { position: 11, title_pattern: "Add feedback system + send_feedback MCP tool", priority: "medium", depends_on_positions: [3] },
      { position: 12, title_pattern: "Add agent tools (register_agent, heartbeat, set_focus, list_agents)", priority: "medium", depends_on_positions: [3] },
      { position: 13, title_pattern: "Create RDS database for {name}", priority: "low", depends_on_positions: [10] },
      { position: 14, title_pattern: "Publish @hasna/{name} to npm", priority: "high", depends_on_positions: [6, 7, 8] },
      { position: 15, title_pattern: "Install @hasna/{name} globally and verify", priority: "medium", depends_on_positions: [14] },
    ],
  },
  {
    name: "bug-fix",
    description: "Standard bug fix workflow",
    variables: [{ name: "bug", required: true, description: "Bug description" }],
    tasks: [
      { position: 0, title_pattern: "Reproduce: {bug}", priority: "critical" },
      { position: 1, title_pattern: "Diagnose root cause of {bug}", priority: "critical", depends_on_positions: [0] },
      { position: 2, title_pattern: "Implement fix for {bug}", priority: "critical", depends_on_positions: [1] },
      { position: 3, title_pattern: "Write regression test for {bug}", priority: "high", depends_on_positions: [2] },
      { position: 4, title_pattern: "Publish fix and verify in production", priority: "high", depends_on_positions: [3] },
    ],
  },
  {
    name: "feature",
    description: "Standard feature development workflow",
    variables: [{ name: "feature", required: true }, { name: "scope", required: false, default: "medium" }],
    tasks: [
      { position: 0, title_pattern: "Write spec for {feature}", priority: "high" },
      { position: 1, title_pattern: "Design implementation approach for {feature}", priority: "high", depends_on_positions: [0] },
      { position: 2, title_pattern: "Implement {feature}", priority: "critical", depends_on_positions: [1] },
      { position: 3, title_pattern: "Write tests for {feature}", priority: "high", depends_on_positions: [2] },
      { position: 4, title_pattern: "Code review for {feature}", priority: "medium", depends_on_positions: [3] },
      { position: 5, title_pattern: "Update docs for {feature}", priority: "medium", depends_on_positions: [2] },
      { position: 6, title_pattern: "Deploy {feature}", priority: "high", depends_on_positions: [4] },
    ],
  },
  {
    name: "security-audit",
    description: "Security audit workflow",
    variables: [{ name: "target", required: true }],
    tasks: [
      { position: 0, title_pattern: "Scan {target} for vulnerabilities", priority: "critical" },
      { position: 1, title_pattern: "Review {target} security findings", priority: "critical", depends_on_positions: [0] },
      { position: 2, title_pattern: "Fix critical issues in {target}", priority: "critical", depends_on_positions: [1] },
      { position: 3, title_pattern: "Retest {target} after fixes", priority: "high", depends_on_positions: [2] },
      { position: 4, title_pattern: "Write security report for {target}", priority: "medium", depends_on_positions: [3] },
      { position: 5, title_pattern: "Close audit for {target}", priority: "low", depends_on_positions: [4] },
    ],
  },
];

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
      variables: bt.variables,
      tasks,
    }, d);

    created++;
    names.push(bt.name);
  }

  return { created, skipped, names };
}
