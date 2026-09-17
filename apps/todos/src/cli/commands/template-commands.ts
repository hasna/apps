import type { Command } from "commander";
import chalk from "chalk";
import type { TemplatePreview } from "../../db/templates.js";
import {
  formatTaskLine,
  handleError,
  output,
  outputRecord,
} from "../helpers.js";
import {
  cloudCreateTemplate,
  cloudDeleteTemplate,
  cloudResolveProjectRef,
} from "../cloud-router.js";
import {
  initializeSharedTemplates,
  readSharedTemplateHistory,
  updateSharedTemplate,
  listSharedTemplates as cloudListTemplates,
} from "../template-api.js";

import {
  TemplateApplyError,
  createRemoteTemplateTasks,
  exportRemoteTemplate,
  previewRemoteTemplate,
  requireTemplateClient,
  resolveRemoteTemplate as cloudGetTemplate,
} from "../template-remote.js";

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
