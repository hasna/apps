import chalk from "chalk";
import type { Command } from "commander";
import { jsonOut, error } from "../../lib/format.js";
import {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  deleteProfile,
} from "../../lib/profiles.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerProfileCommands(program: Command) {
  const profileCmd = program.command("profile").description("Manage style profiles");

  profileCmd
    .command("list")
    .description("List all custom profiles")
    .action(() => {
      const profiles = listProfiles();
      if (!isTTY) {
        jsonOut(profiles);
        return;
      }
      if (profiles.length === 0) {
        console.log(chalk.dim("No custom profiles found."));
        return;
      }
      console.log(chalk.bold("Custom Profiles:"));
      for (const p of profiles) {
        console.log(
          `  ${chalk.cyan(p.name.padEnd(20))} ${chalk.dim(p.category.padEnd(16))} ${p.displayName}`
        );
      }
    });

  profileCmd
    .command("create")
    .description("Create a custom profile")
    .requiredOption("-n, --name <n>", "Profile name (slug)")
    .requiredOption("--display-name <dn>", "Display name")
    .requiredOption("-c, --category <cat>", "Category")
    .option("-d, --description <d>", "Description")
    .action((opts: { name: string; displayName: string; category: string; description?: string }) => {
      const profile = createProfile({
        name: opts.name,
        displayName: opts.displayName,
        description: opts.description ?? "",
        category: opts.category,
        principles: [],
        antiPatterns: [],
        typography: {},
        colors: {},
        componentRules: {},
        tags: [],
      });

      if (!isTTY) {
        jsonOut(profile);
        return;
      }
      console.log(chalk.green(`✔ Profile created: ${profile.name} (${profile.id})`));
    });

  profileCmd
    .command("get <id-or-name>")
    .description("Get a profile by ID or name")
    .action((idOrName: string) => {
      const profile = getProfile(idOrName) ?? getProfileByName(idOrName);
      if (!profile) {
        error(`Profile not found: "${idOrName}"`);
      }
      if (!isTTY) {
        jsonOut(profile);
        return;
      }
      console.log(chalk.bold(profile.displayName));
      console.log(chalk.dim(`ID: ${profile.id}`));
      console.log(chalk.dim(`Category: ${profile.category}`));
      if (profile.description) console.log(profile.description);
      if (profile.principles.length) {
        console.log(chalk.bold("\nPrinciples:"));
        for (const p of profile.principles) console.log(`  • ${p}`);
      }
    });

  profileCmd
    .command("delete <id>")
    .description("Delete a custom profile")
    .action((id: string) => {
      deleteProfile(id);
      if (!isTTY) {
        jsonOut({ ok: true, deleted: id });
        return;
      }
      console.log(chalk.green(`✔ Profile deleted: ${id}`));
    });
}
