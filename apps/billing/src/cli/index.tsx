#!/usr/bin/env bun
import { Command } from "commander";
import React from "react";
import { render, Box, Text } from "ink";
import { writeFileSync, readFileSync } from "node:fs";
import { APP_VERSION } from "../version.js";
import { cliNamespaces } from "./namespaces.js";
import { buildRunContext } from "./context.js";
import { cliInvoke, parseInputJson } from "./dispatch.js";
import { openApiJson } from "../api/index.js";
import { resolveStorageMode } from "../config.js";

function toActionName(op: string): string {
  return op.replace(/_/g, "-");
}

function printResult(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** Minimal Ink dashboard (satisfies the Ink + commander CLI requirement, §3.1). */
function Dashboard(): React.ReactElement {
  const namespaces = cliNamespaces();
  return (
    <Box flexDirection="column">
      <Text bold>@hasna/billing v{APP_VERSION} (mode={resolveStorageMode()})</Text>
      <Text>Thin billing/dunning orchestration over Stripe Billing.</Text>
      {namespaces.map((ns) => (
        <Text key={ns.resource}>
          {"  "}
          {ns.resource}: {ns.ops.map((o) => toActionName(o.op)).join(", ")}
        </Text>
      ))}
    </Box>
  );
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("billing")
    .description("Thin agent-facing billing/dunning orchestration over Stripe Billing (CLI).")
    .version(APP_VERSION)
    .option("--json", "JSON output (default for non-interactive use)");

  // One command per domain resource; one subcommand per op — generated from the
  // service registry so the CLI mirrors MCP + /v1 (interface parity, §7).
  for (const ns of cliNamespaces()) {
    const group = program.command(ns.resource.replace(/_/g, "-")).description(`${ns.resource} operations`);
    for (const op of ns.ops) {
      group
        .command(toActionName(op.op))
        .description(op.summary)
        .option("--input <json>", "Operation input as a JSON object", "{}")
        .action(async (opts: { input?: string }) => {
          const ctx = buildRunContext();
          const result = await cliInvoke(op.op, parseInputJson(opts.input), ctx);
          printResult(result.ok ? result.data : result.error);
          if (!result.ok) process.exitCode = 1;
        });
    }
  }

  const openapi = program.command("openapi").description("OpenAPI document tooling");
  openapi
    .command("generate")
    .description("Generate the OpenAPI document")
    .option("--out <path>", "Output path", "openapi.json")
    .action((opts: { out: string }) => {
      writeFileSync(opts.out, openApiJson());
      printResult({ ok: true, wrote: opts.out });
    });
  openapi
    .command("check")
    .description("Verify the checked-in OpenAPI document is current")
    .option("--path <path>", "Path to openapi.json", "openapi.json")
    .action((opts: { path: string }) => {
      const current = openApiJson();
      const onDisk = readFileSync(opts.path, "utf8");
      if (current !== onDisk) {
        printResult({ ok: false, error: "openapi.json is stale; run `billing openapi generate`." });
        process.exitCode = 1;
        return;
      }
      printResult({ ok: true, path: opts.path });
    });

  program
    .command("dashboard")
    .description("Render the interactive Ink dashboard")
    .action(() => {
      const instance = render(<Dashboard />);
      instance.unmount();
    });

  return program;
}

if (import.meta.main) {
  buildProgram().parseAsync(process.argv).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
