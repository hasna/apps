#!/usr/bin/env bun
// projects-serve — HTTP API for @hasna/projects.
//
// Reads and writes go directly to PostgreSQL via the vendored storage kit.
// Two entrypoints:
//   projects-serve            start the HTTP server
//   projects-serve migrate    apply pending migrations then exit (ECS one-shot)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiKeyStore } from "@hasna/contracts/auth";
import { resolveClientTransport } from "@hasna/contracts/client";
import { unconfiguredForHostedUse } from "../lib/client-configuration.js";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { ProjectsPgStore } from "./pg-store.js";
import { createFetchHandler } from "./app.js";
import { runProjectsMigrations } from "./migrations.js";
import {
  createContactsProjectMembershipAuthorityFromEnv,
  type ContactsHttpProjectMembershipAuthority,
} from "../lib/contacts-authority-adapter.js";
import {
  createProductionProjectResourceLinkProducerEvidenceVerifier,
} from "../lib/project-resource-link-producer-verifier.js";
import {
  productionProjectRegistrationAuthorities,
  type ProductionProjectRegistrationAuthorityOptions,
} from "../lib/production-project-registration-authorities.js";

const APP = "projects";

export function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Classify early-exit arguments before any environment-bound work (database
 * URL, signing secret) runs. --help and --version must answer with no
 * configured database URL (binds-before-args class, O15-00084).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help")) return "help";
  if (argv.includes("--version")) return "version";
  return "start";
}

export function printHelp(): void {
  console.log(`usage: projects-serve [migrate] [--port <n>]

projects-serve — HTTP API for @hasna/projects.

commands:
  migrate [--dry-run]   apply pending migrations, then exit
  (no command)          start the HTTP server

options:
  --help                show this help and exit
  --version             print the package version and exit
  --port <n>            listen port (default: 8080, or $PORT)
`);
}

/** Resolve the PostgreSQL connection string from the fleet-standard envs. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url =
    env.HASNA_PROJECTS_DATABASE_URL ||
    env.PROJECTS_DATABASE_URL ||
    env.DATABASE_URL ||
    "";
  if (!url.trim()) {
    throw new Error(
      "projects-serve: no database URL. Set HASNA_PROJECTS_DATABASE_URL (or PROJECTS_DATABASE_URL / DATABASE_URL).",
    );
  }
  return url.trim();
}

/** Resolve the HMAC signing secret for API-key verification. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_PROJECTS_API_SIGNING_KEY ||
    env.HASNA_API_SIGNING_KEY ||
    env.API_KEY_SIGNING_SECRET ||
    "";
  if (!secret.trim()) {
    throw new Error(
      "projects-serve: no API signing secret. Set HASNA_PROJECTS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  return secret.trim();
}

export function resolvePort(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && argv[idx + 1]) return Number(argv[idx + 1]);
  if (env.PORT) return Number(env.PORT);
  return 8080;
}

export function resolveContactsAuthority(
  env: NodeJS.ProcessEnv = process.env,
): ContactsHttpProjectMembershipAuthority | undefined {
  // Any Contacts declaration at all warrants the authority — a URL, a key from
  // any of the five tiers, the Keychain item, the credentials file. A
  // COMPLETELY silent environment gets none: this server simply does not offer
  // the contact-membership surface then. Everything in between (a URL with no
  // resolvable key, an unreadable Keychain item, a world-readable credentials
  // file) is a LOUD failure, so the seam's error propagates unchanged.
  try {
    resolveClientTransport("contacts", env);
  } catch (error) {
    if (unconfiguredForHostedUse("contacts", env)) return undefined;
    throw error;
  }
  return createContactsProjectMembershipAuthorityFromEnv(env);
}

export interface CreateProjectsPgStoreOptions {
  producerAuthorityOptions?: ProductionProjectRegistrationAuthorityOptions;
  producerVerifierNow?: () => string;
}

export function createProjectsPgStore(
  client: TypedQueryClient,
  options: CreateProjectsPgStoreOptions = {},
): ProjectsPgStore {
  return new ProjectsPgStore(
    client,
    createProductionProjectResourceLinkProducerEvidenceVerifier({
      authorities: productionProjectRegistrationAuthorities(
        options.producerAuthorityOptions,
      ),
      now: options.producerVerifierNow,
    }),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const version = getPackageVersion();
  const early = handleEarlyArgs(argv);
  if (early === "help") {
    printHelp();
    return;
  }
  if (early === "version") {
    console.log(version);
    return;
  }
  const connectionString = resolveDatabaseUrl();
  const pool = createPgPool({ connectionString, applicationName: `${APP}-serve`, max: 5 });
  const client = createQueryClient(pool);

  // --- migrate subcommand (ECS one-shot task) ---
  if (argv[0] === "migrate") {
    const dryRun = argv.includes("--dry-run");
    const result = await runProjectsMigrations(client, { dryRun });
    const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    console.error(
      `projects-serve migrate: ${dryRun ? "DRY RUN — " : ""}${result.applied.length} applied total, ` +
        `${pending.length} ${dryRun ? "pending" : "newly applied"}${pending.length ? `: ${pending.join(", ")}` : ""}`,
    );
    await pool.end();
    return;
  }

  // --- server ---
  const signingSecret = resolveSigningSecret();
  const keyStore = new ApiKeyStore(client);
  const store = createProjectsPgStore(client);
  const contacts = resolveContactsAuthority();
  const port = resolvePort(argv);
  const hostname = process.env.HOST || "0.0.0.0";

  const handler = createFetchHandler({
    store,
    contacts,
    version,
    app: APP,
    signingSecret,
    keyStatus: keyStore.keyStatus,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.error(`api_auth deny kid=${e.kid ?? "-"} reason=${e.reason ?? "-"} ${e.method} ${e.path}`);
      }
    },
  });

  Bun.serve({ hostname, port, fetch: handler, idleTimeout: 60 });
  console.error(`projects-serve v${version} listening on http://${hostname}:${port}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("projects-serve fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
