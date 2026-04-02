#!/usr/bin/env bun
// brains CLI entry point

import { Command } from "commander";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { getDb, getRawDb, fineTunedModels, trainingJobs } from "../db/index.js";
import { printTable, printError, printSuccess, printInfo, printJson } from "./ui.js";
import { registerModelsCommands } from "./commands/models.js";
import { registerFinetuneCommands } from "./commands/finetune.js";
import { registerDataCommands } from "./commands/data.js";
import { registerCollectionsCommands } from "./commands/collections.js";
import { registerCloudCommands } from "./commands/cloud.js";
import { getPackageVersion } from "../lib/package-metadata.js";
import { parseRemoveType } from "./remove.js";

const program = new Command();

program
  .name("brains")
  .description("Fine-tuned model tracker and trainer")
  .version(getPackageVersion());

// ── models ────────────────────────────────────────────────────────────────────

registerModelsCommands(program);

// ── finetune ──────────────────────────────────────────────────────────────────

registerFinetuneCommands(program);

// ── data ──────────────────────────────────────────────────────────────────────

registerDataCommands(program);

// ── collections ───────────────────────────────────────────────────────────────

registerCollectionsCommands(program);

// ── remove/uninstall ─────────────────────────────────────────────────────────

program
  .command("remove <id>")
  .alias("rm")
  .alias("uninstall")
  .description("Remove a fine-tuned model or training job by ID")
  .option("--type <type>", "Type: model | job (default: auto-detect)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { type?: string; json?: boolean }) => {
    const db = getDb();
    try {
      const type = parseRemoveType(opts.type);

      if (!type || type === "job") {
        const job = db.select().from(trainingJobs).where(eq(trainingJobs.id, id)).get();
        if (job) {
          db.delete(trainingJobs).where(eq(trainingJobs.id, id)).run();
          if (opts.json) { printJson({ deleted: "job", id }); return; }
          printSuccess(`Training job ${id} removed`);
          return;
        }
        if (type === "job") {
          if (opts.json) { printJson({ error: `Job not found: ${id}` }); }
          else { printError(`Job not found: ${id}`); }
          process.exit(1);
        }
      }

      if (!type || type === "model") {
        const model = db.select().from(fineTunedModels).where(eq(fineTunedModels.id, id)).get();
        if (model) {
          db.delete(fineTunedModels).where(eq(fineTunedModels.id, id)).run();
          if (opts.json) { printJson({ deleted: "model", id }); return; }
          printSuccess(`Model ${id} removed`);
          return;
        }
        if (type === "model") {
          if (opts.json) { printJson({ error: `Model not found: ${id}` }); }
          else { printError(`Model not found: ${id}`); }
          process.exit(1);
        }
      }

      const message = `Not found: ${id}. Use --type model|job to target a specific entity.`;
      if (opts.json) { printJson({ error: message }); }
      else { printError(message); }
      process.exit(1);
    } catch (err) {
      if (opts.json) {
        printJson({ error: err instanceof Error ? err.message : String(err) });
      } else {
        printError(err instanceof Error ? err.message : String(err));
      }
      process.exit(1);
    }
  });

// ── config ────────────────────────────────────────────────────────────────────

import { getConfigValue, setConfigValue, listConfig, deleteConfigValue, CONFIG_KEYS } from "../lib/config.js";
import type { ConfigKey } from "../lib/config.js";

const configCmd = program.command("config").description("Manage API keys and settings");

configCmd
  .command("list")
  .description("Show all config keys and their sources")
  .action(() => {
    const entries = listConfig();
    console.log();
    for (const { key, value, source } of entries) {
      const display = source === "unset"
        ? "(unset)"
        : value.length > 8
          ? value.slice(0, 4) + "****" + value.slice(-4)
          : "****";
      const src = source === "env" ? " [env]" : source === "file" ? " [file]" : "";
      console.log(`  ${key.padEnd(28)} ${display}${src}`);
    }
    console.log();
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    const value = getConfigValue(key as ConfigKey);
    if (!value) {
      printInfo(`${key} is not set.`);
    } else {
      console.log(value);
    }
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value (stored in ~/.hasna/brains/config.json)")
  .action((key: string, value: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    setConfigValue(key as ConfigKey, value);
    printSuccess(`${key} saved to ~/.hasna/brains/config.json`);
  });

configCmd
  .command("unset <key>")
  .description("Remove a config value from the config file")
  .action((key: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    deleteConfigValue(key as ConfigKey);
    printSuccess(`${key} removed from config.`);
  });

// ── feedback ─────────────────────────────────────────────────────────────────

const feedbackCmd = program.command("feedback").description("Feedback commands");

feedbackCmd
  .command("send <message>")
  .description("Send feedback about brains")
  .option("--email <email>", "Contact email")
  .action(async (message: string, opts: { email?: string }) => {
    const { sendFeedback } = await import("@hasna/cloud");
    const rawDb = getRawDb();
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
    const result = await sendFeedback({ service: "brains", message, email: opts.email, version: pkg.version }, rawDb);
    rawDb.close();
    if (result.sent) {
      printSuccess("Feedback sent. Thank you!");
    } else {
      printSuccess("Feedback saved locally. Thank you!");
    }
  });

feedbackCmd
  .command("list")
  .description("List locally saved feedback")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const { listFeedback } = await import("@hasna/cloud");
    const rawDb = getRawDb();
    const entries = listFeedback(rawDb);
    rawDb.close();
    if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }
    if (entries.length === 0) { printInfo("No feedback saved yet."); return; }
    printTable(
      ["ID", "Message", "Email", "Version", "Created"],
      entries.map((e) => [
        ((e as { id?: string }).id ?? "").slice(0, 8),
        (e.message ?? "").slice(0, 60),
        (e as { email?: string }).email ?? "",
        (e as { version?: string }).version ?? "",
        (e as { created_at?: string }).created_at ?? "",
      ])
    );
  });

// ── cloud ─────────────────────────────────────────────────────────────────────

registerCloudCommands(program);

program.parse();
