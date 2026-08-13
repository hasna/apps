#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { APP_VERSION } from "../version.js";
import { registerNamespaces } from "./namespaces.js";
import { emit, fail } from "./context.js";
import { checkOpenApiDocument, serializeOpenApiDocument } from "../api/index.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .name("access")
    .description("Non-human-identity governance: identities, credentials, MCP scopes, JIT elevation, access reviews, revocation, and MCP bearer-token issuance.")
    .version(APP_VERSION)
    .option("--json", "Output machine-readable JSON");

  registerNamespaces(program);

  const openapi = new Command("openapi").description("OpenAPI document tooling");
  openapi
    .command("generate")
    .description("Generate openapi.json")
    .option("--out <path>", "Output path", "openapi.json")
    .option("--json", "Output JSON")
    .action((opts: { out: string }) => {
      const doc = serializeOpenApiDocument();
      writeFileSync(opts.out, doc);
      emit({ ok: true, path: opts.out, bytes: doc.length });
    });
  openapi
    .command("check")
    .description("Verify openapi.json is current")
    .option("--path <path>", "Path to check", "openapi.json")
    .option("--json", "Output JSON")
    .action((opts: { path: string }) => {
      const result = checkOpenApiDocument(opts.path);
      if (!result.valid) fail(new Error(result.reason ?? "openapi.json invalid"));
      emit(result);
    });
  program.addCommand(openapi);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  fail(error);
});
