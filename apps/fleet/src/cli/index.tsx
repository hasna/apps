#!/usr/bin/env bun
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { APP_NAME, resolveDbPath, resolveStorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";
import { defaultAdapters } from "../adapters/index.js";
import { getDatabase } from "../db/database.js";
import { upsertEntity } from "../db/crud.js";
import { FIXTURE_ENTITIES } from "../adapters/fixtures.js";
import { health } from "../server/health.js";
import { localOwnerPrincipal } from "../server/auth.js";
import { REGISTRY, validateInput, type OpContext, type OpDescriptor } from "../services/registry.js";
import { toErrorEnvelope } from "../types/index.js";
import { checkOpenApiDocument, serializeOpenApiDocument } from "../api/index.js";
import { renderDashboard } from "./dashboard.js";

let jsonMode = false;

function emit(value: unknown): void {
  if (jsonMode) console.log(JSON.stringify(value, null, 2));
  else console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function fail(error: unknown): never {
  const env = toErrorEnvelope(error);
  console.log(JSON.stringify(env));
  process.exit(1);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function runOp(op: OpDescriptor, positionals: Record<string, string>, options: Record<string, unknown>): void {
  const raw: Record<string, unknown> = { ...positionals };
  for (const key of Object.keys(op.inputShape)) {
    if (key in raw) continue;
    const camel = snakeToCamel(key);
    if (options[camel] !== undefined) raw[key] = options[camel];
  }
  try {
    const input = validateInput(op, raw);
    const ctx: OpContext = { db: getDatabase(), principal: localOwnerPrincipal(), adapters: defaultAdapters() };
    emit(op.run(ctx, input));
  } catch (error) {
    fail(error);
  }
}

function build(): Command {
  const program = new Command();
  program
    .name(APP_NAME)
    .description("Read-only AgentOps control tower: SLOs, error budgets, traces, token/cost burn over fused observability.")
    .version(APP_VERSION)
    .option("--json", "Emit machine-readable JSON")
    .hook("preAction", (thisCommand) => {
      jsonMode = Boolean(thisCommand.opts()["json"]);
    });

  // Registry-generated command namespaces (CLI/MCP/API parity).
  const namespaces = new Map<string, Command>();
  for (const op of REGISTRY) {
    let ns = namespaces.get(op.cli.namespace);
    if (!ns) {
      ns = program.command(op.cli.namespace).description(`${op.cli.namespace} operations`);
      namespaces.set(op.cli.namespace, ns);
    }
    const cmd = ns.command(op.cli.command).description(op.summary);
    const positional = op.cli.positional ?? [];
    for (const p of positional) cmd.argument(`<${p}>`);
    for (const key of Object.keys(op.inputShape)) {
      if (positional.includes(key)) continue;
      cmd.option(`--${key.replace(/_/g, "-")} <value>`, key);
    }
    cmd.action((...args: unknown[]) => {
      const command = args[args.length - 1] as Command;
      const options = args[args.length - 2] as Record<string, unknown>;
      const posValues = args.slice(0, args.length - 2) as string[];
      const positionals: Record<string, string> = {};
      positional.forEach((name, i) => {
        positionals[name] = posValues[i]!;
      });
      void command;
      runOp(op, positionals, options);
    });
  }

  program
    .command("doctor")
    .description("Show storage mode, database path, and health")
    .action(() => {
      emit({ app: APP_NAME, mode: safeMode(), dbPath: resolveDbPath(), health: health() });
    });

  program
    .command("seed-fixtures")
    .description("Seed the local entities cache with the fixture entities (for offline slug resolution)")
    .action(() => {
      const db = getDatabase();
      for (const e of FIXTURE_ENTITIES) upsertEntity(db, e.id, e.slug, e.name);
      emit({ seeded: FIXTURE_ENTITIES.length, entities: FIXTURE_ENTITIES });
    });

  program
    .command("dashboard")
    .description("Render an Ink TUI health dashboard for an entity")
    .requiredOption("--entity-id <id>", "Entity id (UUID)")
    .option("--window-days <n>", "Window in days", "30")
    .action(async (opts: { entityId: string; windowDays: string }) => {
      const ctx: OpContext = { db: getDatabase(), principal: localOwnerPrincipal(), adapters: defaultAdapters() };
      await renderDashboard(ctx, opts.entityId, Number.parseInt(opts.windowDays, 10) || 30);
    });

  const openapi = program.command("openapi").description("OpenAPI document tooling");
  openapi
    .command("generate")
    .option("--out <path>", "Output path", "openapi.json")
    .action((opts: { out: string }) => {
      writeFileSync(opts.out, serializeOpenApiDocument());
      emit({ ok: true, out: opts.out });
    });
  openapi
    .command("check")
    .option("--path <path>", "Path to openapi.json", "openapi.json")
    .action((opts: { path: string }) => {
      const result = checkOpenApiDocument(opts.path);
      if (!result.valid) fail(new Error(result.error ?? "openapi check failed"));
      emit(result);
    });

  return program;
}

function safeMode(): "local" | "cloud" {
  try {
    return resolveStorageMode();
  } catch {
    return "cloud";
  }
}

async function main(): Promise<void> {
  await build().parseAsync(process.argv);
}

if (import.meta.main) {
  main().catch((error: unknown) => fail(error));
}

export { build };
