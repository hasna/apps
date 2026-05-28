import chalk from "chalk";
import { resolve, join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { Command } from "commander";
import type { AgentName } from "../../lib/detect.js";
import { jsonOut, error, formatAgo, statusColor, buildStyleMdContent } from "../../lib/format.js";
import { detectProjectPath } from "../../lib/detect.js";
import { getActiveProfile, getBuiltinStyleProfile, setActiveProfile } from "../../lib/profiles.js";
import { setPref, listPrefs } from "../../lib/preferences.js";
import { getDb } from "../../lib/db.js";
import { writeStyleContextFile, setProjectConfig, getProjectConfig, initProjectDir } from "../../lib/fs.js";
import { injectStyleHook, injectAllStyleHooks } from "../../lib/hookmanager.js";
import {
  injectIntoAgentMd,
  injectIntoAllAgentMds,
  removeFromAgentMd,
  removeFromAllAgentMds,
  injectIntoClaudeMd,
} from "../../lib/contextinjector.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerContextCommands(program: Command) {
  // ── styles use ──────────────────────────────────────────────────────────────

  program
    .command("use <name>")
    .description("Set the active style for a project or globally")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("-g, --global", "Set as global default instead of project-specific")
    .option("--inject-context", "Inject context into CLAUDE.md even if it does not exist yet")
    .action(async (name: string, opts: { project?: string; global?: boolean; injectContext?: boolean }) => {
      const { getStyle, findSimilarStyles } = await import("../../lib/registry.js");
      const style = getStyle(name);
      if (!style) {
        const similar = findSimilarStyles(name);
        error(`Style not found: "${name}"`, similar.length ? [`Did you mean: ${similar.join(", ")}`] : undefined);
      }

      const profile = getBuiltinStyleProfile(name);
      const projectPath = resolve(opts.project ?? detectProjectPath());

      if (opts.global) {
        setPref("active_profile", profile.id, "global");
        if (isTTY) console.log(chalk.green(`✔ Global style set to: ${style.displayName}`));
        else jsonOut({ ok: true, scope: "global", style: name, profileId: profile.id });
        return;
      }

      setActiveProfile(projectPath, profile.id);
      writeStyleContextFile(projectPath, buildStyleMdContent(name));

      const claudeDir = join(projectPath, ".claude");
      if (existsSync(claudeDir)) {
        const result = injectStyleHook(projectPath);
        if (isTTY && !result.alreadyInstalled) console.log(chalk.dim("  Hook injected into .claude/settings.json"));
      }

      const prefsArr = listPrefs(projectPath);
      const claudeMdPath = join(projectPath, "CLAUDE.md");
      if (opts.injectContext || existsSync(claudeMdPath)) {
        const injectResults = injectIntoAllAgentMds(projectPath, profile, prefsArr);
        if (isTTY) {
          for (const [, res] of Object.entries(injectResults)) {
            if (res && res.action !== "unchanged") console.log(chalk.dim(`  ${res.agent} context ${res.action}: ${res.path}`));
          }
        }
      }

      if (isTTY) {
        console.log(chalk.green(`✔ Active style set to: ${style.displayName}`));
        console.log(chalk.dim(`  Project: ${projectPath}`));
        console.log(chalk.dim(`  Context file written: ${join(projectPath, ".styles", "style.md")}`));
      } else {
        jsonOut({ ok: true, scope: "project", project: projectPath, style: name, profileId: profile.id });
      }
    });

  // ── styles init ─────────────────────────────────────────────────────────────

  program
    .command("init")
    .description("Initialize open-styles for a project")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("-s, --style <name>", "Style to activate")
    .option("--inject-context", "Inject context into CLAUDE.md even if it does not exist yet")
    .action(async (opts: { project?: string; style?: string; injectContext?: boolean }) => {
      const { getStyle, findSimilarStyles } = await import("../../lib/registry.js");
      const projectPath = resolve(opts.project ?? detectProjectPath());

      initProjectDir(projectPath);

      const existingConfig = getProjectConfig(projectPath);
      setProjectConfig(projectPath, {
        projectPath,
        profileId: existingConfig?.profileId ?? null,
        activeTemplateId: existingConfig?.activeTemplateId ?? null,
        customOverrides: existingConfig?.customOverrides ?? {},
        hookInstalled: existingConfig?.hookInstalled ?? false,
        updatedAt: Date.now(),
      });

      const stylesDir = join(projectPath, ".styles");
      if (!existsSync(stylesDir)) mkdirSync(stylesDir, { recursive: true });

      let activeProfile = null;
      if (opts.style) {
        const style = getStyle(opts.style);
        if (!style) {
          const similar = findSimilarStyles(opts.style);
          error(`Style not found: "${opts.style}"`, similar.length ? [`Did you mean: ${similar.join(", ")}`] : undefined);
        }
        activeProfile = getBuiltinStyleProfile(opts.style);
        setActiveProfile(projectPath, activeProfile.id);
        writeStyleContextFile(projectPath, buildStyleMdContent(opts.style));
      }

      const hookResults = injectAllStyleHooks(projectPath);

      const initPrefsArr = listPrefs(projectPath);
      const claudeMdPath = join(projectPath, "CLAUDE.md");
      if (activeProfile && (opts.injectContext || existsSync(claudeMdPath))) {
        const ctxResults = injectIntoAllAgentMds(projectPath, activeProfile, initPrefsArr);
        if (isTTY) {
          for (const [, res] of Object.entries(ctxResults)) {
            if (res && res.action !== "unchanged") console.log(chalk.dim(`  ${res.agent} context ${res.action}: ${res.path}`));
          }
        }
      }

      const injectedAgents = Object.entries(hookResults)
        .filter(([, r]) => r !== null)
        .map(([a]) => a);

      if (isTTY) {
        console.log(chalk.green(`✔ Initialized open-styles for: ${projectPath}`));
        if (opts.style) console.log(chalk.dim(`  Active style: ${opts.style}`));
        if (injectedAgents.length > 0) console.log(chalk.dim(`  Hooks injected for agents: ${injectedAgents.join(", ")}`));
      } else {
        jsonOut({ ok: true, projectPath, style: opts.style ?? null, hooks: hookResults });
      }
    });

  // ── styles context ──────────────────────────────────────────────────────────

  program
    .command("context")
    .description("Show the active style context for a project (for AI agents)")
    .option("-p, --project <path>", "Project path (default: auto-detect)")
    .action(async (opts: { project?: string }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());

      let profile = getActiveProfile(projectPath);
      if (!profile) profile = getBuiltinStyleProfile("minimalist");

      const prefsArr = listPrefs(projectPath);
      const prefsMap: Record<string, string> = {};
      for (const p of prefsArr) prefsMap[p.key] = p.value;

      const db = getDb();
      const lastCheck = db
        .prepare("SELECT score, status, run_at FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1")
        .get(projectPath) as { score: number; status: string; run_at: number } | null;

      const result = {
        projectPath,
        activeStyle: { name: profile.name, displayName: profile.displayName, category: profile.category },
        principles: profile.principles,
        antiPatterns: "antiPatterns" in profile ? profile.antiPatterns : [],
        preferences: prefsMap,
        score: lastCheck?.score ?? null,
        status: lastCheck?.status ?? null,
        lastCheckAgo: formatAgo(lastCheck?.run_at),
      };

      if (!isTTY) { jsonOut(result); return; }

      console.log();
      console.log(chalk.bold(`Active Style: ${profile.displayName}`));
      console.log(chalk.dim(`Category: ${profile.category}`));
      console.log(chalk.dim(`Project: ${projectPath}`));
      if (result.principles.length) {
        console.log();
        console.log(chalk.bold("Principles:"));
        for (const p of result.principles) console.log(`  ${chalk.cyan("•")} ${p}`);
      }
      if (result.antiPatterns.length) {
        console.log();
        console.log(chalk.bold("Anti-Patterns:"));
        for (const ap of result.antiPatterns) console.log(`  ${chalk.red("✗")} ${ap}`);
      }
      if (Object.keys(prefsMap).length) {
        console.log();
        console.log(chalk.bold("Preferences:"));
        for (const [k, v] of Object.entries(prefsMap)) console.log(`  ${chalk.cyan(k)}: ${v}`);
      }
      if (lastCheck) {
        console.log();
        console.log(`Health: ${statusColor(lastCheck.status)}  Score: ${chalk.bold(String(lastCheck.score))}/100  (${result.lastCheckAgo})`);
      }
      console.log();
    });

  // ── styles inject-context ───────────────────────────────────────────────────

  program
    .command("inject-context")
    .description("Inject or update the style context block in agent MD files")
    .option("-p, --project <path>", "Project path (default: auto-detect)")
    .option("--agent <name>", "Only inject into a specific agent (claude|gemini|codex|opencode|pi)")
    .option("--remove", "Remove the style context block from agent MD files")
    .action(async (opts: { project?: string; agent?: string; remove?: boolean }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());
      const agentFilter = opts.agent as AgentName | undefined;

      if (opts.remove) {
        if (agentFilter) {
          const result = removeFromAgentMd(projectPath, agentFilter);
          if (!isTTY) { jsonOut({ ok: true, ...result }); return; }
          if (result.action === "removed") console.log(chalk.green(`✔ Removed style context from: ${result.path}`));
          else console.log(chalk.dim(`No style context block found in: ${result.path}`));
        } else {
          removeFromAllAgentMds(projectPath);
          if (!isTTY) { jsonOut({ ok: true, action: "removed-all" }); return; }
          console.log(chalk.green(`✔ Removed style context from all agent MD files`));
        }
        return;
      }

      let profile = getActiveProfile(projectPath);
      if (!profile) profile = getBuiltinStyleProfile("minimalist");

      const prefsArr = listPrefs(projectPath);

      if (agentFilter) {
        const result = injectIntoAgentMd(projectPath, agentFilter, profile, prefsArr);
        if (!isTTY) { jsonOut({ ok: true, ...result }); return; }
        if (result.action === "unchanged") console.log(chalk.dim(`Style context already up to date: ${result.path}`));
        else console.log(chalk.green(`✔ Style context ${result.action}: ${result.path}`));
      } else {
        const results = injectIntoAllAgentMds(projectPath, profile, prefsArr);
        if (!isTTY) { jsonOut({ ok: true, results }); return; }
        let anyChange = false;
        for (const [, res] of Object.entries(results)) {
          if (!res) continue;
          if (res.action === "unchanged") console.log(chalk.dim(`Style context already up to date: ${res.path}`));
          else { console.log(chalk.green(`✔ Style context ${res.action}: ${res.path}`)); anyChange = true; }
        }
        if (!anyChange) console.log(chalk.dim("No agent MD files found to inject into. Run `styles init` first."));
      }
    });
}
