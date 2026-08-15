import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACCOUNTS_CAPACITY_OPENAPI,
  AccountsError,
  PACKAGE_VERSION,
  type Account,
  type EntityKind,
  type EntityMap,
} from "../src/index";
import { createAccountsHttpHandler } from "../src/http/handler";
import type { CatalogHttpService } from "../src/http/types";
import { ACTOR_REF, makeFixtureGraph } from "./fixtures";

/** Stands in for the Secrets-managed reference the deployment configures. */
export const AUTH_REFERENCE = "capacity-client-reference";
/** Stands in for the audienced client credential a Secrets resolver returns. */
export const RESOLVED_CREDENTIAL = "resolved.capacity.client.credential";
export const CONTRACT_SHA256 = "0".repeat(64);

export interface SelfHostedCapacityServer {
  readonly baseUrl: string;
  /** Certificate authority file a spawned CLI trusts through NODE_EXTRA_CA_CERTS. */
  readonly caPath: string;
  readonly account: Account;
  /** Every authorization header the server observed, in arrival order. */
  readonly presented: readonly string[];
  stop(): void;
}

/**
 * Serves this repository's own HTTP handler over real TLS so a spawned CLI
 * process — the only entry point an installed consumer has — can be driven end
 * to end. The authenticator accepts nothing but the resolved client credential,
 * so an unauthenticated or reference-presenting CLI cannot pass.
 */
export function startSelfHostedCapacityServer(directory: string): SelfHostedCapacityServer {
  const { caPath, keyPath } = generateLoopbackCertificate(directory);
  const graph = makeFixtureGraph("api_key", 11);
  const records = new Map<EntityKind, readonly EntityMap[EntityKind][]>([
    ["account", [graph.activeAccount]],
    ["entitlement", []],
    ["capacity_pool", []],
    ["access_method", []],
    ["auth_capsule", []],
    ["credential_binding", []],
  ]);
  const catalog: CatalogHttpService = {
    get: async <K extends EntityKind>(kind: K, id: EntityMap[K]["id"]) => {
      const record = records.get(kind)!.find((candidate) => candidate.id === id);
      if (record === undefined) throw new AccountsError("NOT_FOUND", "The requested record was not found");
      return record as EntityMap[K];
    },
    list: async <K extends EntityKind>(kind: K) => records.get(kind)! as readonly EntityMap[K][],
    eligibility: async () => {
      throw new AccountsError("NOT_IMPLEMENTED", "not used");
    },
    doctor: async () => ({
      adapter: "memory",
      schemaVersion: "accounts.schema.v1",
      migrationChecksum: CONTRACT_SHA256,
      foreignKeys: "not_applicable",
      journalMode: "memory",
      integrity: "ok",
      readiness: "ready",
      recoveryFrontier: "unavailable",
      recoveryHold: false,
      positiveEligibility: true,
    }),
  };
  const presented: string[] = [];
  const handler = createAccountsHttpHandler({
    deployment: {
      mode: "self_hosted",
      identityRealm: "hasna",
      organizationRef: "organization:hasna",
      publicAudience: "accounts-capacity-public",
      internalAudience: "accounts-capacity-internal",
      allowedIssuers: new Set(["authority:identities"]),
    },
    authenticator: {
      authenticate: async (request, expectedAudience) => {
        const authorization = request.headers.get("authorization");
        if (authorization !== null) presented.push(authorization);
        if (authorization !== `Bearer ${RESOLVED_CREDENTIAL}`) return undefined;
        return {
          actorRef: ACTOR_REF,
          subjectRef: ACTOR_REF,
          issuer: "authority:identities",
          audience: expectedAudience,
          scopes: new Set(["accounts:read"] as const),
          authorizedOwnerRefs: new Set([ACTOR_REF]),
        };
      },
    },
    catalog,
    packageVersion: PACKAGE_VERSION,
    contractSha256: CONTRACT_SHA256,
    openApiDocument: ACCOUNTS_CAPACITY_OPENAPI,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert: Bun.file(caPath), key: Bun.file(keyPath) },
    fetch: (request) => handler(request),
  });
  return {
    baseUrl: `https://127.0.0.1:${server.port}`,
    caPath,
    account: graph.activeAccount,
    presented,
    stop: () => {
      server.stop(true);
    },
  };
}

/**
 * Writes the deployment-owned resolver module the CLI loads through
 * HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE, owner-only so the CLI's own module
 * permission check accepts it.
 */
export function writeCredentialResolverModule(
  directory: string,
  body = `export async function resolve() {\n  return ${JSON.stringify(RESOLVED_CREDENTIAL)};\n}\n`,
  mode = 0o600,
): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "capacity-credential-resolver.mjs");
  writeFileSync(path, body, { mode });
  chmodSync(path, mode);
  return path;
}

function generateLoopbackCertificate(directory: string): { caPath: string; keyPath: string } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const openssl = Bun.which("openssl");
  if (openssl === null) throw new Error("openssl is required for the self-hosted CLI end-to-end tests");
  const caPath = join(directory, "loopback-cert.pem");
  const keyPath = join(directory, "loopback-key.pem");
  const generated = Bun.spawnSync([
    openssl,
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    keyPath,
    "-out",
    caPath,
  ]);
  if (generated.exitCode !== 0) {
    throw new Error(`loopback certificate generation failed (${generated.exitCode})`);
  }
  chmodSync(keyPath, 0o600);
  return { caPath, keyPath };
}
