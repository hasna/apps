import chalk from "chalk";
import type { Command } from "commander";
import { formatTable, jsonOut, pageHint, pageItems } from "../../lib/format.js";
import {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  deleteProfile,
} from "../../lib/profiles.js";

export function registerProfileCommands(program: Command) {
  const profileCmd = program.command("profile").description("Manage style profiles");

  profileCmd
    .command("list")
    .description("List all custom profiles")
    .option("--limit <n>", "Max profiles to show in compact output")
    .option("--cursor <n>", "Zero-based offset for compact output pagination")
    .option("-v, --verbose", "Show longer descriptions")
    .option("--json", "Output full JSON")
    .action((opts: { limit?: string; cursor?: string; verbose?: boolean; json?: boolean }) => {
      const profiles = listProfiles();
      if (opts.json) {
        jsonOut(profiles);
        return;
      }
      if (profiles.length === 0) {
        console.log(chalk.dim("No custom profiles found."));
        return;
      }

      const page = pageItems(profiles, { limit: opts.limit, cursor: opts.cursor, defaultLimit: 20, maxLimit: 100 });
      console.log(chalk.bold(`Custom Profiles (${profiles.length})`));
      console.log(formatTable(page.items, [
        { header: "ID", value: (p) => p.id.slice(0, 8), maxWidth: 10 },
        { header: "Name", value: (p) => p.name, maxWidth: 24 },
        { header: "Category", value: (p) => p.category, maxWidth: 18 },
        { header: "Display", value: (p) => p.displayName, maxWidth: 28 },
        ...(opts.verbose ? [{ header: "Description", value: (p: typeof profiles[number]) => p.description, maxWidth: 72 }] : []),
      ]));
      console.log(chalk.dim(pageHint(page, "use `styles profile get <id-or-name>` for details")));
    });

  profileCmd
    .command("create")
    .description("Create a custom profile")
    .requiredOption("-n, --name <n>", "Profile name (slug)")
    .requiredOption("--display-name <dn>", "Display name")
    .requiredOption("-c, --category <cat>", "Category")
    .option("-d, --description <d>", "Description")
    .option("--json", "Output full JSON")
    .action((opts: { name: string; displayName: string; category: string; description?: string; json?: boolean }) => {
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

      if (opts.json) {
        jsonOut(profile);
        return;
      }
      console.log(chalk.green(`✔ Profile created: ${profile.name} (${profile.id})`));
    });

  profileCmd
    .command("get <id-or-name>")
    .description("Get a profile by ID or name")
    .option("--json", "Output full JSON")
    .action((idOrName: string, opts: { json?: boolean }) => {
      const { error } = require("../../lib/format.js");
      const profile = getProfile(idOrName) ?? getProfileByName(idOrName);
      if (!profile) {
        return error(`Profile not found: "${idOrName}"`);
      }
      if (opts.json) {
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
      console.log(chalk.dim("\nUse --json for the full machine-readable object."));
    });

  profileCmd
    .command("delete <id>")
    .description("Delete a custom profile")
    .option("--json", "Output JSON")
    .action((id: string, opts: { json?: boolean }) => {
      deleteProfile(id);
      if (opts.json) {
        jsonOut({ ok: true, deleted: id });
        return;
      }
      console.log(chalk.green(`✔ Profile deleted: ${id}`));
    });
}
