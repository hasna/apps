#!/usr/bin/env bun
import { program } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createConfig, deleteConfig, getConfig, getConfigStats, listConfigs, updateConfig } from "../db/configs.js";
import { createProfile, deleteProfile, getProfile, getProfileConfigs, listProfiles, updateProfile, addConfigToProfile, removeConfigFromProfile } from "../db/profiles.js";
import { listSnapshots, getSnapshot } from "../db/snapshots.js";
import { getDatabase } from "../db/database.js";
import { applyConfig, applyConfigs } from "../lib/apply.js";
import { diffConfig, syncKnown, syncToDisk, detectCategory, detectAgent, detectFormat, KNOWN_CONFIGS } from "../lib/sync.js";
import { syncFromDir } from "../lib/sync-dir.js";
import { redactContent, scanSecrets } from "../lib/redact.js";
import { exportConfigs } from "../lib/export.js";
import { importConfigs } from "../lib/import.js";
import { extractTemplateVars } from "../lib/template.js";
import type { ConfigAgent, ConfigCategory, ConfigFormat, ConfigKind } from "../types/index.js";

import { createRequire } from "node:module";
const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };

function fmtConfig(c: ReturnType<typeof getConfig>, format: string) {
  if (format === "json") return JSON.stringify(c, null, 2);
  if (format === "compact") return `${c.slug} [${c.category}/${c.agent}] ${c.kind === "reference" ? "(ref)" : c.target_path ?? "(no path)"}`;
  // table
  return [
    `${chalk.bold(c.name)} ${chalk.dim(`(${c.slug})`)}`,
    `  ${chalk.cyan("category:")} ${c.category}  ${chalk.cyan("agent:")} ${c.agent}  ${chalk.cyan("kind:")} ${c.kind}`,
    `  ${chalk.cyan("format:")} ${c.format}  ${chalk.cyan("version:")} ${c.version}${c.target_path ? `  ${chalk.cyan("path:")} ${c.target_path}` : ""}`,
    c.description ? `  ${chalk.dim(c.description)}` : "",
    c.tags.length > 0 ? `  ${chalk.dim("tags: " + c.tags.join(", "))}` : "",
  ].filter(Boolean).join("\n");
}

// ── list ─────────────────────────────────────────────────────────────────────
program
  .command("list")
  .alias("ls")
  .description("List stored configs")
  .option("-c, --category <cat>", "filter by category")
  .option("-a, --agent <agent>", "filter by agent")
  .option("-k, --kind <kind>", "filter by kind (file|reference)")
  .option("-t, --tag <tag>", "filter by tag")
  .option("-s, --search <query>", "search name/description/content")
  .option("-f, --format <fmt>", "output format: table|json|compact", "table")
  .action(async (opts) => {
    const configs = listConfigs({
      category: opts.category as ConfigCategory,
      agent: opts.agent as ConfigAgent,
      kind: opts.kind as ConfigKind,
      tags: opts.tag ? [opts.tag] : undefined,
      search: opts.search,
    });
    if (configs.length === 0) {
      console.log(chalk.dim("No configs found."));
      return;
    }
    if (opts.format === "json") {
      console.log(JSON.stringify(configs, null, 2));
      return;
    }
    for (const c of configs) {
      console.log(fmtConfig(c, opts.format));
      if (opts.format === "table") console.log();
    }
    console.log(chalk.dim(`${configs.length} config(s)`));
  });

// ── show ─────────────────────────────────────────────────────────────────────
program
  .command("show <id>")
  .description("Show a config's content and metadata")
  .option("-f, --format <fmt>", "output format: table|json|content", "table")
  .action(async (id, opts) => {
    try {
      const c = getConfig(id);
      if (opts.format === "json") { console.log(JSON.stringify(c, null, 2)); return; }
      if (opts.format === "content") { console.log(c.content); return; }
      console.log(fmtConfig(c, "table"));
      console.log();
      console.log(chalk.bold("Content:"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(c.content);
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// ── add ───────────────────────────────────────────────────────────────────────
program
  .command("add <path>")
  .description("Ingest a file into the config DB")
  .option("-n, --name <name>", "config name (defaults to filename)")
  .option("-c, --category <cat>", "category override")
  .option("-a, --agent <agent>", "agent override")
  .option("-k, --kind <kind>", "kind: file|reference", "file")
  .option("--template", "mark as template (has {{VAR}} placeholders)")
  .action(async (filePath, opts) => {
    const abs = resolve(filePath);
    if (!existsSync(abs)) {
      console.error(chalk.red(`File not found: ${abs}`));
      process.exit(1);
    }
    const rawContent = readFileSync(abs, "utf-8");
    const fmt = detectFormat(abs);
    const { content, redacted, isTemplate } = redactContent(rawContent, fmt as "shell" | "json" | "toml" | "ini" | "markdown" | "text");
    const targetPath = abs.startsWith(homedir()) ? abs.replace(homedir(), "~") : abs;
    const name = opts.name || filePath.split("/").pop()!;
    const config = createConfig({
      name,
      kind: (opts.kind as ConfigKind) ?? "file",
      category: (opts.category as ConfigCategory) ?? detectCategory(abs),
      agent: (opts.agent as ConfigAgent) ?? detectAgent(abs),
      target_path: opts.kind === "reference" ? null : targetPath,
      format: fmt,
      content,
      is_template: (opts.template ?? false) || isTemplate,
    });
    console.log(chalk.green("✓") + ` Added: ${chalk.bold(config.name)} ${chalk.dim(`(${config.slug})`)}`);
    if (redacted.length > 0) {
      console.log(chalk.yellow(`  ⚠ Redacted ${redacted.length} secret(s):`));
      for (const r of redacted) console.log(chalk.yellow(`    line ${r.line}: {{${r.varName}}} — ${r.reason}`));
      console.log(chalk.dim("  Config stored as a template. Use `configs template vars` to see placeholders."));
    }
  });

// ── apply ─────────────────────────────────────────────────────────────────────
program
  .command("apply <id>")
  .description("Apply a config to its target_path on disk")
  .option("--dry-run", "preview without writing")
  .option("--force", "overwrite even if unchanged")
  .action(async (id, opts) => {
    try {
      const config = getConfig(id);
      const result = await applyConfig(config, { dryRun: opts.dryRun });
      const status = opts.dryRun ? chalk.yellow("[dry-run]") : (result.changed ? chalk.green("✓") : chalk.dim("="));
      const change = result.changed ? "changed" : "unchanged";
      console.log(`${status} ${result.path} ${chalk.dim(`(${change})`)}`);
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// ── diff ─────────────────────────────────────────────────────────────────────
program
  .command("diff <id>")
  .description("Show diff between stored config and disk")
  .action(async (id) => {
    try {
      const config = getConfig(id);
      const diff = diffConfig(config);
      console.log(diff);
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// ── sync ─────────────────────────────────────────────────────────────────────
program
  .command("sync")
  .description("Sync known AI coding configs from disk into DB (claude, codex, gemini, zsh, git, npm)")
  .option("-a, --agent <agent>", "only sync configs for this agent (claude|codex|gemini|zsh|git|npm)")
  .option("-c, --category <cat>", "only sync configs in this category")
  .option("--to-disk", "apply DB configs back to disk instead")
  .option("--dry-run", "preview without writing")
  .option("--list", "show which files would be synced without doing anything")
  .action(async (opts) => {
    if (opts.list) {
      const targets = KNOWN_CONFIGS.filter((k) => {
        if (opts.agent && k.agent !== opts.agent) return false;
        if (opts.category && k.category !== opts.category) return false;
        return true;
      });
      console.log(chalk.bold(`Known configs (${targets.length}):`));
      for (const k of targets) {
        console.log(`  ${chalk.cyan(k.rulesDir ? k.rulesDir + "/*.md" : k.path)} ${chalk.dim(`[${k.category}/${k.agent}]`)}`);
      }
      return;
    }
    if (opts.toDisk) {
      const result = await syncToDisk({ dryRun: opts.dryRun, agent: opts.agent, category: opts.category });
      console.log(chalk.green("✓") + ` Written to disk: updated:${result.updated} unchanged:${result.unchanged} skipped:${result.skipped.length}`);
    } else {
      const result = await syncKnown({ dryRun: opts.dryRun, agent: opts.agent, category: opts.category });
      console.log(chalk.green("✓") + ` Synced: +${result.added} updated:${result.updated} unchanged:${result.unchanged} skipped:${result.skipped.length}`);
      if (result.skipped.length > 0) {
        console.log(chalk.dim("  skipped (not found): " + result.skipped.join(", ")));
      }
    }
  });

// ── export ────────────────────────────────────────────────────────────────────
program
  .command("export")
  .description("Export configs as a tar.gz bundle")
  .option("-o, --output <path>", "output file", "./configs-export.tar.gz")
  .option("-c, --category <cat>", "filter by category")
  .action(async (opts) => {
    const result = await exportConfigs(opts.output, {
      filter: opts.category ? { category: opts.category as ConfigCategory } : undefined,
    });
    console.log(chalk.green("✓") + ` Exported ${result.count} configs to ${result.path}`);
  });

// ── import ────────────────────────────────────────────────────────────────────
program
  .command("import <file>")
  .description("Import configs from a tar.gz bundle")
  .option("--overwrite", "overwrite existing configs")
  .action(async (file, opts) => {
    const result = await importConfigs(file, {
      conflict: opts.overwrite ? "overwrite" : "skip",
    });
    console.log(chalk.green("✓") + ` Import complete: +${result.created} updated:${result.updated} skipped:${result.skipped}`);
    if (result.errors.length > 0) {
      console.log(chalk.red("Errors:"));
      for (const e of result.errors) console.log(chalk.red("  " + e));
    }
  });

// ── whoami ────────────────────────────────────────────────────────────────────
program
  .command("whoami")
  .description("Show setup summary")
  .action(async () => {
    const dbPath = process.env["CONFIGS_DB_PATH"] || join(homedir(), ".configs", "configs.db");
    const stats = getConfigStats();
    console.log(chalk.bold("@hasna/configs") + chalk.dim(" v" + pkg.version));
    console.log(chalk.cyan("DB:") + " " + dbPath);
    console.log(chalk.cyan("Total configs:") + " " + (stats["total"] || 0));
    console.log();
    console.log(chalk.bold("By category:"));
    const categories = ["agent", "rules", "mcp", "shell", "secrets_schema", "workspace", "git", "tools"];
    for (const cat of categories) {
      const count = stats[cat] || 0;
      if (count > 0) console.log(`  ${chalk.cyan(cat.padEnd(16))} ${count}`);
    }
    const profiles = listProfiles();
    if (profiles.length > 0) {
      console.log();
      console.log(chalk.bold("Profiles:") + chalk.dim(` (${profiles.length})`));
      for (const p of profiles) console.log(`  ${chalk.cyan(p.name)} ${chalk.dim(`(${p.slug})`)}`);
    }
  });

// ── profile ───────────────────────────────────────────────────────────────────
const profileCmd = program.command("profile").description("Manage config profiles (named bundles)");

profileCmd.command("list").description("List all profiles").action(async () => {
  const profiles = listProfiles();
  if (profiles.length === 0) { console.log(chalk.dim("No profiles.")); return; }
  for (const p of profiles) {
    const configs = getProfileConfigs(p.id);
    console.log(`${chalk.bold(p.name)} ${chalk.dim(`(${p.slug})`)} — ${configs.length} config(s)`);
    if (p.description) console.log(`  ${chalk.dim(p.description)}`);
  }
});

profileCmd.command("create <name>").description("Create a new profile")
  .option("-d, --description <desc>", "profile description")
  .action(async (name, opts) => {
    const p = createProfile({ name, description: opts.description });
    console.log(chalk.green("✓") + ` Created profile: ${chalk.bold(p.name)} ${chalk.dim(`(${p.slug})`)}`);
  });

profileCmd.command("show <id>").description("Show profile and its configs").action(async (id) => {
  try {
    const p = getProfile(id);
    const configs = getProfileConfigs(id);
    console.log(chalk.bold(p.name) + chalk.dim(` (${p.slug})`));
    if (p.description) console.log(chalk.dim(p.description));
    console.log(chalk.cyan(`${configs.length} config(s):`));
    for (const c of configs) console.log(`  ${c.slug} ${chalk.dim(`[${c.category}]`)}`);
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

profileCmd.command("add <profile> <config>").description("Add a config to a profile").action(async (profile, config) => {
  try {
    const c = getConfig(config);
    addConfigToProfile(profile, c.id);
    console.log(chalk.green("✓") + ` Added ${c.slug} to profile ${profile}`);
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

profileCmd.command("remove <profile> <config>").description("Remove a config from a profile").action(async (profile, config) => {
  try {
    const c = getConfig(config);
    removeConfigFromProfile(profile, c.id);
    console.log(chalk.green("✓") + ` Removed ${c.slug} from profile ${profile}`);
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

profileCmd.command("apply <id>").description("Apply all configs in a profile to disk")
  .option("--dry-run", "preview without writing")
  .action(async (id, opts) => {
    try {
      const configs = getProfileConfigs(id);
      const results = await applyConfigs(configs, { dryRun: opts.dryRun });
      let changed = 0;
      for (const r of results) {
        const status = opts.dryRun ? chalk.yellow("[dry-run]") : (r.changed ? chalk.green("✓") : chalk.dim("="));
        console.log(`${status} ${r.path}`);
        if (r.changed) changed++;
      }
      console.log(chalk.dim(`\n${changed}/${results.length} changed`));
    } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
  });

profileCmd.command("delete <id>").description("Delete a profile").action(async (id) => {
  try {
    const p = getProfile(id);
    deleteProfile(id);
    console.log(chalk.green("✓") + ` Deleted profile: ${p.name}`);
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

// ── snapshot ──────────────────────────────────────────────────────────────────
const snapshotCmd = program.command("snapshot").description("Manage config version history");

snapshotCmd.command("list <config>").description("List snapshots for a config").action(async (configId) => {
  try {
    const c = getConfig(configId);
    const snaps = listSnapshots(c.id);
    if (snaps.length === 0) { console.log(chalk.dim("No snapshots.")); return; }
    for (const s of snaps) {
      console.log(`  v${s.version} ${chalk.dim(s.created_at)} ${chalk.dim(s.id)}`);
    }
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

snapshotCmd.command("show <id>").description("Show a snapshot's content").action(async (id) => {
  const snap = getSnapshot(id);
  if (!snap) { console.error(chalk.red("Snapshot not found: " + id)); process.exit(1); }
  console.log(snap.content);
});

snapshotCmd.command("restore <config> <snapshot-id>").description("Restore a config to a snapshot version").action(async (configId, snapId) => {
  try {
    const snap = getSnapshot(snapId);
    if (!snap) { console.error(chalk.red("Snapshot not found: " + snapId)); process.exit(1); }
    updateConfig(configId, { content: snap.content });
    console.log(chalk.green("✓") + ` Restored ${configId} to snapshot v${snap.version}`);
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

// ── template ──────────────────────────────────────────────────────────────────
const templateCmd = program.command("template").description("Work with template configs");

templateCmd.command("vars <id>").description("Show template variables").action(async (id) => {
  try {
    const c = getConfig(id);
    const vars = extractTemplateVars(c.content);
    if (vars.length === 0) { console.log(chalk.dim("No template variables found.")); return; }
    for (const v of vars) {
      console.log(`  ${chalk.cyan("{{" + v.name + "}}")}${v.description ? chalk.dim(" — " + v.description) : ""}`);
    }
  } catch (e) { console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

// ── scan ──────────────────────────────────────────────────────────────────────
program
  .command("scan [id]")
  .description("Scan configs for secrets. Defaults to known configs only.")
  .option("--fix", "redact found secrets in-place")
  .option("--all", "scan every config in the DB (slow on large DBs)")
  .option("-c, --category <cat>", "scan only a specific category")
  .action(async (id, opts) => {
    let configs;
    if (id) {
      configs = [getConfig(id)];
    } else if (opts.all) {
      // Scan full DB in batches to avoid OOM
      configs = listConfigs(opts.category ? { kind: "file", category: opts.category as ConfigCategory } : { kind: "file" });
    } else {
      // Default: fetch only the ~30 known configs individually by slug (fast, no full table scan)
      const { KNOWN_CONFIGS } = await import("../lib/sync.js");
      const slugs = [
        ...KNOWN_CONFIGS.filter((k) => !k.rulesDir).map((k) => k.name),
        // rules/*.md slugs follow pattern claude-rules-{filename}-md
      ];
      const fetched = [];
      for (const slug of slugs) {
        try { fetched.push(getConfig(slug)); } catch { /* not in DB yet */ }
      }
      // Also grab rules by category+agent (small set)
      const rules = listConfigs({ category: "rules", agent: "claude" });
      for (const r of rules) if (!fetched.find((c) => c.id === r.id)) fetched.push(r);
      configs = fetched;
    }

    let total = 0;
    const BATCH = 200;
    for (let i = 0; i < configs.length; i += BATCH) {
      const batch = configs.slice(i, i + BATCH);
      for (const c of batch) {
        const fmt = c.format as "shell" | "json" | "toml" | "ini" | "markdown" | "text";
        const secrets = scanSecrets(c.content, fmt);
        if (secrets.length === 0) continue;
        total += secrets.length;
        console.log(chalk.yellow(`⚠ ${c.slug}`) + chalk.dim(` — ${secrets.length} secret(s):`));
        for (const s of secrets) console.log(`  line ${s.line}: ${chalk.red(s.varName)} — ${s.reason}`);
        if (opts.fix) {
          const { content, isTemplate } = redactContent(c.content, fmt);
          updateConfig(c.id, { content, is_template: isTemplate });
          console.log(chalk.green("  ✓ Redacted."));
        }
      }
    }
    if (total === 0) {
      console.log(chalk.green("✓") + ` No secrets detected${opts.all ? "" : " (known configs). Use --all to scan entire DB"}.`);
    } else if (!opts.fix) {
      console.log(chalk.yellow(`\nRun with --fix to redact in-place.`));
    }
  });

program.version(pkg.version).name("configs");
program.parse(process.argv);
