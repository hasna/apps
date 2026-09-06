#!/usr/bin/env bun
/** Immutable, pure-remote production entrypoint used by the self-hosted image. */
import { getPackageVersion } from "../lib/package-version.js";
import {
  closeCloud,
  ensureCloudSchema,
  pingCloud,
  resolveCloudDatabaseUrl,
} from "./cloud.js";
import { startCloudServer } from "./cloud-serve.js";

const DEFAULT_PORT = 19428;
const DEFAULT_HOST = "127.0.0.1";

function optionValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function resolvePort(): number {
  const raw = optionValue("--port") ?? process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

function resolveHost(): string {
  return optionValue("--host") ?? process.env.CONTACTS_HOST ?? DEFAULT_HOST;
}

async function runMigrate(): Promise<void> {
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_CONTACTS_DATABASE_URL / CONTACTS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (contacts relational schema + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
}

/**
 * Classify early-exit arguments before any bind or database connection.
 * `--help` / `--version` answer with rc=0 and the server never starts:
 * previously `contacts-serve --help` fell through to `startCloudServer` and
 * bound the port (hasna/apps#1720 validation, the binds-before-help class).
 */
function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

function usage(): string {
  return `usage: contacts-serve [--port <n>] [--host <h>]   Start the authenticated /v1 HTTP API over PostgreSQL
       contacts-serve migrate                     Apply the PostgreSQL schema and exit
       contacts-serve --version                   Print the version

options:
  --port <n>          listen port (default ${DEFAULT_PORT}; PORT)
  --host <h>          bind host (default ${DEFAULT_HOST}; CONTACTS_HOST)
  --help, -h          show this help and exit
  --version, -V       print the package version and exit
`;
}

async function main(): Promise<void> {
  const early = handleEarlyArgs(process.argv.slice(2));
  if (early === "help") {
    console.log(usage());
    return;
  }
  if (early === "version") {
    console.log(getPackageVersion());
    return;
  }
  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  startCloudServer(resolvePort(), resolveHost());
}

await main();
