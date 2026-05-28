import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { jsonOut } from "../../lib/format.js";
import { getPref, setPref, listPrefs } from "../../lib/preferences.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerPrefsCommands(program: Command) {
  const prefsCmd = program.command("prefs").description("Manage preferences");

  prefsCmd
    .command("list")
    .description("List all preferences")
    .option("-p, --project <path>", "Project path")
    .action((opts: { project?: string }) => {
      const projectPath = opts.project ? resolve(opts.project) : undefined;
      const prefs = listPrefs(projectPath);
      if (!isTTY) {
        jsonOut(prefs);
        return;
      }
      if (prefs.length === 0) {
        console.log(chalk.dim("No preferences set."));
        return;
      }
      for (const p of prefs) {
        console.log(
          `  ${chalk.cyan(p.key.padEnd(30))} ${chalk.dim(p.scope.padEnd(10))} ${p.value}`
        );
      }
    });

  prefsCmd
    .command("set <key> <value>")
    .description("Set a preference value")
    .option("-p, --project <path>", "Project path")
    .option("-g, --global", "Set as global preference")
    .action((key: string, value: string, opts: { project?: string; global?: boolean }) => {
      const scope: "global" | "project" = opts.global ? "global" : "project";
      const projectPath = opts.project ? resolve(opts.project) : (scope === "project" ? process.cwd() : undefined);

      setPref(key, value, scope, projectPath);

      if (!isTTY) {
        jsonOut({ ok: true, key, value, scope });
        return;
      }
      console.log(chalk.green(`✔ Set ${scope} preference: ${key} = ${value}`));
    });

  prefsCmd
    .command("get <key>")
    .description("Get a preference value")
    .option("-p, --project <path>", "Project path")
    .action((key: string, opts: { project?: string }) => {
      const projectPath = opts.project ? resolve(opts.project) : undefined;
      const value = getPref(key, projectPath);
      if (!isTTY) {
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
