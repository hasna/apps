import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ACCOUNTS_CAPACITY_OPENAPI,
  AccountsError,
  NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
  PACKAGE_VERSION,
  canonicalJson,
  createSQLiteAccounts,
  newAccessMethodId,
  newCredentialBindingId,
  newEligibilityEvidenceId,
  parseCounter,
  serializeRecordEnvelope,
  type Account,
  type EntityKind,
  type EntityMap,
} from "../../src/index";
import { runAccountsCli, type AccountsCliOptions } from "../../src/cli";
import { AccountsCatalog } from "../../src/domain/catalog";
import { createAccountsHttpHandler } from "../../src/http/handler";
import type { CatalogHttpService } from "../../src/http/types";
import { SQLiteAccountsRepository } from "../../src/storage/sqlite";
import {
  ACTOR_REF,
  CATALOG_INCARNATION,
  CREATED_AT,
  FUTURE,
  NOW,
  TEST_AUTHORITY_POLICY,
  TEST_CREDENTIAL_USE_AUTHORIZER,
  TEST_CREDENTIAL_VERIFIER,
  clock,
  digest,
  makeFixtureGraph,
  makeTestRecoveryLedger,
  seedActiveCatalog,
} from "../fixtures";
import {
  AUTH_REFERENCE,
  CONTRACT_SHA256,
  RESOLVED_CREDENTIAL,
  startSelfHostedCapacityServer,
  writeCredentialResolverModule,
  type SelfHostedCapacityServer,
} from "../self-hosted-server";

const TEST_CLI_OPTIONS: AccountsCliOptions = {
  credentialResolver: { resolve: async () => RESOLVED_CREDENTIAL },
};

const TEMP_ROOT = mkdtempSync(join(tmpdir(), "capacity-cli-tests-"));
chmodSync(TEMP_ROOT, 0o700);
const cleanup: string[] = [];
const ORIGINAL_FETCH = globalThis.fetch;
const CLI_ENV_KEYS = [
  "HASNA_ACCOUNTS_DEPLOYMENT",
  "HASNA_ACCOUNTS_DATABASE_PATH",
  "HASNA_ACCOUNTS_CAPACITY_API_URL",
  "HASNA_ACCOUNTS_CAPACITY_AUTH_REF",
  "HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE",
] as const;

afterAll(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restore();
});

async function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "..", "..", "src", "cli.ts"), ...args], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      PATH: Bun.env.PATH,
      HOME: Bun.env.HOME,
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function localEnvironment(): Record<string, string> {
  const directory = mkdtempSync(join(TEMP_ROOT, "database-"));
  cleanup.push(directory);
  return {
    HASNA_ACCOUNTS_DEPLOYMENT: "local",
    HASNA_ACCOUNTS_DATABASE_PATH: join(directory, "accounts.db"),
  };
}

function selfHostedEnvironment(): Record<string, string> {
  return {
    HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    HASNA_ACCOUNTS_CAPACITY_API_URL: "https://accounts.capacity.test",
    HASNA_ACCOUNTS_CAPACITY_AUTH_REF: AUTH_REFERENCE,
  };
}

async function runCliInProcess(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  options: AccountsCliOptions = TEST_CLI_OPTIONS,
) {
  let stdout = "";
  let stderr = "";
  const oldEnvironment = Object.fromEntries(
    CLI_ENV_KEYS.map((key) => [key, Bun.env[key]] as const),
  ) as Record<(typeof CLI_ENV_KEYS)[number], string | undefined>;
  const oldStdoutWrite = Bun.stdout.write;
  const oldStderrWrite = Bun.stderr.write;
  const capture = (append: (text: string) => void) =>
    ((chunk) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
            : String(chunk);
      append(text);
      return Promise.resolve(Buffer.byteLength(text));
    }) as typeof Bun.stdout.write;

  try {
    for (const key of CLI_ENV_KEYS) {
      const value = environment[key];
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
    Bun.stdout.write = capture((text) => {
      stdout += text;
    });
    Bun.stderr.write = capture((text) => {
      stderr += text;
    });
    const exitCode = await runAccountsCli(args, options);
    return { stdout, stderr, exitCode };
  } finally {
    for (const key of CLI_ENV_KEYS) {
      const value = oldEnvironment[key];
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
    Bun.stdout.write = oldStdoutWrite;
    Bun.stderr.write = oldStderrWrite;
  }
}

function installSelfHostedFetchMock() {
  const graph = makeFixtureGraph("native_session");
  const safeAccount = { ...graph.account } as Record<string, unknown>;
  delete safeAccount.providerSubjectRef;
  delete safeAccount.providerSubjectCandidateRef;
  safeAccount.providerSubjectRefRedacted = true;
  const recordsByPath = new Map<string, readonly [string, readonly unknown[]]>([
    ["/v1/provider-accounts", ["account", [safeAccount]]],
    ["/v1/entitlements", ["entitlement", [graph.entitlement]]],
    ["/v1/capacity-pools", ["capacity_pool", [graph.pool]]],
    ["/v1/account-lanes", ["access_method", [graph.method]]],
    ["/v1/auth-capsules", ["auth_capsule", graph.capsule === undefined ? [] : [graph.capsule]]],
    ["/v1/credential-bindings", ["credential_binding", [graph.binding]]],
  ]);
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    expect(url.origin).toBe("https://accounts.capacity.test");
    expect(request.headers.get("authorization")).toBe(`Bearer ${RESOLVED_CREDENTIAL}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ schemaVersion: "accounts.health.v1", status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      return jsonResponse({ schemaVersion: "accounts.readiness.v1", status: "ready" });
    }
    if (request.method === "GET" && url.pathname === "/version") {
      return jsonResponse({
        schemaVersion: "accounts.version.v1",
        version: PACKAGE_VERSION,
        contractSha256: "0".repeat(64),
      });
    }
    const listed = recordsByPath.get(url.pathname);
    if (request.method === "GET" && listed !== undefined) {
      const [kind, records] = listed;
      return jsonResponse({
        schemaVersion: "accounts.list.v1",
        kind,
        records,
        nextCursor: null,
        route: url.pathname,
      });
    }
    if (request.method === "GET" && url.pathname === `/v1/provider-accounts/${graph.account.id}`) {
      return jsonResponse({ schemaVersion: "accounts.record.v1", kind: "account", data: safeAccount });
    }
    if (request.method === "POST" && url.pathname === "/v1/capacity/query") {
      const body = await request.json();
      expect(body).toMatchObject({ accessMethodId: graph.method.id, operation: "responses.create" });
      return jsonResponse({
        schemaVersion: "accounts.capacity-query.v1",
        reservation: "none",
        data: {
          schemaVersion: "accounts.slot-eligibility.v1",
          evidenceId: newEligibilityEvidenceId(),
          evidenceClass: "local_diagnostic",
          authority: "none",
          reservation: "none",
          accessMethodId: graph.method.id,
          accessTarget: { kind: "unresolved" },
          eligibilityRequestDigest: digest("e"),
          issuedAt: CREATED_AT,
          expiresAt: FUTURE,
          eligible: false,
          reasonCodes: ["ACCOUNT_NOT_ACTIVE"],
          recordRevisionSet: {},
        },
      });
    }
    return jsonResponse(
      {
        schemaVersion: "accounts.error.v1",
        error: {
          code: "NOT_FOUND",
          message: "The requested record was not found",
          requestId: "018f0f00-0000-7000-8000-000000000000",
          retryable: false,
          details: {},
        },
      },
      404,
    );
  }) as unknown as typeof fetch;
  return { calls, graph };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Serves the CLI from this repository's own HTTP handler behind an
 * authenticator that actually checks the presented credential, so an
 * unauthenticated CLI cannot pass.
 */
function installHandlerBackedFetch(accounts: readonly Account[] = []) {
  const graph = makeFixtureGraph("api_key", 7);
  const records = new Map<EntityKind, EntityMap[EntityKind][]>([
    ["account", accounts.length === 0 ? [graph.activeAccount] : [...accounts]],
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
    list: async <K extends EntityKind>(kind: K) => records.get(kind)! as EntityMap[K][],
    eligibility: async () => {
      throw new AccountsError("NOT_IMPLEMENTED", "not used");
    },
    doctor: async () => {
      throw new AccountsError("NOT_IMPLEMENTED", "not used");
    },
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
    contractSha256: "0".repeat(64),
    openApiDocument: ACCOUNTS_CAPACITY_OPENAPI,
  });
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(input, init)),
  ) as unknown as typeof fetch;
  return { presented, graph };
}

/** Serves more records than a single page holds, exactly as the handler paginates them. */
function installPaginatedFetchMock(total: number) {
  const graph = makeFixtureGraph("api_key", 9);
  const records = Array.from({ length: total }, (_unused, index) => ({
    ...graph.binding,
    id: newCredentialBindingId(NOW.getTime() + index),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(url.pathname).toBe("/v1/credential-bindings");
    calls.push(url.searchParams.toString());
    const cursor = url.searchParams.get("cursor");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const visible = records.filter((record) => cursor === null || record.id > cursor);
    const page = visible.slice(0, limit);
    return jsonResponse({
      schemaVersion: "accounts.list.v1",
      kind: "credential_binding",
      records: page,
      nextCursor: visible.length > limit ? page.at(-1)!.id : null,
      route: url.pathname,
    });
  }) as unknown as typeof fetch;
  return { calls, total };
}

describe("accounts CLI", () => {
  test("reports the package version through the version command", async () => {
    const human = await runCli(["version"]);
    expect(human).toEqual({
      stdout: `${canonicalJson({ package: "@hasna/capacity", version: PACKAGE_VERSION })}\n`,
      stderr: "",
      exitCode: 0,
    });

    const json = await runCli(["version", "--json"]);
    expect(json).toEqual({
      stdout: `${canonicalJson({
        schemaVersion: "accounts.cli.v1",
        command: "version",
        data: { package: "@hasna/capacity", version: PACKAGE_VERSION },
      })}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("reports the package version through the --version flag", async () => {
    const human = await runCli(["--version"]);
    expect(human).toEqual({
      stdout: `${canonicalJson({ package: "@hasna/capacity", version: PACKAGE_VERSION })}\n`,
      stderr: "",
      exitCode: 0,
    });

    const json = await runCli(["--version", "--json"]);
    expect(json).toEqual({
      stdout: `${canonicalJson({
        schemaVersion: "accounts.cli.v1",
        command: "version",
        data: { package: "@hasna/capacity", version: PACKAGE_VERSION },
      })}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("prints help for no command and --help", async () => {
    const noCommand = await runCli([]);
    const help = await runCli(["--help"]);
    expect(noCommand).toEqual(help);
    expect(noCommand.exitCode).toBe(0);
    expect(noCommand.stderr).toBe("");
    expect(noCommand.stdout).toContain("capacity validate <file|-> [--json]");
    expect(noCommand.stdout).not.toContain(PACKAGE_VERSION);
  });

  test("doctor and list emit deterministic versioned JSON", async () => {
    const environment = localEnvironment();
    const doctor = await runCli(["doctor", "--json"], environment);
    expect(doctor.exitCode).toBe(0);
    const doctorBody = JSON.parse(doctor.stdout);
    expect(doctorBody.schemaVersion).toBe("accounts.cli.v1");
    expect(doctorBody.data).toMatchObject({ adapter: "sqlite", foreignKeys: true, journalMode: "wal" });

    const list = await runCli(["list", "access-methods", "--json"], environment);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).data.records).toEqual([]);
  });

  test("validates a closed record DTO without database configuration", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "validate-"));
    cleanup.push(directory);
    const filename = join(directory, "record.json");
    await Bun.write(filename, serializeRecordEnvelope("account", makeFixtureGraph().account));
    const result = await runCli(["validate", filename, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data).toEqual({ valid: true, documentKind: "account" });
  });

  test("runs credential- and network-free PROBE_NATIVE without database configuration", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "probe-native-"));
    cleanup.push(directory);
    const requestFile = join(directory, "request.json");
    const snapshotFile = join(directory, "snapshot.json");
    const owner = "principal:human:hasna:owner-a";
    const ids = [1, 2, 3, 4, 5].map(
      (value) => `018f0f00-000${value}-7000-8000-00000000000${value}`,
    );
    const request = {
      schema_version: NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
      command: "PROBE_NATIVE",
      owner_ref: owner,
      provider_account_id: ids[0],
      subscription_id: ids[1],
      account_lane_id: ids[2],
      auth_capsule_id: ids[3],
      canonical_node_id: ids[4],
      node_key_thumbprint: `sha256:${"0".repeat(64)}`,
      node_generation: parseCounter("1"),
      placement_generation: parseCounter("1"),
      auth_generation: parseCounter("2"),
      auth_state_revision: parseCounter("2"),
    } as const;
    const snapshot = {
      ownerRef: owner,
      providerAccountId: ids[0],
      subscriptionId: ids[1],
      accountLaneId: ids[2],
      authCapsuleId: ids[3],
      canonicalNodeId: ids[4],
      nodeKeyThumbprint: request.node_key_thumbprint,
      nodeGeneration: request.node_generation,
      placementGeneration: request.placement_generation,
      authGeneration: request.auth_generation,
      authStateRevision: request.auth_state_revision,
      accountRevision: parseCounter("2"),
      capsuleRevision: parseCounter("2"),
      accountStatus: "active",
      subscriptionStatus: "active",
      accountLaneStatus: "ready",
      capsuleStatus: "ready",
      liveLeaseCount: parseCounter("0"),
      drainState: "drained",
      zeroLiveEvidenceDigest: `sha256:${"1".repeat(64)}`,
      drainEvidenceDigest: `sha256:${"2".repeat(64)}`,
      evidenceExpiresAt: "2099-01-01T00:00:00.000Z",
    } as const;
    await Bun.write(requestFile, canonicalJson(request));
    await Bun.write(snapshotFile, canonicalJson(snapshot));

    const result = await runCli([
      "probe-native",
      requestFile,
      snapshotFile,
      "--owner",
      owner,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      capability_eligible: true,
      maintenance_ready: true,
    });
  });

  test("invalid validation input is not echoed", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "invalid-"));
    cleanup.push(directory);
    const filename = join(directory, "record.json");
    const marker = "rejected-input-marker";
    await Bun.write(filename, `{"schemaVersion":"accounts.capacity.v1","kind":"account","kind":"${marker}"}`);
    const result = await runCli(["validate", filename, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain(marker);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION_FAILED");
  });

  test("uses stable not-found and policy-safe exit codes", async () => {
    const environment = localEnvironment();
    const missing = await runCli(
      ["get", "access-methods", newAccessMethodId(), "--json"],
      environment,
    );
    expect(missing.exitCode).toBe(3);
    expect(JSON.parse(missing.stderr).error.code).toBe("NOT_FOUND");

    const eligibility = await runCli(
      [
        "eligibility",
        newAccessMethodId(),
        "--operation",
        "responses.create",
        "--model",
        "model.example",
        "--data-classification",
        "internal",
        "--json",
      ],
      environment,
    );
    expect(eligibility.exitCode).toBe(3);
  });

  test("refuses contradictory, implicit, relative, and incomplete deployment configuration", async () => {
    const implicit = await runCli(["doctor", "--json"]);
    expect(implicit.exitCode).toBe(2);

    const relative = await runCli(["doctor", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "local",
      HASNA_ACCOUNTS_DATABASE_PATH: "relative.db",
    });
    expect(relative.exitCode).toBe(2);

    const contradictory = await runCli(["doctor", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
      HASNA_ACCOUNTS_DATABASE_PATH: "/tmp/not-used.db",
    });
    expect(contradictory.exitCode).toBe(2);

    const missingApi = await runCli(["doctor", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    });
    expect(missingApi.exitCode).toBe(2);
    expect(JSON.parse(missingApi.stderr).error.code).toBe("VALIDATION_FAILED");
  });

  test("routes self-hosted doctor through HTTP diagnostics", async () => {
    const { calls } = installSelfHostedFetchMock();
    const result = await runCliInProcess(["doctor", "--json"], selfHostedEnvironment());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).data).toEqual({
      adapter: "http",
      health: "ok",
      readiness: "ready",
      version: PACKAGE_VERSION,
      contractSha256: "0".repeat(64),
    });
    expect([...calls].sort()).toEqual(["GET /health", "GET /ready", "GET /version"]);
  });

  test("routes every self-hosted list noun through the HTTP client", async () => {
    const { calls } = installSelfHostedFetchMock();
    for (const noun of [
      "accounts",
      "entitlements",
      "capacity-pools",
      "access-methods",
      "auth-capsules",
      "credential-bindings",
    ]) {
      const result = await runCliInProcess(["list", noun, "--json"], selfHostedEnvironment());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data.records).toHaveLength(1);
    }
    expect(calls).toEqual([
      "GET /v1/provider-accounts",
      "GET /v1/entitlements",
      "GET /v1/capacity-pools",
      "GET /v1/account-lanes",
      "GET /v1/auth-capsules",
      "GET /v1/credential-bindings",
    ]);
  });

  test("routes self-hosted get and eligibility through the HTTP client", async () => {
    const { calls, graph } = installSelfHostedFetchMock();
    const get = await runCliInProcess(["get", "accounts", graph.account.id, "--json"], selfHostedEnvironment());
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).data.data).toMatchObject({
      id: graph.account.id,
      providerSubjectRefRedacted: true,
    });

    const eligibility = await runCliInProcess([
      "eligibility",
      graph.method.id,
      "--operation",
      "responses.create",
      "--model",
      "model.example",
      "--data-classification",
      "internal",
      "--json",
    ], selfHostedEnvironment());
    expect(eligibility.exitCode).toBe(7);
    expect(JSON.parse(eligibility.stdout).data).toMatchObject({
      accessMethodId: graph.method.id,
      eligible: false,
      reservation: "none",
    });
    expect(calls).toEqual([
      `GET /v1/provider-accounts/${graph.account.id}`,
      "POST /v1/capacity/query",
    ]);
  });
});

describe("self-hosted CLI credential resolution", () => {
  test("authenticates against the capacity HTTP handler only with a resolved credential", async () => {
    const { presented, graph } = installHandlerBackedFetch();

    const resolved = await runCliInProcess(["list", "accounts", "--json"], selfHostedEnvironment());
    expect(resolved.exitCode).toBe(0);
    expect(JSON.parse(resolved.stdout).data.records).toHaveLength(1);
    expect(presented).toEqual([`Bearer ${RESOLVED_CREDENTIAL}`]);
  });

  test("never presents the Secrets reference itself as the capacity client credential", async () => {
    const { presented } = installHandlerBackedFetch();

    const unresolved = await runCliInProcess(["list", "accounts", "--json"], selfHostedEnvironment(), {
      credentialResolver: { resolve: async (reference) => reference },
    });
    expect(unresolved.exitCode).toBe(6);
    expect(JSON.parse(unresolved.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(unresolved.stdout).toBe("");

    const unconfigured = await runCliInProcess(["doctor", "--json"], selfHostedEnvironment(), {});
    expect(unconfigured.exitCode).toBe(6);
    expect(JSON.parse(unconfigured.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");

    // The reference never reaches the wire in either failure mode.
    expect(presented).toEqual([]);
  });

  test("returns every page of a self-hosted list instead of the first page only", async () => {
    const { calls, total } = installPaginatedFetchMock(120);
    const result = await runCliInProcess(["list", "credential-bindings", "--json"], selfHostedEnvironment());
    expect(result.exitCode).toBe(0);
    const records = JSON.parse(result.stdout).data.records;
    expect(records).toHaveLength(total);
    expect(new Set(records.map((record: { data: { id: string } }) => record.data.id)).size).toBe(total);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("limit=100");
    expect(calls[1]).toMatch(/^cursor=[0-9a-f-]{36}&limit=100$/);
  });
});

/**
 * The in-process suites above inject a resolver through a library option no
 * installed consumer holds. These drive the shipped entry point as a separate
 * process against a real TLS capacity API, so they fail whenever the binary
 * itself cannot reach the self-hosted path.
 */
describe("self-hosted CLI through the shipped entry point", () => {
  let server: SelfHostedCapacityServer;
  let resolverDirectory: string;
  let resolverModulePath: string;

  beforeAll(() => {
    resolverDirectory = mkdtempSync(join(TEMP_ROOT, "resolver-"));
    cleanup.push(resolverDirectory);
    server = startSelfHostedCapacityServer(resolverDirectory);
    resolverModulePath = writeCredentialResolverModule(resolverDirectory);
  });

  afterAll(() => {
    server.stop();
  });

  function processEnvironment(
    overrides: Readonly<Record<string, string | undefined>> = {},
  ): Record<string, string> {
    const environment: Record<string, string | undefined> = {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
      HASNA_ACCOUNTS_CAPACITY_API_URL: server.baseUrl,
      HASNA_ACCOUNTS_CAPACITY_AUTH_REF: AUTH_REFERENCE,
      HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: resolverModulePath,
      NODE_EXTRA_CA_CERTS: server.caPath,
      ...overrides,
    };
    return Object.fromEntries(
      Object.entries(environment).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
  }

  test("runs doctor and list against a real capacity API", async () => {
    const doctor = await runCli(["doctor", "--json"], processEnvironment());
    expect({ exitCode: doctor.exitCode, stderr: doctor.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(JSON.parse(doctor.stdout).data).toEqual({
      adapter: "http",
      health: "ok",
      readiness: "ready",
      version: PACKAGE_VERSION,
      contractSha256: CONTRACT_SHA256,
    });

    const list = await runCli(["list", "accounts", "--json"], processEnvironment());
    expect({ exitCode: list.exitCode, stderr: list.stderr }).toEqual({ exitCode: 0, stderr: "" });
    const records = JSON.parse(list.stdout).data.records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      schemaVersion: "accounts.capacity-redacted.v1",
      kind: "account",
      data: { id: server.account.id, providerSubjectRefRedacted: true },
    });
    expect(records[0].data.providerSubjectRef).toBeUndefined();

    // The resolved credential authenticated the read; the Secrets reference never travelled.
    expect(server.presented).toEqual([`Bearer ${RESOLVED_CREDENTIAL}`]);

    // A file: URL is the other accepted form of the module specifier.
    const viaFileUrl = await runCli(
      ["doctor", "--json"],
      processEnvironment({
        HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: pathToFileURL(resolverModulePath).href,
      }),
    );
    expect(viaFileUrl.exitCode).toBe(0);
  });

  test("fails closed when the deployment configures no resolver module", async () => {
    const presentedBefore = server.presented.length;
    const result = await runCli(
      ["list", "accounts", "--json"],
      processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: undefined }),
    );
    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(server.presented).toHaveLength(presentedBefore);
  });

  test("refuses relative, non-file, and local-mode resolver module configuration", async () => {
    for (const specifier of [
      "relative-resolver.mjs",
      "https://resolver.example/module.mjs",
      "file://resolver.example/module.mjs",
    ]) {
      const result = await runCli(
        ["doctor", "--json"],
        processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: specifier }),
      );
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION_FAILED");
    }

    const local = await runCli(["doctor", "--json"], {
      ...localEnvironment(),
      HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: resolverModulePath,
    });
    expect(local.exitCode).toBe(2);
    expect(JSON.parse(local.stderr).error.code).toBe("VALIDATION_FAILED");
  });

  test("refuses a group-writable resolver module before importing it", async () => {
    const sentinel = join(resolverDirectory, "writable-resolver-sentinel");
    const writable = writeCredentialResolverModule(
      join(resolverDirectory, "writable"),
      [
        `await Bun.write(${JSON.stringify(sentinel)}, "evaluated");`,
        "export async function resolve() { return \"unused\"; }",
      ].join("\n"),
      0o664,
    );
    const result = await runCli(
      ["doctor", "--json"],
      processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: writable }),
    );
    expect(result.exitCode).toBe(7);
    expect(JSON.parse(result.stderr).error.code).toBe("POLICY_DENIED");
    expect(existsSync(sentinel)).toBe(false);
  });

  /**
   * The file-permission check alone reads through a symlink, so an operator-owned
   * entry in a directory another account can write is that account's route to
   * running code with the operator's authority. The sentinel proves refusal
   * happened before evaluation, not after.
   */
  test("refuses a symlinked resolver module before evaluating its target", async () => {
    const sentinel = join(resolverDirectory, "symlink-resolver-sentinel");
    const target = writeCredentialResolverModule(
      join(resolverDirectory, "symlink-target"),
      [
        `await Bun.write(${JSON.stringify(sentinel)}, "evaluated");`,
        'export async function resolve() { return "unused"; }',
      ].join("\n"),
    );
    const linkDirectory = join(resolverDirectory, "symlink-link");
    mkdirSync(linkDirectory, { recursive: true, mode: 0o700 });
    const link = join(linkDirectory, "capacity-credential-resolver.mjs");
    symlinkSync(target, link);

    const result = await runCli(
      ["doctor", "--json"],
      processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: link }),
    );
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("POLICY_DENIED");
    expect(existsSync(sentinel)).toBe(false);
  });

  /**
   * An owner-only module is only as safe as the directory holding it: a group
   * member who can write that directory can unlink the entry and leave its own.
   */
  test("refuses an owner-only resolver module inside a group-writable directory", async () => {
    const sentinel = join(resolverDirectory, "ancestor-resolver-sentinel");
    const shared = join(resolverDirectory, "group-writable");
    const module = writeCredentialResolverModule(
      shared,
      [
        `await Bun.write(${JSON.stringify(sentinel)}, "evaluated");`,
        'export async function resolve() { return "unused"; }',
      ].join("\n"),
    );
    chmodSync(shared, 0o775);

    const result = await runCli(
      ["doctor", "--json"],
      processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: module }),
    );
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("POLICY_DENIED");
    expect(existsSync(sentinel)).toBe(false);
  });

  test("fails closed when the resolver module exports no resolve function", async () => {
    const incomplete = writeCredentialResolverModule(
      join(resolverDirectory, "incomplete"),
      "export const unrelated = true;\n",
    );
    const result = await runCli(
      ["doctor", "--json"],
      processEnvironment({ HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE: incomplete }),
    );
    expect(result.exitCode).toBe(6);
    expect(JSON.parse(result.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});

describe("local and self-hosted record envelope parity", () => {
  test("emits the identical validatable record envelope in both deployment modes", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "parity-"));
    cleanup.push(directory);
    const filename = join(directory, "accounts.db");
    const graph = makeFixtureGraph("api_key", 42);
    const repository = new SQLiteAccountsRepository(filename, {
      credentialVerifier: TEST_CREDENTIAL_VERIFIER,
      recoveryLedger: makeTestRecoveryLedger(),
      catalogIncarnation: CATALOG_INCARNATION,
      credentialUseAuthorizer: TEST_CREDENTIAL_USE_AUTHORIZER,
    });
    const seedCatalog = new AccountsCatalog(repository, clock, TEST_AUTHORITY_POLICY);
    await seedActiveCatalog(seedCatalog, graph, "cli-parity");
    const reader = createSQLiteAccounts({ path: filename });
    const stored = await reader.get("account", graph.account.id);
    await reader.close();
    await seedCatalog.close();
    expect(stored.providerSubjectRef).toBeDefined();

    const local = await runCliInProcess(["get", "accounts", graph.account.id, "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "local",
      HASNA_ACCOUNTS_DATABASE_PATH: filename,
    });
    expect(local.exitCode).toBe(0);

    installHandlerBackedFetch([stored]);
    const api = await runCliInProcess(["get", "accounts", graph.account.id, "--json"], selfHostedEnvironment());
    expect(api.exitCode).toBe(0);

    const localEnvelope = JSON.parse(local.stdout).data;
    const apiEnvelope = JSON.parse(api.stdout).data;

    // The repository's own validator round-trips what either mode emits.
    for (const [name, envelope] of [
      ["local.json", localEnvelope],
      ["api.json", apiEnvelope],
    ] as const) {
      const path = join(directory, name);
      await Bun.write(path, canonicalJson(envelope));
      const validated = await runCli(["validate", path, "--json"]);
      expect(validated.exitCode).toBe(0);
      expect(JSON.parse(validated.stdout).data).toEqual({ valid: true, documentKind: "account" });
    }

    expect(localEnvelope.schemaVersion).toBe("accounts.capacity-redacted.v1");
    expect(Object.keys(localEnvelope.data).sort()).toEqual(Object.keys(apiEnvelope.data).sort());
    expect(localEnvelope).toEqual(apiEnvelope);
    expect(localEnvelope.data.providerSubjectRef).toBeUndefined();
    expect(localEnvelope.data.providerSubjectRefRedacted).toBe(true);
  });
});
