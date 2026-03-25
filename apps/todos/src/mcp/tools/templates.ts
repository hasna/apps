import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createTask } from "../../db/tasks.js";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (id: string, table?: string) => string;
  formatError: (e: unknown) => string;
};

export function registerTemplateTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("create_template")) {
    server.tool(
      "create_template",
      "Create a reusable task template. Optionally include a tasks array to define a multi-task template with dependencies and variable placeholders ({name} syntax). Use variables to define typed variable definitions with defaults and required flags.",
      {
        name: z.string(),
        title_pattern: z.string(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        tags: z.array(z.string()).optional(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        variables: z.array(z.object({
          name: z.string().describe("Variable name (used as {name} in patterns)"),
          required: z.boolean().describe("Whether this variable must be provided"),
          default: z.string().optional().describe("Default value if not provided"),
          description: z.string().optional().describe("Help text for the variable"),
        })).optional().describe("Typed variable definitions with defaults and required flags"),
        tasks: z.array(z.object({
          title_pattern: z.string().describe("Title pattern with optional {variable} placeholders"),
          description: z.string().optional(),
          priority: z.enum(["low", "medium", "high", "critical"]).optional(),
          tags: z.array(z.string()).optional(),
          task_type: z.string().optional(),
          depends_on: z.array(z.number()).optional().describe("Position indices (0-based) of tasks this task depends on"),
          metadata: z.record(z.unknown()).optional(),
        })).optional().describe("Multi-task template: ordered list of tasks to create together with dependencies"),
      },
      async (params) => {
        try {
          const { createTemplate, getTemplateWithTasks } = await import("../../db/templates.js");
          const t = createTemplate(params);
          const withTasks = getTemplateWithTasks(t.id);
          const taskCount = withTasks?.tasks.length ?? 0;
          const taskInfo = taskCount > 0 ? ` | ${taskCount} task(s)` : "";
          return { content: [{ type: "text" as const, text: `Template created: ${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}"${taskInfo}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_templates")) {
    server.tool(
      "list_templates",
      "List all task templates",
      {},
      async () => {
        try {
          const { listTemplates } = await import("../../db/templates.js");
          const templates = listTemplates();
          if (templates.length === 0) return { content: [{ type: "text" as const, text: "No templates." }] };
          const text = templates.map(t => {
            const vars = t.variables.length > 0 ? ` | vars: ${t.variables.map(v => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')}` : "";
            return `${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}" | ${t.priority}${vars}`;
          }).join("\n");
          return { content: [{ type: "text" as const, text: `${templates.length} template(s):\n${text}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("create_task_from_template")) {
    server.tool(
      "create_task_from_template",
      "Create task(s) from a template. For multi-task templates, creates all tasks with dependencies wired. Supports {variable} substitution in titles/descriptions.",
      {
        template_id: z.string(),
        title: z.string().optional().describe("Override title (single-task templates only)"),
        description: z.string().optional().describe("Override description (single-task templates only)"),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        assigned_to: z.string().optional(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        variables: z.record(z.string()).optional().describe("Variable substitution map for {name} placeholders in multi-task templates"),
      },
      async (params) => {
        try {
          const { taskFromTemplate, getTemplateWithTasks, tasksFromTemplate } = await import("../../db/templates.js");
          const resolvedTemplateId = resolveId(params.template_id, "task_templates");
          const templateWithTasks = getTemplateWithTasks(resolvedTemplateId);
          if (templateWithTasks && templateWithTasks.tasks.length > 0) {
            const effectiveProjectId = params.project_id || templateWithTasks.project_id || undefined;
            const tasks = tasksFromTemplate(resolvedTemplateId, effectiveProjectId, params.variables, params.task_list_id);
            const text = tasks.map(t => `${t.id.slice(0, 8)} | ${t.priority} | ${t.title}`).join("\n");
            return { content: [{ type: "text" as const, text: `${tasks.length} task(s) created from template:\n${text}` }] };
          }
          const input = taskFromTemplate(resolvedTemplateId, {
            title: params.title, description: params.description,
            priority: params.priority as any, assigned_to: params.assigned_to,
            project_id: params.project_id, task_list_id: params.task_list_id,
          });
          const task = createTask(input);
          return { content: [{ type: "text" as const, text: `Task created from template:\n${task.id.slice(0, 8)} | ${task.priority} | ${task.title}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("delete_template")) {
    server.tool(
      "delete_template",
      "Delete a task template by ID.",
      { id: z.string() },
      async ({ id }) => {
        try {
          const { deleteTemplate } = await import("../../db/templates.js");
          const resolvedId = resolveId(id, "task_templates");
          const deleted = deleteTemplate(resolvedId);
          return { content: [{ type: "text" as const, text: deleted ? "Template deleted." : "Template not found." }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("update_template")) {
    server.tool(
      "update_template",
      "Update a task template's name, title pattern, description, priority, tags, or other fields.",
      {
        id: z.string(),
        name: z.string().optional(),
        title_pattern: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        tags: z.array(z.string()).optional(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
      },
      async ({ id, ...updates }) => {
        try {
          const { updateTemplate } = await import("../../db/templates.js");
          const resolvedId = resolveId(id, "task_templates");
          const t = updateTemplate(resolvedId, updates);
          if (!t) return { content: [{ type: "text" as const, text: `Template not found: ${id}` }], isError: true };
          return { content: [{ type: "text" as const, text: `Template updated: ${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}" | ${t.priority}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("init_templates")) {
    server.tool(
      "init_templates",
      "Initialize built-in starter templates (open-source-project, bug-fix, feature, security-audit). Skips templates that already exist by name.",
      {},
      async () => {
        try {
          const { initBuiltinTemplates } = await import("../../db/builtin-templates.js");
          const result = initBuiltinTemplates();
          if (result.created === 0) return { content: [{ type: "text" as const, text: `All ${result.skipped} built-in template(s) already exist.` }] };
          return { content: [{ type: "text" as const, text: `Created ${result.created} template(s): ${result.names.join(", ")}. Skipped ${result.skipped} existing.` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("preview_template")) {
    server.tool(
      "preview_template",
      "Preview a template without creating tasks. Shows resolved titles (variables substituted), dependencies, and priorities.",
      {
        template_id: z.string(),
        variables: z.record(z.string()).optional().describe("Variable substitution map for {name} placeholders"),
      },
      async (params) => {
        try {
          const { previewTemplate } = await import("../../db/templates.js");
          const resolvedId = resolveId(params.template_id, "task_templates");
          const preview = previewTemplate(resolvedId, params.variables);
          const lines = preview.tasks.map(t => {
            const deps = t.depends_on_positions.length > 0 ? ` (after: ${t.depends_on_positions.join(", ")})` : "";
            return `  [${t.position}] ${t.priority} | ${t.title}${deps}`;
          });
          const varsInfo = preview.variables.length > 0
            ? `\nVariables: ${preview.variables.map(v => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')}`
            : "";
          const resolvedVars = Object.keys(preview.resolved_variables).length > 0
            ? `\nResolved: ${Object.entries(preview.resolved_variables).map(([k, v]) => `${k}=${v}`).join(', ')}`
            : "";
          return { content: [{ type: "text" as const, text: `Preview: ${preview.template_name} (${preview.tasks.length} tasks)${varsInfo}${resolvedVars}\n${lines.join("\n")}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("export_template")) {
    server.tool(
      "export_template",
      "Export a template as a full JSON object (template + tasks + variables). Useful for sharing or backup.",
      { template_id: z.string() },
      async ({ template_id }) => {
        try {
          const { exportTemplate } = await import("../../db/templates.js");
          const resolvedId = resolveId(template_id, "task_templates");
          const json = exportTemplate(resolvedId);
          return { content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("import_template")) {
    server.tool(
      "import_template",
      "Import a template from a JSON string (as returned by export_template). Creates new template with new IDs.",
      { json: z.string().describe("JSON string of the template export") },
      async ({ json }) => {
        try {
          const { importTemplate } = await import("../../db/templates.js");
          const parsed = JSON.parse(json);
          const t = importTemplate(parsed);
          return { content: [{ type: "text" as const, text: `Template imported: ${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}"` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("template_history")) {
    server.tool(
      "template_history",
      "Show version history of a template. Each update creates a snapshot of the previous state.",
      { template_id: z.string() },
      async ({ template_id }) => {
        try {
          const { listTemplateVersions, getTemplate } = await import("../../db/templates.js");
          const resolvedId = resolveId(template_id, "task_templates");
          const template = getTemplate(resolvedId);
          if (!template) return { content: [{ type: "text" as const, text: `Template not found: ${template_id}` }], isError: true };
          const versions = listTemplateVersions(resolvedId);
          if (versions.length === 0) return { content: [{ type: "text" as const, text: `${template.name} v${template.version} — no previous versions.` }] };
          const lines = versions.map(v => {
            const snap = JSON.parse(v.snapshot);
            return `v${v.version} | ${v.created_at} | ${snap.name} | "${snap.title_pattern}"`;
          });
          return { content: [{ type: "text" as const, text: `${template.name} — current: v${template.version}\n${lines.join("\n")}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }
}
