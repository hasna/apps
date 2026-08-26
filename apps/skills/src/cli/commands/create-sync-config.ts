/**
 * config / create / sync — configuration and scaffolding commands
 */

import chalk from "chalk";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { loadConfig, saveConfig, unsetConfig, getConfigPath } from "../../lib/config.js";
import { getPortableSkillsRoot } from "../../lib/portable-skills.js";
import { clearRegistryCache } from "../../lib/registry.js";
import {
  resolveSyncAgents,
  SYNC_AGENTS,
  syncSkillsToAgents,
  type AgentSyncAction,
} from "../../lib/agent-sync.js";
import {
  adoptUnmarkedHomes,
  pruneStrayHomes,
} from "../../lib/home-adoption.js";
import { censusHomeDrift, type DriftCensus } from "../../lib/home-census.js";
import {
  StationSnapshotError,
  writeStationSnapshot,
} from "../../lib/station-snapshot.js";

export function registerCreateSync(parent: Command) {
  // Config
  const configCmd = parent
    .command("config")
    .description("Manage skills configuration");

  configCmd
    .command("show", { isDefault: true })
    .option("--json", "Output as JSON", false)
    .description("Show current merged configuration")
    .action((options: { json: boolean }) => {
      const config = loadConfig();
      const keys = Object.keys(config);
      if (options.json) { console.log(JSON.stringify(config, null, 2)); return; }
      if (!keys.length) { console.log(chalk.dim("No configuration set")); return; }
      for (const [key, value] of Object.entries(config)) console.log(`${chalk.cyan(key)} = ${chalk.bold(value as string)}`);
    });

  configCmd
    .command("set <key> <value>")
    .option("--global", "Save to global config (~/.skillsrc)", false)
    .option("--json", "Output as JSON", false)
    .description("Set a configuration value")
    .action((key: string, value: string, options) => {
      const scope = options.global ? "global" : "project";
      try {
        saveConfig(key, value, scope);
        const savedValue = (loadConfig() as Record<string, string | undefined>)[key];
        if (options.json) console.log(JSON.stringify({ key, value: savedValue, scope, path: getConfigPath(scope) }));
        else console.log(chalk.green(`Set ${key} = ${savedValue ?? value} (${scope})`));
      }
      catch (err) {
        if (options.json) console.log(JSON.stringify({ key, value, scope, error: (err as Error).message }));
        else console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  configCmd
    .command("unset <key>")
    .option("--global", "Remove from the global config instead of the project config", false)
    .option("--json", "Output as JSON", false)
    .description("Remove a configuration value")
    .action((key: string, options: { global: boolean; json: boolean }) => {
      const scope = options.global ? "global" : "project";
      try {
        const removed = unsetConfig(key, scope);
        if (options.json) console.log(JSON.stringify({ key, removed, scope, path: getConfigPath(scope) }));
        else if (removed) console.log(chalk.green(`Unset ${key} (${scope})`));
        else console.log(chalk.dim(`${key} was not set (${scope})`));
      }
      catch (err) {
        if (options.json) console.log(JSON.stringify({ key, scope, error: (err as Error).message }));
        else console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  configCmd
    .command("get <key>")
    .option("--json", "Output as JSON", false)
    .description("Get a specific configuration value")
    .action((key: string, options: { json: boolean }) => {
      const config = loadConfig();
      const value = (config as any)[key];
      if (options.json) { console.log(JSON.stringify({ key, value: value ?? null, set: value !== undefined })); return; }
      console.log(value === undefined ? chalk.dim(`${key} is not set`) : value);
    });

  configCmd
    .command("path")
    .option("--json", "Output as JSON", false)
    .description("Show configuration file paths")
    .action((options: { json: boolean }) => {
      const gp = getConfigPath("global");
      const pp = getConfigPath("project");
      if (options.json) {
        console.log(JSON.stringify({
          global: { path: gp, exists: existsSync(gp) },
          project: { path: pp, exists: existsSync(pp) },
        }, null, 2));
        return;
      }
      console.log(`${chalk.cyan("global")}:  ${gp}${existsSync(gp) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
      console.log(`${chalk.cyan("project")}: ${pp}${existsSync(pp) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
    });

  // Create
  parent
    .command("create")
    .argument("<name>", "Skill name (e.g. my-tool)")
    .option("--category <category>", "Skill category", "Development Tools")
    .option("--description <description>", "Short description of what the skill does")
    .option("--tags <tags>", "Comma-separated tags (e.g. api,testing,automation)")
    .option("--global", "Deprecated; custom skills are always global", false)
    .option("--json", "Output result as JSON", false)
    .description("Scaffold a new custom skill directory")
    .action((name: string, options: any) => handleCreate(name, options));

  // Sync — the last mile: corpus -> each agent's global skills folder.
  // The package ships no bundled corpus, so the corpus is the installed cache
  // (~/.hasna/skills/installed, what `skills pull` writes), or an explicit canonical
  // source — `--source <path>` or $SKILLS_SOURCE, typically the monorepo checkout.
  parent
    .command("sync")
    .alias("render")
    .argument("[names...]", "Skills to sync (default: every skill in this machine's corpus)")
    .option("--for <agent>", `Target one agent (${SYNC_AGENTS.join(", ")}, or all)`, "all")
    .option("--all", "Sync every corpus skill (the default)", false)
    .option(
      "--source <path>",
      "Canonical corpus source: a directory of skill folders, or a package root with skills/ (overrides $SKILLS_SOURCE)",
    )
    .option("--dry-run", "Show what would be written without touching any agent folder", false)
    .option(
      "--force",
      "Adopt an unmanaged skill that already has SKILL.md; other unmarked directories are never overwritten",
      false,
    )
    .option(
      "--check",
      "Home drift census (missing-from-home / stray-in-home / diverged); exits non-zero on drift, writes nothing",
      false,
    )
    .option(
      "--adopt",
      "Unmarked-home adoption mode: hash unmarked home skills against the corpus; exact matches are marked (dry-run by default)",
      false,
    )
    .option(
      "--prune",
      "Prune mode: list (or with --apply, remove) marked home skill dirs that have no canonical corpus entry",
      false,
    )
    .option("--apply", "Write adoption markers / conflicts ledger, or perform prune removals", false)
    .option("--json", "Output as JSON", false)
    .option(
      "--station <id>",
      "Per-station snapshot mode: snapshot the installed skill homes into resources/<station>/skills with a v3 sync-manifest (dry-run by default; --populate writes)",
    )
    .option("--populate", "Write the per-station snapshot (station mode; the default is dry-run)", false)
    .option("--repo-root <path>", "Station snapshot destination repo root (default: cwd)")
    .option("--homes-root <dir>", "Build the station snapshot from a staged mirror of the skill homes instead of this machine's $HOME")
    .description("Write corpus skills into each coding agent's global skills folder, per-tool adapted; with --station, snapshot the homes into a reviewed snapshot repo instead")
    .action((names: string[], options) => handleSync(names, options));
}

function handleCreate(name: string, options: { category: string; description?: string; tags?: string; global: boolean; json: boolean }) {
  const bare = name.trim();
  const dirName = bare;
  // The corpus, not the legacy custom/ folder, and resolved rather than rebuilt
  // from homedir() so this honours $HASNA_SKILLS_DIR like every other write path.
  const baseDir = getPortableSkillsRoot();
  const skillDir = join(baseDir, dirName);

  if (existsSync(skillDir)) {
    console.log(options.json ? JSON.stringify({ error: `Skill '${bare}' already exists at ${skillDir}` }) : chalk.red(`Skill '${bare}' already exists at ${skillDir}`));
    process.exitCode = 1; return;
  }

  const description = options.description || `${bare} skill`;
  const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [bare];
  const displayName = bare.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  mkdirSync(join(skillDir, "src"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---", `name: ${bare}`, `description: ${description}`, `displayName: ${displayName}`, `category: ${options.category}`, `tags: [${tags.join(", ")}]`, "",
    `# ${displayName}`, "", description, "", "## Usage", "", "```bash", `${bare} --help`, "```", "",
  ].join("\n"));
  writeFileSync(join(skillDir, "src", "index.ts"), [`#!/usr/bin/env bun`, `/**`, ` * ${displayName} — ${description}`, ` */`, "", `console.log("${displayName}");`, ""].join("\n"));
  writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: bare, version: "0.1.0", description, bin: { [bare]: "./src/index.ts" }, scripts: { dev: `bun src/index.ts` }, dependencies: {} }, null, 2) + "\n");
  writeFileSync(join(skillDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, outDir: "dist" }, include: ["src/**/*.ts"] }, null, 2) + "\n");

  clearRegistryCache();
  if (options.json) console.log(JSON.stringify({ created: true, name: bare, path: skillDir, category: options.category, tags }));
  else {
    console.log(chalk.green(`✓ Created custom skill '${bare}' at ${skillDir}`));
    console.log(chalk.dim(`  Category: ${options.category}`));
    console.log(chalk.dim(`  Tags: ${tags.join(", ")}`));
    console.log(`  ${chalk.cyan("Edit:")} ${join(skillDir, "src", "index.ts")}`);
    console.log(`  ${chalk.cyan("Run:")}  bun ${join(skillDir, "src", "index.ts")}`);
  }
}

function handleSync(
  names: string[],
  options: { for: string; all: boolean; source?: string; dryRun: boolean; force: boolean; check: boolean; adopt: boolean; prune: boolean; apply: boolean; json: boolean; station?: string; populate: boolean; repoRoot?: string; homesRoot?: string },
) {
  if (options.station) {
    handleStationSnapshot(names, options);
    return;
  }
  const modes = [options.check, options.adopt, options.prune].filter(Boolean).length;
  if (modes > 1) {
    const message = "--check, --adopt, and --prune are mutually exclusive";
    if (options.json) console.log(JSON.stringify({ error: message }));
    else console.error(chalk.red(message));
    process.exitCode = 1;
    return;
  }
  if (options.check) {
    handleSyncCheck(options.json);
    return;
  }
  if (options.adopt) {
    handleSyncAdopt(options.apply, options.json);
    return;
  }
  if (options.prune) {
    handleSyncPrune(options.apply, options.json);
    return;
  }

  let agents;
  try {
    agents = resolveSyncAgents(options.for);
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: (error as Error).message }));
    else console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }

  let actions;
  try {
    ({ actions } = syncSkillsToAgents({
      ...(names.length ? { names } : {}),
      all: options.all,
      agents,
      sourceDir: options.source,
      dryRun: options.dryRun,
      force: options.force,
    }));
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: (error as Error).message }));
    else console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ dryRun: options.dryRun, actions }, null, 2));
  } else {
    printSyncHuman(actions, options.dryRun);
  }
  // A skip because a NAMED skill is missing from the corpus is a failure; a skip because a
  // folder is hand-authored is a deliberate, successful no-op and must not fail the run.
  if (actions.some((action) => action.action === "skip" && action.reason?.includes("not found"))) {
    process.exitCode = 1;
  }
}

/**
 * Per-station snapshot mode (`skills sync --station <id>`): snapshot the
 * installed skill homes into resources/<station>/skills with a v3
 * sync-manifest. Dry-run is the default; --populate writes. Fail-closed
 * classes (invalid station, symlinks, conflicts, destination escape) exit 2,
 * exactly like the retired fleet-resources script this generalizes.
 */
function handleStationSnapshot(
  names: string[],
  options: { station?: string; populate: boolean; dryRun: boolean; repoRoot?: string; homesRoot?: string; json: boolean; check: boolean; adopt: boolean; prune: boolean; force: boolean; all: boolean; source?: string },
): void {
  const station = options.station;
  if (!station) return;
  if (options.populate && options.dryRun) {
    const message = "--populate and --dry-run are mutually exclusive";
    if (options.json) console.log(JSON.stringify({ error: message }));
    else console.error(chalk.red(message));
    process.exitCode = 1;
    return;
  }
  const incompatible = names.length > 0 || options.check || options.adopt || options.prune
    || options.force || options.all || options.source !== undefined;
  if (incompatible) {
    const message = "--station (per-station snapshot mode) cannot be combined with corpus->home sync names, --check, --adopt, --prune, --force, --all, or --source";
    if (options.json) console.log(JSON.stringify({ error: message }));
    else console.error(chalk.red(message));
    process.exitCode = 1;
    return;
  }

  try {
    const result = writeStationSnapshot({
      stationId: station,
      repoRoot: options.repoRoot,
      homesRoot: options.homesRoot,
      dryRun: !options.populate,
    });
    if (result.mode === "dry-run") {
      if (options.json) {
        console.log(JSON.stringify({
          stationId: result.stationId,
          mode: "dry-run",
          stats: { files: result.stats.files, bytes: result.stats.bytes },
          homes: Object.fromEntries(result.homes.map((home) => [
            home.name,
            { homePath: home.homePath, files: home.files, skipped: home.skipped },
          ])),
        }, null, 2));
        return;
      }
      console.log(
        `DRY-RUN station=${result.stationId} files=${result.stats.files} bytes=${result.stats.bytes}`
      );
      for (const home of result.homes) {
        console.log(`  ${home.name}: ${home.files} files, ${home.skipped} skipped`);
      }
      return;
    }
    console.log(
      `POPULATE station=${result.stationId} written=${result.stats.written} unchanged=${result.stats.unchanged} total=${result.stats.files} bytes=${result.stats.bytes}`
    );
  } catch (error) {
    if (error instanceof StationSnapshotError) {
      for (const line of error.detail) console.error(`CONFLICT ${line}`);
      console.error(`FAIL ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(`FAIL ${(error as Error).stack ?? (error as Error).message}`);
      process.exitCode = 1;
    }
  }
}

function handleSyncCheck(json: boolean): void {
  const census = censusHomeDrift();
  if (json) {
    console.log(JSON.stringify(census, null, 2));
  } else {
    printCensusHuman(census);
  }
  if (!census.clean) process.exitCode = 1;
}

function handleSyncAdopt(apply: boolean, json: boolean): void {
  const result = adoptUnmarkedHomes({ apply });
  if (json) {
    console.log(JSON.stringify({ dryRun: !apply, ...result }, null, 2));
  } else {
    const verb = apply ? "Adopted" : "Would adopt";
    console.log(chalk.bold(`\nUnmarked-home adoption (${apply ? "apply" : "dry-run"}):\n`));
    for (const entry of result.adoptable) {
      console.log(`${apply ? chalk.green("✓") : chalk.dim("[dry-run]")} ${chalk.bold(entry.skill)} → ${entry.agent} (${entry.path})`);
    }
    for (const conflict of result.conflicts) {
      console.log(`${chalk.yellow("• conflict")} ${chalk.bold(conflict.skill)} → ${conflict.agent} (content differs from canonical; recorded, skipped)`);
    }
    for (const entry of result.unknown) {
      console.log(`${chalk.dim("• unknown")} ${chalk.bold(entry.skill)} → ${entry.agent} (no canonical corpus entry; skipped)`);
    }
    console.log(
      chalk.dim(`\n${apply ? "Adopted" : "Would adopt"} ${result.adoptable.length}, ${result.conflicts.length} conflict(s), ${result.unknown.length} unknown, ${result.managed} already managed`),
    );
    if (apply && result.rollbackFile) console.log(chalk.dim(`Rollback record: ${result.rollbackFile}`));
    if (!apply) console.log(chalk.dim(`\nPass --apply to write markers${result.conflicts.length ? " and the conflicts ledger" : ""}.`));
  }
}

function handleSyncPrune(apply: boolean, json: boolean): void {
  const result = pruneStrayHomes({ apply });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = apply ? "Pruned" : "Would prune";
    console.log(chalk.bold(`\nMarked-and-stray prune (${apply ? "apply" : "dry-run"}):\n`));
    for (const candidate of result.candidates) {
      console.log(`${apply ? chalk.red("✗") : chalk.dim("[dry-run]")} ${chalk.bold(candidate.skill)} → ${candidate.agent} (${candidate.path})`);
    }
    console.log(chalk.dim(`\n${verb} ${result.pruned} of ${result.candidates.length} marked-and-stray dirs (unmarked dirs are never touched).`));
    if (apply && result.rollbackFile) console.log(chalk.dim(`Rollback record: ${result.rollbackFile}`));
    if (!apply) console.log(chalk.dim(`\nPass --apply to remove them (recorded in the rollback store first).`));
  }
}

function printCensusHuman(census: DriftCensus): void {
  const counts: Record<string, number> = {};
  for (const entry of census.entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  if (census.clean) {
    console.log(chalk.green(`Home drift census: clean (${census.homesChecked} home(s) checked, ${census.managed} managed, ${census.unmarked} unmarked)`));
    return;
  }
  console.log(chalk.bold(`\nHome drift census: ${census.entries.length} drift entr${census.entries.length === 1 ? "y" : "ies"} across ${census.homesChecked} home(s)\n`));
  for (const entry of census.entries) {
    const kind = entry.kind === "missing-from-home"
      ? chalk.red("missing-from-home")
      : entry.kind === "stray-in-home"
        ? chalk.yellow("stray-in-home")
        : chalk.yellow("diverged");
    let note = "";
    if (entry.homeStub === true) note = " (home is a pointer stub; canonical holds content)";
    else if (entry.canonicalStub === true) note = " (home holds content; canonical renders a pointer stub — sync refuses to replace it)";
    console.log(`  ${kind}  ${chalk.bold(entry.skill)} → ${entry.agent}  ${chalk.dim(entry.path)}${note}`);
  }
  console.log(chalk.dim(`\n${census.managed} managed, ${census.unmarked} unmarked (adoption candidates). Exit code is non-zero while drift exists.`));
}

function printSyncHuman(actions: AgentSyncAction[], dryRun?: boolean): void {
  if (!actions.length) {
    console.log(chalk.dim("No skills in this machine's corpus to sync. Pull some first: skills pull --all"));
    return;
  }
  const prefix = dryRun ? chalk.dim("[dry-run] ") : "";
  console.log(chalk.bold(`\n${dryRun ? "Would sync" : "Syncing"} skills into agent folders...\n`));
  for (const action of actions) {
    const label = `${action.skill} → ${action.agent}`;
    if (action.action === "skip") {
      console.log(`${prefix}${chalk.yellow(`• skip ${label}`)}${action.reason ? chalk.dim(`  (${action.reason})`) : ""}`);
    } else {
      const verb = action.action === "create" ? "add" : "update";
      console.log(`${prefix}${chalk.green(`✓ ${verb} ${label}`)}${chalk.dim(`  → ${action.path}`)}`);
    }
  }
  const written = actions.filter((a) => a.action !== "skip").length;
  console.log(chalk.dim(`\n${written}/${actions.length} ${dryRun ? "would be written" : "written"}`));
}
