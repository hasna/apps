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

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
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
