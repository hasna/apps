#!/usr/bin/env bun
import { Command } from "commander";
import { APP_NAME, resolveDbPath, resolveStorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";
import { registerOpCommands } from "./namespaces.js";
import { buildCliContext } from "./context.js";
import { storageStatus } from "../services/storage.js";
import { getCurrentMigrationPlan } from "../db/migration-plan.js";
import { openApiDocument } from "../api/index.js";
import { normalizeError } from "../core/errors.js";

const program = new Command();
let jsonMode = false;

function emit(value: unknown): void {
  console.log(jsonMode ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

program
  .name(APP_NAME)
  .description("Multi-entity cash/treasury cockpit: balances, FX exposure, runway, forecast, advisory sweeps.")
  .version(APP_VERSION)
  .option("--json", "Emit machine-readable JSON")
  .hook("preAction", () => {
    jsonMode = Boolean(program.opts().json);
  });

registerOpCommands(program, { json: () => jsonMode });

program
  .command("doctor")
  .description("Show storage mode, DB path, migration plan, and redacted storage status")
  .action(async () => {
    try {
      const rc = await buildCliContext();
      emit({
        app: APP_NAME,
        version: APP_VERSION,
        mode: resolveStorageMode(),
        db_path: resolveDbPath(),
        migration_plan: getCurrentMigrationPlan(),
        storage_status: await storageStatus(rc),
      });
    } catch (error) {
      emit(normalizeError(error));
      process.exitCode = 1;
    }
  });

const openapi = program.command("openapi").description("OpenAPI document operations");
openapi
  .command("generate")
  .description("Write the OpenAPI document to a file")
  .option("--out <path>", "Output path", "openapi.json")
  .action(async (opts: { out: string }) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.out, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
    emit({ ok: true, out: opts.out });
  });
openapi
  .command("check")
  .description("Verify the checked-in OpenAPI document matches the generated one")
  .option("--path <path>", "Path to compare", "openapi.json")
  .action(async (opts: { path: string }) => {
    const { readFileSync } = await import("node:fs");
    const onDisk = JSON.stringify(JSON.parse(readFileSync(opts.path, "utf8")));
    const current = JSON.stringify(openApiDocument());
    if (onDisk !== current) {
      emit({ ok: false, message: "openapi.json is stale; run `treasury openapi generate`." });
      process.exitCode = 1;
      return;
    }
    emit({ ok: true });
  });

program
  .command("dashboard")
  .description("Render an Ink cockpit summary (group runway) — interactive")
  .option("--base <currency>", "Reporting base currency", "USD")
  .action(async (opts: { base: string }) => {
    const rc = await buildCliContext();
    const { groupRunway } = await import("../services/runway.js");
    const report = await groupRunway(rc, { base: opts.base });
    if (jsonMode || !process.stdout.isTTY) {
      emit(report);
      return;
    }
    const { render } = await import("ink");
    const { renderDashboard } = await import("./dashboard.js");
    const { waitUntilExit } = render(renderDashboard(report));
    await waitUntilExit();
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
