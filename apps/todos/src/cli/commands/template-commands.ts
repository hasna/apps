import type { Command } from "commander";
import chalk from "chalk";
import type { TemplatePreview } from "../../db/templates.js";
import type { Task, TemplateWithTasks } from "../../types/index.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import {
  evaluateTemplateCondition,
  resolveTemplateVariables,
  substituteTemplateVariables,
} from "../../lib/template-semantics.js";
import {
  formatTaskLine,
  handleError,
  output,
  outputRecord,
} from "../helpers.js";
import {
  getTodosCloudClient,
  cloudCreateTask,
  cloudCreateTemplate,
  cloudAddDependency,
  cloudDeleteTemplate,
  cloudGetTemplate as fetchTemplate,
  cloudResolveProjectRef,
} from "../cloud-router.js";
import { assertTemplateApiEnvironment } from "../../lib/template-client-boundary.js";
import {
  initializeSharedTemplates,
  readSharedTemplateHistory,
  updateSharedTemplate,
  listSharedTemplates as cloudListTemplates,
} from "../template-api.js";

function requireTemplateClient(): HasnaStorageClient {
  assertTemplateApiEnvironment(process.env);
  const client = getTodosCloudClient();
  if (!client)
    throw new Error(
      "Templates require HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, or saved account credentials",
    );
  return client;
}
async function cloudGetTemplate(
  client: HasnaStorageClient,
  ref: string,
): Promise<TemplateWithTasks | null> {
  if (!ref.trim()) throw new Error("Blank template ID prefix");
  const direct = await fetchTemplate(client, ref);
  if (direct?.id === ref) return direct;
  const rows = await cloudListTemplates(client);
  const exact = rows.find((row) => row.id === ref);
  const matches = exact
    ? [exact]
    : rows.filter((row) => row.id.startsWith(ref));
  if (!ref.trim() || matches.length > 1)
    throw new Error("Ambiguous or blank template ID prefix");
  return matches[0] ? fetchTemplate(client, matches[0].id) : null;
}
interface TemplateApplyProgress {
  tasks: Task[];
  dependencies: Array<{ task_id: string; depends_on: string }>;
  pending: string | null;
}
class TemplateApplyError extends Error {
  constructor(readonly progress: TemplateApplyProgress) {
    super(
      "Template application did not finish; inspect confirmed tasks before retrying",
    );
  }
}
function reportTemplateError(error: unknown, jsonMode: boolean): void {
  if (!(error instanceof TemplateApplyError)) {
    handleError(error);
    return;
  }
  outputRecord(
    {
      error: error.message,
      status: error.progress.pending ? "ambiguous" : "partial",
      created_task_ids: error.progress.tasks.map((task) => task.id),
      confirmed_dependencies: error.progress.dependencies,
      pending_operation: error.progress.pending,
      do_not_retry: true,
    },
    jsonMode,
  );
  process.exitCode = 1;
}
async function preflightTemplate(
  client: HasnaStorageClient,
  template: TemplateWithTasks,
  variables: Record<string, string>,
  seen = new Set<string>(),
): Promise<void> {
  if (seen.has(template.id) || seen.size >= 32)
    throw new Error("Circular or excessively deep template include graph");
  seen.add(template.id);
  try {
    const resolved = resolveTemplateVariables(
      template.variables ?? [],
      variables,
    );
    for (const step of template.tasks) {
      if (step.include_template_id) {
        const included = await cloudGetTemplate(
          client,
          step.include_template_id,
        );
        if (!included) throw new Error("Included template not found");
        await preflightTemplate(client, included, resolved, seen);
      } else if (step.condition)
        evaluateTemplateCondition(step.condition, resolved);
    }
  } finally {
    seen.delete(template.id);
  }
}
interface RemoteTemplateApplication {
  tasks: Task[];
}

interface RemoteTemplateOverrides {
  title?: string;
  description?: string;
  priority?: TemplateWithTasks["priority"];
}

function normalizeTemplateDescription(
  value: string | null | undefined,
): string | null {
  return value || null;
}

/**
 * Keep cloud preview output byte-for-byte compatible with the canonical local
 * preview contract. Preview intentionally shows only the template's direct
 * checklist steps; execution handles included templates separately.
 */
function previewRemoteTemplate(
  template: TemplateWithTasks,
  variables?: Record<string, string>,
): TemplatePreview {
  const resolved = resolveTemplateVariables(
    template.variables ?? [],
    variables,
  );
  const renderDescription = (value: string | null) => {
    if (!value) return null;
    return substituteTemplateVariables(value, resolved) || null;
  };

  if (template.tasks.length === 0) {
    return {
      template_id: template.id,
      template_name: template.name,
      description: normalizeTemplateDescription(template.description),
      variables: template.variables,
      resolved_variables: resolved,
      tasks: [
        {
          position: 0,
          title: substituteTemplateVariables(template.title_pattern, resolved),
          description: renderDescription(template.description),
          priority: template.priority,
          tags: template.tags,
          task_type: null,
          depends_on_positions: [],
        },
      ],
    };
  }

  return {
    template_id: template.id,
    template_name: template.name,
    description: normalizeTemplateDescription(template.description),
    variables: template.variables,
    resolved_variables: resolved,
    tasks: template.tasks
      .filter(
        (step) =>
          !step.condition ||
          evaluateTemplateCondition(step.condition, resolved),
      )
      .map((step) => ({
        position: step.position,
        title: substituteTemplateVariables(step.title_pattern, resolved),
        description: renderDescription(step.description),
        priority: step.priority,
        tags: step.tags,
        task_type: step.task_type,
        depends_on_positions: step.depends_on_positions,
      })),
  };
}

/**
 * /v1/templates/:id returns the complete template, including ordered checklist
 * steps. Strip storage-only fields so cloud exports round-trip through the
 * canonical template-import contract just like local exports.
 */
function exportRemoteTemplate(template: TemplateWithTasks) {
  return {
    name: template.name,
    title_pattern: template.title_pattern,
    description: normalizeTemplateDescription(template.description),
    priority: template.priority,
    tags: template.tags,
    variables: template.variables,
    project_id: template.project_id,
    plan_id: template.plan_id,
    metadata: template.metadata,
    tasks: template.tasks.map((step) => ({
      position: step.position,
      title_pattern: step.title_pattern,
      description: normalizeTemplateDescription(step.description),
      priority: step.priority,
      tags: step.tags,
      task_type: step.task_type,
      condition: step.condition,
      include_template_id: step.include_template_id,
      depends_on_positions: step.depends_on_positions,
      metadata: step.metadata,
    })),
  };
}

/**
 * Apply the reusable-template contract through the hosted /v1 API without
 * opening local storage. This deliberately shares the variable and condition
 * language with the SQLite implementation while resolving included templates
 * through authenticated cloud reads.
 */
async function createRemoteTemplateTasks(
  cloud: HasnaStorageClient,
  template: TemplateWithTasks,
  projectId: string | undefined,
  variables: Record<string, string>,
  agentId: string | undefined,
  overrides?: RemoteTemplateOverrides,
  visited = new Set<string>(),
  progress: TemplateApplyProgress = {
    tasks: [],
    dependencies: [],
    pending: null,
  },
): Promise<RemoteTemplateApplication> {
  if (visited.size === 0) await preflightTemplate(cloud, template, variables);
  if (visited.has(template.id)) {
    throw new Error(`Circular template reference detected: ${template.id}`);
  }
  visited.add(template.id);
  try {
    const resolved = resolveTemplateVariables(
      template.variables ?? [],
      variables,
    );
    const render = (value: string | null | undefined) =>
      value === null || value === undefined
        ? value
        : substituteTemplateVariables(value, resolved);

    if (template.tasks.length === 0) {
      progress.pending = "task-create";
      const task = await cloudCreateTask(cloud, {
        title: render(overrides?.title || template.title_pattern),
        ...(render(overrides?.description ?? template.description)
          ? {
              description: render(
                overrides?.description ?? template.description,
              ),
            }
          : {}),
        priority: overrides?.priority ?? template.priority,
        tags: template.tags,
        ...(projectId ? { project_id: projectId } : {}),
        ...(template.plan_id ? { plan_id: template.plan_id } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
        ...(Object.keys(template.metadata ?? {}).length > 0
          ? { metadata: template.metadata }
          : {}),
      });
      progress.tasks.push(task);
      progress.pending = null;
      return { tasks: [task] };
    }

    const created: Task[] = [];
    const positionToTaskId = new Map<number, string>();
    const skippedPositions = new Set<number>();

    for (const step of template.tasks) {
      // Keep local ordering: an include takes precedence over a step condition.
      if (step.include_template_id) {
        const included = await cloudGetTemplate(
          cloud,
          step.include_template_id,
        );
        if (!included)
          throw new Error(
            `Included template not found: ${step.include_template_id}`,
          );
        const result = await createRemoteTemplateTasks(
          cloud,
          included,
          projectId,
          resolved,
          agentId,
          undefined,
          visited,
          progress,
        );
        created.push(...result.tasks);
        if (result.tasks.length > 0)
          positionToTaskId.set(step.position, result.tasks[0]!.id);
        else skippedPositions.add(step.position);
        continue;
      }
      if (
        step.condition &&
        !evaluateTemplateCondition(step.condition, resolved)
      ) {
        skippedPositions.add(step.position);
        continue;
      }
      progress.pending = "task-create";
      const task = await cloudCreateTask(cloud, {
        title: render(step.title_pattern),
        ...(render(step.description)
          ? { description: render(step.description) }
          : {}),
        priority: step.priority,
        tags: step.tags,
        ...(step.task_type ? { task_type: step.task_type } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(template.plan_id ? { plan_id: template.plan_id } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
        ...(Object.keys(step.metadata ?? {}).length > 0
          ? { metadata: step.metadata }
          : {}),
      });
      progress.tasks.push(task);
      progress.pending = null;
      created.push(task);
      positionToTaskId.set(step.position, task.id);
    }

    for (const step of template.tasks) {
      if (skippedPositions.has(step.position) || step.include_template_id)
        continue;
      const taskId = positionToTaskId.get(step.position);
      if (!taskId) continue;
      for (const dependencyPosition of step.depends_on_positions) {
        if (skippedPositions.has(dependencyPosition)) continue;
        const dependencyId = positionToTaskId.get(dependencyPosition);
        if (dependencyId) {
          progress.pending = "dependency-add";
          await cloudAddDependency(cloud, taskId, dependencyId);
          progress.dependencies.push({
            task_id: taskId,
            depends_on: dependencyId,
          });
          progress.pending = null;
        }
      }
    }
    return { tasks: created };
  } catch (error) {
    if (error instanceof TemplateApplyError) throw error;
    throw new TemplateApplyError(progress);
  } finally {
    visited.delete(template.id);
  }
}

export function registerTemplateCommands(program: Command): void {
  // templates
  program
    .command("templates")
    .description("List and manage task templates")
    .option("--add <name>", "Create a template")
    .option("--title <pattern>", "Title pattern (with --add)")
    .option("-d, --description <text>", "Default description")
    .option("-p, --priority <level>", "Default priority")
    .option("-t, --tags <tags>", "Default tags (comma-separated)")
    .option("--delete <id>", "Delete a template")
    .option("--update <id>", "Update a template")
    .option("--use <id>", "Create a task from a template")
    .option(
      "--var <vars...>",
      "Variable substitutions: key=value (e.g. --var feature=login)",
    )
    .action(async (opts) => {
      const globalOpts = program.opts();
      const cloud = requireTemplateClient();
      if (cloud) {
        try {
          const projectId = globalOpts.project
            ? await cloudResolveProjectRef(cloud, globalOpts.project)
            : undefined;
          if (opts.add) {
            if (!opts.title) {
              handleError(new Error("--title is required with --add"));
            }
            const template = await cloudCreateTemplate(cloud, {
              name: opts.add,
              title_pattern: opts.title,
              description: opts.description,
              priority: opts.priority || "medium",
              tags: opts.tags
                ? opts.tags
                    .split(",")
                    .map((tag: string) => tag.trim())
                    .filter(Boolean)
                : [],
              project_id: projectId,
            });
            if (globalOpts.json) {
              output(template, true);
            } else {
              console.log(
                chalk.green(
                  `Template created: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`,
                ),
              );
            }
            return;
          }
          if (opts.delete) {
            const prior = await cloudGetTemplate(cloud, opts.delete);
            const deleted = prior
              ? await cloudDeleteTemplate(cloud, prior.id)
              : false;
            if (globalOpts.json) {
              output({ deleted }, true);
            } else if (deleted) {
              console.log(chalk.green("Template deleted."));
            } else {
              handleError(new Error("Template not found."));
            }
            return;
          }
          if (opts.update) {
            const updates: Record<string, unknown> = {};
            if (opts.title) updates.title_pattern = opts.title;
            if (opts.description !== undefined)
              updates.description = opts.description;
            if (opts.priority) updates.priority = opts.priority;
            if (opts.tags !== undefined)
              updates.tags = opts.tags
                .split(",")
                .map((tag: string) => tag.trim())
                .filter(Boolean);
            if (Object.keys(updates).length === 0) {
              handleError(
                new Error(
                  "Provide --title, --description, --priority, or --tags with --update",
                ),
              );
            }
            const prior = await cloudGetTemplate(cloud, opts.update);
            if (!prior) handleError(new Error("Template not found."));
            const updated = await updateSharedTemplate(cloud, prior!.id, {
              ...updates,
              expected_version: prior!.version,
            });
            if (!updated) {
              handleError(new Error("Template not found."));
            }
            if (globalOpts.json) {
              output(updated, true);
            } else {
              console.log(
                chalk.green(
                  `Template updated: ${updated.id.slice(0, 8)} | ${updated.name} | "${updated.title_pattern}"`,
                ),
              );
            }
            return;
          }
          if (opts.use) {
            const variables: Record<string, string> = {};
            for (const value of (opts.var ?? []) as string[]) {
              const separator = value.indexOf("=");
              if (separator === -1) {
                handleError(
                  new Error(
                    `Invalid variable format: ${value} (expected key=value)`,
                  ),
                );
              }
              variables[value.slice(0, separator)] = value.slice(separator + 1);
            }
            const template = await cloudGetTemplate(cloud, opts.use);
            if (!template) {
              handleError(new Error("Template not found."));
            }
            const targetProjectId = template.project_id ?? projectId;
            const { tasks: created } = await createRemoteTemplateTasks(
              cloud,
              template,
              targetProjectId,
              variables,
              globalOpts.agent,
              {
                title: opts.title,
                description: opts.description,
                priority: opts.priority,
              },
            );
            if (globalOpts.json) {
              output(created, true);
            } else {
              console.log(
                chalk.green(`${created.length} task(s) created from template:`),
              );
              for (const task of created) console.log(formatTaskLine(task));
            }
            return;
          }
          const templates = await cloudListTemplates(cloud, projectId);
          if (globalOpts.json) {
            output(templates, true);
            return;
          }
          if (templates.length === 0) {
            console.log(chalk.dim("No templates."));
            return;
          }
          console.log(chalk.bold(`${templates.length} template(s):\n`));
          for (const template of templates) {
            console.log(
              `  ${chalk.dim(template.id.slice(0, 8))} ${chalk.bold(template.name)} ${chalk.cyan(`"${template.title_pattern}"`)} ${chalk.yellow(template.priority)}`,
            );
          }
        } catch (error) {
          reportTemplateError(error, globalOpts.json);
        }
        return;
      }
      throw new Error("Templates require the authenticated shared API");
    });

  // template-init
  program
    .command("template-init")
    .alias("templates-init")
    .description("Initialize bundled templates in the shared account")
    .action(async () => {
      const globalOpts = program.opts();
      const result = await initializeSharedTemplates(requireTemplateClient());
      if (globalOpts.json) {
        output(result, true);
        return;
      }
      if (result.created === 0) {
        console.log(
          chalk.dim(
            `All ${result.skipped} built-in template(s) already exist.`,
          ),
        );
      } else {
        console.log(
          chalk.green(
            `Created ${result.created} template(s): ${result.names.join(", ")}. Skipped ${result.skipped} existing.`,
          ),
        );
      }
    });

  // template-library
  program
    .command("template-library")
    .alias("templates-library")
    .description(
      "List, show, or write the bundled local template library as editable JSON files",
    )
    .option("--show <name>", "Show one bundled template as JSON")
    .option(
      "--write <dir>",
      "Write all bundled templates to editable JSON files",
    )
    .action(async (opts: { show?: string; write?: string }) => {
      const globalOpts = program.opts();
      const {
        exportBuiltinTemplate,
        listBuiltinTemplates,
        writeBuiltinTemplateFiles,
      } = await import("../../lib/builtin-template-library.js");
      try {
        if (opts.show) {
          const template = exportBuiltinTemplate(opts.show);
          output(template, true);
          return;
        }
        if (opts.write) {
          const result = writeBuiltinTemplateFiles(opts.write);
          if (globalOpts.json) {
            output(result, true);
            return;
          }
          console.log(
            chalk.green(
              `Wrote ${result.written} editable template file(s) to ${result.directory}`,
            ),
          );
          for (const file of result.files) console.log(chalk.dim(`  ${file}`));
          return;
        }
        const templates = listBuiltinTemplates().map((template) => ({
          name: template.name,
          description: template.description,
          category: template.category,
          version: template.version,
          variables: template.variables,
          task_count: template.tasks.length,
        }));
        if (globalOpts.json) {
          output(templates, true);
          return;
        }
        console.log(
          chalk.bold(`${templates.length} bundled local template(s):\n`),
        );
        for (const template of templates) {
          console.log(
            `  ${chalk.bold(template.name)} ${chalk.dim(`[${template.category}]`)} ${chalk.yellow(`${template.task_count} tasks`)}`,
          );
          console.log(chalk.dim(`    ${template.description}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // template-preview
  program
    .command("template-preview <id>")
    .alias("templates-preview")
    .description(
      "Preview a template without creating tasks — shows resolved titles, deps, and priorities",
    )
    .option(
      "--var <vars...>",
      "Variable substitution in key=value format (e.g. --var name=invoices)",
    )
    .action(async (id: string, opts: { var?: string[] }) => {
      const globalOpts = program.opts();

      const variables: Record<string, string> = {};
      if (opts.var) {
        for (const v of opts.var) {
          const eq = v.indexOf("=");
          if (eq === -1) {
            handleError(
              new Error(`Invalid variable format: ${v} (expected key=value)`),
            );
          }
          variables[v.slice(0, eq)] = v.slice(eq + 1);
        }
      }

      try {
        const cloud = requireTemplateClient();
        let result: TemplatePreview;
        if (cloud) {
          const template = await cloudGetTemplate(cloud, id);
          if (!template) {
            handleError(new Error("Template not found."));
          }
          result = previewRemoteTemplate(
            template,
            Object.keys(variables).length > 0 ? variables : undefined,
          );
        } else {
          throw new Error("Templates require the shared API");
        }
        if (globalOpts.json) {
          output(result, true);
          return;
        }

        console.log(
          chalk.bold(
            `Preview: ${result.template_name} (${result.tasks.length} tasks)`,
          ),
        );
        if (result.description)
          console.log(chalk.dim(`  ${result.description}`));
        if (result.variables.length > 0) {
          console.log(
            chalk.dim(
              `  Variables: ${result.variables.map((v: any) => `${v.name}${v.required ? "*" : ""}${v.default ? `=${v.default}` : ""}`).join(", ")}`,
            ),
          );
        }
        if (Object.keys(result.resolved_variables).length > 0) {
          console.log(
            chalk.dim(
              `  Resolved: ${Object.entries(result.resolved_variables)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}`,
            ),
          );
        }
        console.log();
        for (const t of result.tasks) {
          const deps =
            t.depends_on_positions.length > 0
              ? chalk.dim(` (after: ${t.depends_on_positions.join(", ")})`)
              : "";
          console.log(
            `  ${chalk.dim(`[${t.position}]`)} ${chalk.yellow(t.priority)} | ${t.title}${deps}`,
          );
        }
      } catch (e) {
        handleError(e);
      }
    });

  // template-export
  program
    .command("template-export <id>")
    .alias("templates-export")
    .description("Export a template as JSON to stdout")
    .action(async (id: string) => {
      try {
        const cloud = requireTemplateClient();
        const template = cloud ? await cloudGetTemplate(cloud, id) : null;
        if (cloud && !template) {
          handleError(new Error("Template not found."));
        }
        const json = exportRemoteTemplate(template!);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  // template-import
  program
    .command("template-import [file]")
    .alias("templates-import")
    .description("Import a template from a JSON file")
    .option(
      "--file <path>",
      "Path to template JSON file (alternative to positional arg)",
    )
    .action(async (file: string | undefined, opts: { file?: string }) => {
      const globalOpts = program.opts();
      const { readFileSync } = await import("node:fs");
      try {
        const filePath = file || opts.file;
        if (!filePath) {
          handleError(
            new Error(
              "Provide a file path: todos template-import <file> or --file <path>",
            ),
          );
        }
        const content = readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);
        const cloud = requireTemplateClient();
        const template = await cloudCreateTemplate(cloud, json);
        if (globalOpts.json) {
          output(template, true);
        } else {
          console.log(
            chalk.green(
              `Template imported: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`,
            ),
          );
        }
      } catch (e) {
        handleError(e);
      }
    });

  // template-history
  program
    .command("template-history <id>")
    .alias("templates-history")
    .description("Show version history of a template")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const cloud = requireTemplateClient();
      try {
        const template = await cloudGetTemplate(cloud, id);
        if (!template) {
          handleError(new Error("Template not found."));
        }
        const history = await readSharedTemplateHistory(cloud, template!.id);
        const versions = history.versions;
        if (!history.selection.complete) {
          outputRecord(
            {
              ...history,
              warning:
                "Prior template versions are unavailable; no history was reconstructed",
            },
            globalOpts.json,
          );
          return;
        }
        if (globalOpts.json) {
          output({ current_version: template.version, versions }, true);
          return;
        }
        console.log(
          chalk.bold(`${template.name} — current version: ${template.version}`),
        );
        if (versions.length === 0) {
          console.log(chalk.dim("  No previous versions."));
        } else {
          for (const v of versions) {
            const snap = JSON.parse(v.snapshot);
            console.log(
              `  ${chalk.dim(`v${v.version}`)} | ${v.created_at} | ${snap.name} | "${snap.title_pattern}"`,
            );
          }
        }
      } catch (e) {
        handleError(e);
      }
    });
}
