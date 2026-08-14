#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import React from "react";
import { Box, render, Text } from "ink";
import { APP_NAME, resolveDbPath, resolveStorageMode } from "../config.js";
import { checkOpenApiDocument, serializeOpenApiDocument, summarizeOpenApiDocument } from "../api/index.js";
import { healthPayload, readyPayload } from "../server/health.js";
import { APP_VERSION } from "../version.js";
import { registerNamespaces } from "./namespaces.js";

let jsonMode = false;

function emit(value: unknown): void {
  console.log(jsonMode ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

function Welcome(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="green">@hasna/consolidations v{APP_VERSION}</Text>
      <Text>Group financial consolidation — GL import, COA normalization, FX translation, eliminations, statements.</Text>
      <Text dimColor>Run `consolidations --help` to list commands, or add --json for machine output.</Text>
    </Box>
  );
}

const program = new Command();
program
  .name(APP_NAME)
  .description("Group financial consolidation CLI (local SQLite / cloud Postgres).")
  .version(APP_VERSION)
  .option("--json", "Emit machine-readable JSON")
  .hook("preAction", (thisCommand) => {
    jsonMode = Boolean(thisCommand.opts().json);
  });

registerNamespaces(program, emit);

const openapi = program.command("openapi").description("OpenAPI document tooling");
openapi
  .command("generate")
  .option("--out <path>", "Output path", "openapi.json")
  .option("--minify", "Minify (ignored; output is stable pretty JSON)")
  .description("Generate the OpenAPI document")
  .action((opts: { out: string }) => {
    const doc = serializeOpenApiDocument();
    writeFileSync(opts.out, doc + "\n");
    emit({ written: opts.out, ...summarizeOpenApiDocument() });
  });
openapi
  .command("check")
  .option("--path <path>", "Path to openapi.json", "openapi.json")
  .description("Verify the committed OpenAPI document is current")
  .action((opts: { path: string }) => {
    const result = checkOpenApiDocument(opts.path);
    emit(result);
    if (!result.valid) process.exitCode = 1;
  });

program
  .command("doctor")
  .description("Show storage mode, database path, and health/readiness")
  .action(async () => {
    emit({
      app: APP_NAME,
      mode: resolveStorageMode(),
      db_path: resolveStorageMode() === "local" ? resolveDbPath() : null,
      health: healthPayload(),
      ready: await readyPayload(),
    });
  });

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--json");
  if (argv.length === 0 && !jsonModeFromArgv()) {
    const instance = render(<Welcome />);
    instance.unmount();
    return;
  }
  await program.parseAsync(process.argv);
}

function jsonModeFromArgv(): boolean {
  return process.argv.includes("--json");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
