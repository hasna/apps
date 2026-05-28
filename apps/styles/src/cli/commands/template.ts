import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { jsonOut } from "../../lib/format.js";
import { listTemplates, applyTemplate } from "../../lib/templates.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerTemplateCommands(program: Command) {
  const templateCmd = program.command("template").description("Manage style templates");

  templateCmd
    .command("list")
    .description("List all templates")
    .option("--profile <id>", "Filter by profile ID")
    .action((opts: { profile?: string }) => {
      const templates = listTemplates(opts.profile);
      if (!isTTY) {
        jsonOut(templates);
        return;
      }
      if (templates.length === 0) {
        console.log(chalk.dim("No templates found."));
        return;
      }
      for (const t of templates) {
        console.log(`  ${chalk.cyan(t.id.slice(0, 8))}  ${t.name.padEnd(24)} ${chalk.dim(t.description)}`);
      }
    });

  templateCmd
    .command("apply <id>")
    .description("Apply a template to a project")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .action((id: string, opts: { project?: string }) => {
      const projectPath = resolve(opts.project ?? process.cwd());
      const result = applyTemplate(id, projectPath);

      if (!isTTY) {
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
