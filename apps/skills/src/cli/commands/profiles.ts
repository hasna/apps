import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { readSkillProfile, saveSkillProfile, readStationSkillState } from "../../lib/profile-admin.js";

export function registerProfiles(parent: Command): void {
  const profiles = parent.command("profiles").description("Manage exact, shared skill selections through the API");
  profiles.command("show <id>").option("--json", "Output the profile as JSON", false)
    .option("--save <path>", "Save a private snapshot for review or rollback")
    .action(async (id: string, options) => {
      try {
        const profile = await readSkillProfile(id), text = JSON.stringify(profile, null, 2);
        if (options.save) writeFileSync(options.save, `${text}\n`, { mode: 0o600, flag: "wx" });
        await writeCliOutput(options.json ? text : `${profile.id} at ${profile.revision}: ${profile.selections.map(skill => `${skill.slug}@${skill.version}`).join(", ")}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
  profiles.command("set <id>").requiredOption("--file <path>", "JSON snapshot with a selections array")
    .option("--if-match <revision>", "Replace only this existing revision; omission creates a new profile")
    .option("--json", "Output the saved profile as JSON", false)
    .description("Create or update a profile; use a saved snapshot with --if-match to roll back")
    .action(async (id: string, options) => {
      try {
        const text = readFileSync(options.file, "utf8");
        if (text.length > 1024 * 1024) throw new Error("Profile input exceeds the size limit");
        const input = JSON.parse(text);
        const profile = await saveSkillProfile(id, input.selections, options.ifMatch);
        await writeCliOutput(options.json ? JSON.stringify(profile) : `Saved ${profile.id} at ${profile.revision}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
  parent.command("station-state <id>").description("Read this actor's last applied skill selection on a station")
    .option("--json", "Output the station receipt as JSON", false)
    .action(async (id: string) => {
      try { await writeCliOutput(JSON.stringify(await readStationSkillState(id), null, 2)); }
      catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
}
