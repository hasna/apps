import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { formatTable, jsonOut, pageHint, pageItems } from "../../lib/format.js";
import { listTemplates, applyTemplate } from "../../lib/templates.js";

export function registerTemplateCommands(program: Command) {
  const templateCmd = program.command("template").description("Manage style templates");

  templateCmd
    .command("list")
    .description("List all templates")
    .option("--profile <id>", "Filter by profile ID")
    .option("--limit <n>", "Max templates to show in compact output")
    .option("--cursor <n>", "Zero-based offset for compact output pagination")
    .option("-v, --verbose", "Show variable counts and longer descriptions")
    .option("--json", "Output full JSON")
    .action((opts: { profile?: string; limit?: string; cursor?: string; verbose?: boolean; json?: boolean }) => {
      const templates = listTemplates(opts.profile);
      if (opts.json) {
        jsonOut(templates);
        return;
      }
      if (templates.length === 0) {
        console.log(chalk.dim("No templates found."));
        return;
      }

      const page = pageItems(templates, { limit: opts.limit, cursor: opts.cursor, defaultLimit: 20, maxLimit: 100 });
      console.log(chalk.bold(`Templates (${templates.length})`));
      console.log(formatTable(page.items, [
        { header: "ID", value: (t) => t.id.slice(0, 8), maxWidth: 10 },
        { header: "Name", value: (t) => t.name, maxWidth: 28 },
        { header: "Profile", value: (t) => t.styleProfileId, maxWidth: 22 },
        ...(opts.verbose ? [{ header: "Vars", value: (t: typeof templates[number]) => Object.keys(t.variables).length, maxWidth: 6 }] : []),
        { header: "Description", value: (t) => t.description, maxWidth: opts.verbose ? 72 : 48 },
      ]));
      console.log(chalk.dim(pageHint(page, "use `styles template apply <id>` to apply")));
    });

  templateCmd
    .command("apply <id>")
    .description("Apply a template to a project")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("--json", "Output full JSON")
    .action((id: string, opts: { project?: string; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? process.cwd());
      const result = applyTemplate(id, projectPath);

      if (opts.json) {
        jsonOut(result);
        return;
      }

      if (result.success) {
        console.log(chalk.green(`✔ Template applied`));
        for (const f of result.filesCreated) {
          console.log(chalk.dim(`  created: ${f}`));
        }
      } else {
        console.log(chalk.red("✖ Template apply failed"));
        for (const e of result.errors) {
          console.log(chalk.red(`  ${e}`));
        }
        process.exit(1);
      }
    });
}
