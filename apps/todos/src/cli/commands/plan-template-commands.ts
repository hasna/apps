import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../../db/plans.js";
import { createTask } from "../../db/tasks.js";
import { formatTaskLine, autoProject, handleError, output } from "../helpers.js";

export function registerPlanTemplateCommands(program: Command) {
  // plans
  program
    .command("plans")
    .description("List and manage plans")
    .option("--add <name>", "Create a plan")
    .option("-d, --description <text>", "Plan description (with --add)")
    .option("--show <id>", "Show plan details with its tasks")
    .option("--delete <id>", "Delete a plan")
    .option("--complete <id>", "Mark a plan as completed")
    .action((opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);

      if (opts.add) {
        const plan = createPlan({
          name: opts.add,
          description: opts.description,
          project_id: projectId,
        });

        if (globalOpts.json) {
          output(plan, true);
        } else {
          console.log(chalk.green("Plan created:"));
          console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
        }
        return;
      }

      if (opts.show) {
        const db = getDatabase();
        const resolvedId = resolvePartialId(db, "plans", opts.show);
        if (!resolvedId) {
          console.error(chalk.red(`Could not resolve plan ID: ${opts.show}`));
          process.exit(1);
        }
        const plan = getPlan(resolvedId);
        if (!plan) {
          console.error(chalk.red(`Plan not found: ${opts.show}`));
          process.exit(1);
        }
        const { listTasks } = require("../../db/tasks.js") as any;
        const tasks = listTasks({ plan_id: resolvedId });

        if (globalOpts.json) {
          output({ plan, tasks }, true);
          return;
        }

        console.log(chalk.bold("Plan Details:\n"));
        console.log(`  ${chalk.dim("ID:")}       ${plan.id}`);
        console.log(`  ${chalk.dim("Name:")}     ${plan.name}`);
        console.log(`  ${chalk.dim("Status:")}   ${chalk.cyan(plan.status)}`);
        if (plan.description) console.log(`  ${chalk.dim("Desc:")}     ${plan.description}`);
        if (plan.project_id) console.log(`  ${chalk.dim("Project:")}  ${plan.project_id}`);
        console.log(`  ${chalk.dim("Created:")}  ${plan.created_at}`);

        if (tasks.length > 0) {
          console.log(chalk.bold(`\n  Tasks (${tasks.length}):`));
          for (const t of tasks) {
            console.log(`    ${formatTaskLine(t)}`);
          }
        } else {
          console.log(chalk.dim("\n  No tasks in this plan."));
        }
        return;
      }

      if (opts.delete) {
        const db = getDatabase();
        const resolvedId = resolvePartialId(db, "plans", opts.delete);
        if (!resolvedId) {
          console.error(chalk.red(`Could not resolve plan ID: ${opts.delete}`));
          process.exit(1);
        }
        const deleted = deletePlan(resolvedId);
        if (globalOpts.json) {
          output({ deleted }, true);
        } else if (deleted) {
          console.log(chalk.green("Plan deleted."));
        } else {
          console.error(chalk.red("Plan not found."));
          process.exit(1);
        }
        return;
      }

      if (opts.complete) {
        const db = getDatabase();
        const resolvedId = resolvePartialId(db, "plans", opts.complete);
        if (!resolvedId) {
          console.error(chalk.red(`Could not resolve plan ID: ${opts.complete}`));
          process.exit(1);
        }
        try {
          const plan = updatePlan(resolvedId, { status: "completed" });
          if (globalOpts.json) {
            output(plan, true);
          } else {
            console.log(chalk.green("Plan completed:"));
            console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
          }
        } catch (e) {
          handleError(e);
        }
        return;
      }

      // Default: list plans
      const plans = listPlans(projectId);

      if (globalOpts.json) {
        output(plans, true);
        return;
      }

      if (plans.length === 0) {
        console.log(chalk.dim("No plans found."));
        return;
      }

      console.log(chalk.bold(`${plans.length} plan(s):\n`));
      for (const p of plans) {
        const desc = p.description ? chalk.dim(` - ${p.description}`) : "";
        console.log(`${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.cyan(`[${p.status}]`)}${desc}`);
      }
    });

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
    .option("--var <vars...>", "Variable substitutions: key=value (e.g. --var feature=login)")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { createTemplate, listTemplates, deleteTemplate, updateTemplate, taskFromTemplate } = await import("../../db/templates.js");

      if (opts.add) {
        if (!opts.title) { console.error(chalk.red("--title is required with --add")); process.exit(1); }
        const projectId = autoProject(globalOpts);
        const template = createTemplate({
          name: opts.add,
          title_pattern: opts.title,
          description: opts.description,
          priority: opts.priority || "medium",
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
          project_id: projectId,
        });
        if (globalOpts.json) { output(template, true); }
        else { console.log(chalk.green(`Template created: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`)); }
        return;
      }

      if (opts.delete) {
        const deleted = deleteTemplate(opts.delete);
        if (globalOpts.json) { output({ deleted }, true); }
        else if (deleted) { console.log(chalk.green("Template deleted.")); }
        else { console.error(chalk.red("Template not found.")); process.exit(1); }
        return;
      }

      if (opts.update) {
        const updates: Record<string, any> = {};
        if (opts.add) updates.name = opts.add;
        if (opts.title) updates.title_pattern = opts.title;
        if (opts.description) updates.description = opts.description;
        if (opts.priority) updates.priority = opts.priority;
        if (opts.tags) updates.tags = opts.tags.split(",").map((t: string) => t.trim());
        const updated = updateTemplate(opts.update, updates);
        if (!updated) { console.error(chalk.red("Template not found.")); process.exit(1); }
        if (globalOpts.json) { output(updated, true); }
        else { console.log(chalk.green(`Template updated: ${updated.id.slice(0, 8)} | ${updated.name} | "${updated.title_pattern}"`)); }
        return;
      }

      if (opts.use) {
        try {
          const variables: Record<string, string> = {};
          if (opts.var) {
            for (const v of (opts.var as string[])) {
              const eq = v.indexOf("=");
              if (eq === -1) { console.error(chalk.red(`Invalid variable format: ${v} (expected key=value)`)); process.exit(1); }
              variables[v.slice(0, eq)] = v.slice(eq + 1);
            }
          }
          const input = taskFromTemplate(opts.use, {
            title: opts.title,
            description: opts.description,
            priority: opts.priority,
          });
          if (input.title) {
            let title = input.title;
            for (const [k, v] of Object.entries(variables)) {
              title = title.replace(new RegExp(`\\{${k}\\}`, "g"), v);
            }
            input.title = title;
          }
          const task = createTask({ ...input, agent_id: globalOpts.agent, project_id: input.project_id || autoProject(globalOpts) });
          if (globalOpts.json) { output(task, true); }
          else { console.log(chalk.green("Task created from template:")); console.log(formatTaskLine(task)); }
        } catch (e) { handleError(e); }
        return;
      }

      // List templates
      const templates = listTemplates();
      if (globalOpts.json) { output(templates, true); return; }
      if (templates.length === 0) { console.log(chalk.dim("No templates.")); return; }
      console.log(chalk.bold(`${templates.length} template(s):\n`));
      for (const t of templates) {
        const vars = t.variables && t.variables.length > 0 ? ` ${chalk.dim(`(${t.variables.map((v: any) => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')})`)}` : "";
        console.log(`  ${chalk.dim(t.id.slice(0, 8))} ${chalk.bold(t.name)} ${chalk.cyan(`"${t.title_pattern}"`)} ${chalk.yellow(t.priority)}${vars}`);
      }
    });

  // template-init
  program
    .command("template-init")
    .alias("templates-init")
    .description("Initialize built-in starter templates (open-source-project, bug-fix, feature, security-audit)")
    .action(async () => {
      const globalOpts = program.opts();
      const { initBuiltinTemplates } = await import("../../db/builtin-templates.js");
      const result = initBuiltinTemplates();
      if (globalOpts.json) { output(result, true); return; }
      if (result.created === 0) {
        console.log(chalk.dim(`All ${result.skipped} built-in template(s) already exist.`));
      } else {
        console.log(chalk.green(`Created ${result.created} template(s): ${result.names.join(", ")}. Skipped ${result.skipped} existing.`));
      }
    });

  // template-preview
  program
    .command("template-preview <id>")
    .alias("templates-preview")
    .description("Preview a template without creating tasks — shows resolved titles, deps, and priorities")
    .option("--var <vars...>", "Variable substitution in key=value format (e.g. --var name=invoices)")
    .action(async (id: string, opts: { var?: string[] }) => {
      const globalOpts = program.opts();
      const { previewTemplate } = await import("../../db/templates.js");

      const variables: Record<string, string> = {};
      if (opts.var) {
        for (const v of opts.var) {
          const eq = v.indexOf("=");
          if (eq === -1) { console.error(chalk.red(`Invalid variable format: ${v} (expected key=value)`)); process.exit(1); }
          variables[v.slice(0, eq)] = v.slice(eq + 1);
        }
      }

      try {
        const preview = previewTemplate(id, Object.keys(variables).length > 0 ? variables : undefined);
        if (globalOpts.json) { output(preview, true); return; }

        console.log(chalk.bold(`Preview: ${preview.template_name} (${preview.tasks.length} tasks)`));
        if (preview.description) console.log(chalk.dim(`  ${preview.description}`));
        if (preview.variables.length > 0) {
          console.log(chalk.dim(`  Variables: ${preview.variables.map((v: any) => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')}`));
        }
        if (Object.keys(preview.resolved_variables).length > 0) {
          console.log(chalk.dim(`  Resolved: ${Object.entries(preview.resolved_variables).map(([k, v]) => `${k}=${v}`).join(', ')}`));
        }
        console.log();
        for (const t of preview.tasks) {
          const deps = t.depends_on_positions.length > 0 ? chalk.dim(` (after: ${t.depends_on_positions.join(", ")})`) : "";
          console.log(`  ${chalk.dim(`[${t.position}]`)} ${chalk.yellow(t.priority)} | ${t.title}${deps}`);
        }
      } catch (e) { handleError(e); }
    });

  // template-export
  program
    .command("template-export <id>")
    .alias("templates-export")
    .description("Export a template as JSON to stdout")
    .action(async (id: string) => {
      const { exportTemplate } = await import("../../db/templates.js");
      try {
        const json = exportTemplate(id);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) { handleError(e); }
    });

  // template-import
  program
    .command("template-import [file]")
    .alias("templates-import")
    .description("Import a template from a JSON file")
    .option("--file <path>", "Path to template JSON file (alternative to positional arg)")
    .action(async (file: string | undefined, opts: { file?: string }) => {
      const globalOpts = program.opts();
      const { importTemplate } = await import("../../db/templates.js");
      const { readFileSync } = await import("node:fs");
      try {
        const filePath = file || opts.file;
        if (!filePath) { console.error(chalk.red("Provide a file path: todos template-import <file> or --file <path>")); process.exit(1); }
        const content = readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);
        const template = importTemplate(json);
        if (globalOpts.json) { output(template, true); }
        else { console.log(chalk.green(`Template imported: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`)); }
      } catch (e) { handleError(e); }
    });

  // template-history
  program
    .command("template-history <id>")
    .alias("templates-history")
    .description("Show version history of a template")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const { listTemplateVersions, getTemplate } = await import("../../db/templates.js");
      try {
        const template = getTemplate(id);
        if (!template) { console.error(chalk.red("Template not found.")); process.exit(1); }
        const versions = listTemplateVersions(id);
        if (globalOpts.json) { output({ current_version: template.version, versions }, true); return; }
        console.log(chalk.bold(`${template.name} — current version: ${template.version}`));
        if (versions.length === 0) {
          console.log(chalk.dim("  No previous versions."));
        } else {
          for (const v of versions) {
            const snap = JSON.parse(v.snapshot);
            console.log(`  ${chalk.dim(`v${v.version}`)} | ${v.created_at} | ${snap.name} | "${snap.title_pattern}"`);
          }
        }
      } catch (e) { handleError(e); }
    });
}
