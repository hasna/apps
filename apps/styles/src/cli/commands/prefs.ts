import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { formatTable, jsonOut, pageHint, pageItems } from "../../lib/format.js";
import { getPref, setPref, listPrefs } from "../../lib/preferences.js";

export function registerPrefsCommands(program: Command) {
  const prefsCmd = program.command("prefs").description("Manage preferences");

  prefsCmd
    .command("list")
    .description("List all preferences")
    .option("-p, --project <path>", "Project path")
    .option("--limit <n>", "Max preferences to show in compact output")
    .option("--cursor <n>", "Zero-based offset for compact output pagination")
    .option("--json", "Output full JSON")
    .action((opts: { project?: string; limit?: string; cursor?: string; json?: boolean }) => {
      const projectPath = opts.project ? resolve(opts.project) : undefined;
      const prefs = listPrefs(projectPath);
      if (opts.json) {
        jsonOut(prefs);
        return;
      }
      if (prefs.length === 0) {
        console.log(chalk.dim("No preferences set."));
        return;
      }

      const page = pageItems(prefs, { limit: opts.limit, cursor: opts.cursor, defaultLimit: 20, maxLimit: 100 });
      console.log(chalk.bold(`Preferences (${prefs.length})`));
      console.log(formatTable(page.items, [
        { header: "Key", value: (p) => p.key, maxWidth: 30 },
        { header: "Scope", value: (p) => p.scope, maxWidth: 10 },
        { header: "Value", value: (p) => p.value, maxWidth: 72 },
      ]));
      console.log(chalk.dim(pageHint(page, "use `styles prefs get <key>` for one value")));
    });

  prefsCmd
    .command("set <key> <value>")
    .description("Set a preference value")
    .option("-p, --project <path>", "Project path")
    .option("-g, --global", "Set as global preference")
    .option("--json", "Output JSON")
    .action((key: string, value: string, opts: { project?: string; global?: boolean; json?: boolean }) => {
      const scope: "global" | "project" = opts.global ? "global" : "project";
      const projectPath = opts.project ? resolve(opts.project) : (scope === "project" ? process.cwd() : undefined);

      setPref(key, value, scope, projectPath);

      if (opts.json) {
        jsonOut({ ok: true, key, value, scope });
        return;
      }
      console.log(chalk.green(`✔ Set ${scope} preference: ${key} = ${value}`));
    });

  prefsCmd
    .command("get <key>")
    .description("Get a preference value")
    .option("-p, --project <path>", "Project path")
    .option("--json", "Output JSON")
    .action((key: string, opts: { project?: string; json?: boolean }) => {
      const projectPath = opts.project ? resolve(opts.project) : undefined;
      const value = getPref(key, projectPath);
      if (opts.json) {
        jsonOut({ key, value });
        return;
      }
      if (value === null) {
        console.log(chalk.dim(`No value set for key: ${key}`));
      } else {
        console.log(`${chalk.cyan(key)}: ${value}`);
      }
    });
}
