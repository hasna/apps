#!/usr/bin/env bun
import { listProviders } from "../index.ts";

const VERSION = "0.0.1";

function printHelp(): void {
  console.log(`banking ${VERSION}

Usage:
  banking --help
  banking --version
  banking providers list [--json]
  banking accounts list [--json]
  banking payments quote --help
  banking payments request --help
  banking cards request --help

This scaffold is request-oriented. Live money movement and card mutation are not implemented.`);
}

function emit(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(String(value));
}

export function runCli(argv: readonly string[] = Bun.argv.slice(2)): number {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    emit(VERSION, json);
    return 0;
  }

  if (args[0] === "providers" && args[1] === "list") {
    const providers = listProviders();
    if (json) {
      emit({ providers }, true);
      return 0;
    }
    for (const provider of providers) {
      console.log(`${provider.id}\t${provider.role}\t${provider.displayName}`);
    }
    return 0;
  }

  if (args[0] === "accounts" && args[1] === "list") {
    emit(
      {
        status: "not_implemented",
        message: "Provider adapters are not implemented in this scaffold yet.",
      },
      json,
    );
    return 0;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  return 1;
}

if (import.meta.main) {
  process.exit(runCli());
}
