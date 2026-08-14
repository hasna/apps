#!/usr/bin/env bun
import { Command } from "commander";
import React from "react";
import { Box, render, Text } from "ink";
import { writeFileSync, readFileSync } from "node:fs";
import { APP_VERSION } from "../version.js";
import { openApiDocument, openApiDocumentJson } from "../api/index.js";
import { OP_REGISTRY } from "../services/registry.js";
import { registerNamespaces } from "./namespaces.js";

function Banner(): React.ReactElement {
  const namespaces = Array.from(new Set(OP_REGISTRY.map((op) => op.cli[0])));
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color="cyan" bold>
        holdings v{APP_VERSION}
      </Text>
      <Text color="gray">IP portfolio: trademarks, patents, copyrights, brand assets — registrations, renewals, Nice classes, filing docs.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Namespaces:</Text>
        {namespaces.map((ns) => (
          <Text key={ns}> holdings {ns} &lt;command&gt; [--json]</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Run `holdings &lt;namespace&gt; --help` for commands. Use --json for machine output.</Text>
      </Box>
    </Box>
  );
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("holdings")
    .description("IP portfolio system-of-record (CLI + MCP + serve).")
    .version(APP_VERSION, "-V, --version")
    .option("--json", "emit machine-readable JSON output", false);

  registerNamespaces(program, () => Boolean(program.opts().json));

  const openapi = program.command("openapi").description("OpenAPI document operations");
  openapi
    .command("generate")
    .description("Write the OpenAPI document to a file")
    .option("--out <path>", "output path", "openapi.json")
    .action((opts: { out: string }) => {
      writeFileSync(opts.out, `${openApiDocumentJson()}\n`);
      if (program.opts().json) process.stdout.write(`${JSON.stringify({ ok: true, out: opts.out, paths: Object.keys(openApiDocument.paths).length })}\n`);
      else process.stdout.write(`Wrote ${opts.out} (${Object.keys(openApiDocument.paths).length} paths)\n`);
    });
  openapi
    .command("check")
    .description("Verify the checked-in OpenAPI document is current")
    .option("--path <path>", "path to openapi.json", "openapi.json")
    .action((opts: { path: string }) => {
      const onDisk = readFileSync(opts.path, "utf8").trim();
      const current = openApiDocumentJson().trim();
      if (onDisk !== current) {
        process.stderr.write(`OpenAPI document at ${opts.path} is out of date. Run: holdings openapi generate --out ${opts.path}\n`);
        process.exit(1);
      }
      process.stdout.write(`${opts.path} is current.\n`);
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  const argv = process.argv.slice(2);
  const hasCommand = argv.some((a) => !a.startsWith("-"));
  if (!hasCommand && !argv.includes("-V") && !argv.includes("--version") && !argv.includes("-h") && !argv.includes("--help")) {
    render(<Banner />);
    return;
  }
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
