import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACCOUNTS_CAPACITY_OPENAPI,
  NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
  PACKAGE_VERSION,
  canonicalJson,
  createAccountsHttpHandler,
  createSQLiteAccounts,
  newAccessMethodId,
  newEligibilityEvidenceId,
  parseCounter,
  serializeRecordEnvelope,
} from "../../src/index";
import { AccountsCatalog } from "../../src/domain/catalog";
import { SQLiteAccountsRepository } from "../../src/storage/sqlite";
import {
  ACTOR_REF,
  CATALOG_INCARNATION,
  TEST_AUTHORITY_POLICY,
  TEST_CREDENTIAL_USE_AUTHORIZER,
  TEST_CREDENTIAL_VERIFIER,
  clock,
  makeFixtureGraph,
  makeTestRecoveryLedger,
  seedActiveCatalog,
} from "../fixtures";
import { runAccountsCli, type AccountsCliOptions } from "../../src/cli";

const TEMP_PARENT = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
const TEMP_ROOT = join(TEMP_PARENT, "capacity-cli-tests");
mkdirSync(TEMP_ROOT, { recursive: true, mode: 0o700 });
chmodSync(TEMP_ROOT, 0o700);
const cleanup: string[] = [];
const originalFetch = globalThis.fetch;
const CLI_ENV_KEYS = [
  "HASNA_ACCOUNTS_DEPLOYMENT",
  "HASNA_ACCOUNTS_DATABASE_PATH",
  "HASNA_ACCOUNTS_CAPACITY_API_URL",
  "HASNA_ACCOUNTS_CAPACITY_AUTH_REF",
  "HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND",
] as const;

afterAll(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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

async function runCliInProcess(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  options: AccountsCliOptions = {},
) {
  const stdoutTarget = Bun.stdout as unknown as { write: (chunk: string | Uint8Array) => number };
  const stderrTarget = Bun.stderr as unknown as { write: (chunk: string | Uint8Array) => number };
  const originalStdoutWrite = stdoutTarget.write;
  const originalStderrWrite = stderrTarget.write;
  const previousEnvironment = new Map<string, string | undefined>();
  const keys = new Set<string>([...CLI_ENV_KEYS, ...Object.keys(environment)]);
  let stdout = "";
  let stderr = "";
  const capture = (target: "stdout" | "stderr", chunk: string | Uint8Array): number => {
    const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    if (target === "stdout") stdout += text;
    else stderr += text;
    return Buffer.byteLength(text);
  };

  try {
    stdoutTarget.write = (chunk) => capture("stdout", chunk);
    stderrTarget.write = (chunk) => capture("stderr", chunk);
    for (const key of keys) {
      previousEnvironment.set(key, Bun.env[key]);
      delete Bun.env[key];
    }
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
    const exitCode = await runAccountsCli(args, options);
    return { stdout, stderr, exitCode };
  } finally {
    stdoutTarget.write = originalStdoutWrite;
    stderrTarget.write = originalStderrWrite;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }
}

function localEnvironment(): Record<string, string> {
  const directory = mkdtempSync(join(TEMP_ROOT, "database-"));
  cleanup.push(directory);
  return {
    HASNA_ACCOUNTS_DEPLOYMENT: "local",
    HASNA_ACCOUNTS_DATABASE_PATH: join(directory, "accounts.db"),
  };
}

const AUTH_REFERENCE = "capacity-cli-auth-reference";
const AUTH_CREDENTIAL = "capacity-cli-audienced-credential";

function apiEnvironment(): Record<string, string> {
  return {
    HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    HASNA_ACCOUNTS_CAPACITY_API_URL: "https://capacity.test",
    HASNA_ACCOUNTS_CAPACITY_AUTH_REF: AUTH_REFERENCE,
  };
}

/**
 * Stands in for the deployment-owned Secrets command the packaged binary runs
 * when no embedder injected a resolver.
 */
function writeCredentialCommand(body: string, mode = 0o700): string {
  const directory = mkdtempSync(join(TEMP_ROOT, "credential-command-"));
  cleanup.push(directory);
  const command = join(directory, "resolve-capacity-credential.sh");
  writeFileSync(command, `#!/bin/sh\n${body}\n`, { mode });
  chmodSync(command, mode);
  return command;
}

/** Records the authorization header the transport puts on the wire. */
function captureAuthorization(authorizations: string[]): void {
  const served = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const header = new Headers(init?.headers).get("authorization");
    if (header !== null) authorizations.push(header);
    return served(input as never, init as never);
  }) as unknown as typeof fetch;
}

/** Stands in for the deployment-owned Secrets resolver the CLI never bundles. */
function resolverOptions(resolved: string[] = []): AccountsCliOptions {
  return {
    credentialResolver: {
      resolve: async (reference: string) => {
        resolved.push(reference);
        return AUTH_CREDENTIAL;
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(canonicalJson(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PARITY_CONTRACT_SHA = "07b636588973646b6c3745690908d92d2daa64ce47f1c6bf90498f2d4ccffd2e";

/** Serves the CLI's own HTTP handler so api mode is measured, not mocked. */
function serveCatalog(path: string): { readonly close: () => Promise<void> } {
  const catalog = createSQLiteAccounts({ path, clock });
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
      authenticate: async () => ({
        actorRef: ACTOR_REF,
        subjectRef: ACTOR_REF,
        issuer: "authority:identities",
        audience: "accounts-capacity-public",
        scopes: new Set(["accounts:read" as const]),
        authorizedOwnerRefs: new Set([ACTOR_REF]),
      }),
    },
    catalog,
    packageVersion: PACKAGE_VERSION,
    contractSha256: PARITY_CONTRACT_SHA,
    openApiDocument: ACCOUNTS_CAPACITY_OPENAPI,
    now: clock,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(String(input), init))) as unknown as typeof fetch;
  return { close: () => catalog.close() };
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

  test("self-hosted doctor, list, get, and eligibility use the HTTP API path", async () => {
    const graph = makeFixtureGraph("api_key");
    const resolved: string[] = [];
    const options = resolverOptions(resolved);
    const calls: Array<{ readonly method: string; readonly path: string; readonly authorization: string | null }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      calls.push({
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        authorization: headers.get("authorization"),
      });
      if (url.origin !== "https://capacity.test") throw new Error("unexpected origin");
      if (url.pathname === "/health") {
        return jsonResponse({ schemaVersion: "accounts.health.v1", status: "ok" });
      }
      if (url.pathname === "/ready") {
        return jsonResponse({ schemaVersion: "accounts.readiness.v1", status: "ready" });
      }
      if (url.pathname === "/version") {
        return jsonResponse({
          schemaVersion: "accounts.version.v1",
          version: "1.0.0-test",
          contractSha256: "a".repeat(64),
        });
      }
      expect(headers.get("authorization")).toBe(`Bearer ${AUTH_CREDENTIAL}`);
      if (url.pathname === "/v1/account-lanes" && url.searchParams.get("limit") === "100") {
        return jsonResponse({
          schemaVersion: "accounts.list.v1",
          kind: "access_method",
          route: "/v1/account-lanes",
          records: [graph.method],
          nextCursor: null,
        });
      }
      if (url.pathname === `/v1/account-lanes/${graph.method.id}`) {
        return jsonResponse({
          schemaVersion: "accounts.record.v1",
          kind: "access_method",
          data: graph.method,
        });
      }
      if (url.pathname === "/v1/capacity/query") {
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
            recordRevisionSet: {},
            eligibilityRequestDigest: `sha256:${"e".repeat(64)}`,
            eligible: false,
            reasonCodes: ["ACCOUNT_NOT_ACTIVE"],
            issuedAt: "2026-07-10T11:59:00.000Z",
            expiresAt: "2026-07-10T13:00:00.000Z",
          },
        });
      }
      return jsonResponse({
        schemaVersion: "accounts.error.v1",
        error: {
          code: "NOT_FOUND",
          message: "The requested record was not found",
          requestId: "018f0f00-0099-7000-8000-000000000099",
          retryable: false,
          details: {},
        },
      }, 404);
    }) as unknown as typeof fetch;

    const doctor = await runCliInProcess(["doctor", "--json"], apiEnvironment(), options);
    expect(doctor.exitCode).toBe(0);
    expect(JSON.parse(doctor.stdout).data).toEqual({
      adapter: "http",
      health: "ok",
      readiness: "ready",
      version: "1.0.0-test",
      contractSha256: "a".repeat(64),
    });

    const list = await runCliInProcess(["list", "access-methods", "--json"], apiEnvironment(), options);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).data.records).toEqual([
      { schemaVersion: "accounts.capacity.v1", kind: "access_method", data: graph.method },
    ]);

    const get = await runCliInProcess(
      ["get", "access-methods", graph.method.id, "--json"],
      apiEnvironment(),
      options,
    );
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).data).toEqual({
      schemaVersion: "accounts.capacity.v1",
      kind: "access_method",
      data: graph.method,
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
    ], apiEnvironment(), options);
    expect(eligibility.exitCode).toBe(7);
    expect(JSON.parse(eligibility.stdout).data).toMatchObject({
      accessMethodId: graph.method.id,
      eligible: false,
      reservation: "none",
    });
    expect(eligibility.stderr).toBe("");
    expect(calls.map((call) => call.path)).toEqual(expect.arrayContaining([
      "/health",
      "/ready",
      "/version",
      "/v1/account-lanes?limit=100",
      `/v1/account-lanes/${graph.method.id}`,
      "/v1/capacity/query",
    ]));
    expect(resolved).toEqual([AUTH_REFERENCE, AUTH_REFERENCE, AUTH_REFERENCE]);
    const authorizations = calls
      .map((call) => call.authorization)
      .filter((value): value is string => value !== null);
    expect(authorizations.length).toBeGreaterThan(0);
    expect(new Set(authorizations)).toEqual(new Set([`Bearer ${AUTH_CREDENTIAL}`]));
    expect(authorizations).not.toContain(`Bearer ${AUTH_REFERENCE}`);
  });

  test("self-hosted refuses to send the credential reference as the bearer value", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ schemaVersion: "accounts.health.v1", status: "ok" });
    }) as unknown as typeof fetch;

    const unresolved = await runCliInProcess(["list", "access-methods", "--json"], apiEnvironment());
    expect(unresolved.exitCode).toBe(6);
    expect(JSON.parse(unresolved.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(unresolved.stderr).not.toContain(AUTH_REFERENCE);
    expect(calls).toEqual([]);

    const echoed = await runCliInProcess(["list", "access-methods", "--json"], apiEnvironment(), {
      credentialResolver: { resolve: async (reference: string) => reference },
    });
    expect(echoed.exitCode).toBe(6);
    expect(JSON.parse(echoed.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(calls).toEqual([]);
  });

  test("reaches the api with the credential the deployment-named command resolves", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "credential-command-api-"));
    cleanup.push(directory);
    const served = serveCatalog(join(directory, "accounts.db"));
    const authorizations: string[] = [];
    captureAuthorization(authorizations);
    try {
      // No injected resolver: this is the path the packaged binary takes.
      const result = await runCliInProcess(["list", "access-methods", "--json"], {
        ...apiEnvironment(),
        HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND: writeCredentialCommand(
          `printf '%s\\n' '${AUTH_CREDENTIAL}'`,
        ),
      });
      expect([result.exitCode, result.stderr]).toEqual([0, ""]);
      expect(JSON.parse(result.stdout).data).toEqual({ kind: "access_method", records: [] });
      expect(authorizations).toEqual([`Bearer ${AUTH_CREDENTIAL}`]);
      expect(authorizations).not.toContain(`Bearer ${AUTH_REFERENCE}`);
    } finally {
      await served.close();
    }
  });

  test("refuses a credential command another local account can rewrite", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ schemaVersion: "accounts.health.v1", status: "ok" });
    }) as unknown as typeof fetch;

    const result = await runCliInProcess(["list", "access-methods", "--json"], {
      ...apiEnvironment(),
      HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND: writeCredentialCommand(
        `printf '%s\\n' '${AUTH_CREDENTIAL}'`,
        0o777,
      ),
    });
    expect(result.exitCode).toBe(7);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: "POLICY_DENIED",
      details: { field: "credentialCommand" },
    });
    expect(calls).toEqual([]);

    const relative = await runCliInProcess(["list", "access-methods", "--json"], {
      ...apiEnvironment(),
      HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND: "resolve-capacity-credential.sh",
    });
    expect(relative.exitCode).toBe(2);
    expect(JSON.parse(relative.stderr).error.code).toBe("VALIDATION_FAILED");
    expect(calls).toEqual([]);
  });

  test("keeps a failing credential command's diagnostics off every surface", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ schemaVersion: "accounts.health.v1", status: "ok" });
    }) as unknown as typeof fetch;

    const directory = mkdtempSync(join(TEMP_ROOT, "credential-command-failure-"));
    cleanup.push(directory);
    const invoked = join(directory, "invoked");
    const result = await runCliInProcess(["list", "access-methods", "--json"], {
      ...apiEnvironment(),
      HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND: writeCredentialCommand(
        [
          `printf '%s' "$1" > '${invoked}'`,
          `printf '%s\\n' 'resolver-diagnostic-${AUTH_CREDENTIAL}' >&2`,
          "exit 1",
        ].join("\n"),
      ),
    });
    // The command ran and failed; this is not the no-resolver refusal.
    expect(existsSync(invoked)).toBe(true);
    expect(await Bun.file(invoked).text()).toBe(AUTH_REFERENCE);
    expect(result.exitCode).toBe(6);
    expect(JSON.parse(result.stderr).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("resolver-diagnostic");
    expect(result.stderr).not.toContain(AUTH_CREDENTIAL);
    expect(result.stderr).not.toContain(AUTH_REFERENCE);
    expect(calls).toEqual([]);
  });

  test("local and api mode emit one redacted record schema for every noun", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "parity-"));
    cleanup.push(directory);
    const filename = join(directory, "accounts.db");
    const graph = makeFixtureGraph();
    const repository = new SQLiteAccountsRepository(filename, {
      credentialVerifier: TEST_CREDENTIAL_VERIFIER,
      recoveryLedger: makeTestRecoveryLedger(),
      catalogIncarnation: CATALOG_INCARNATION,
      credentialUseAuthorizer: TEST_CREDENTIAL_USE_AUTHORIZER,
    });
    const seeding = new AccountsCatalog(repository, clock, TEST_AUTHORITY_POLICY);
    await seedActiveCatalog(seeding, graph, "cli-parity");
    await seeding.close();

    const nouns: readonly (readonly [string, string])[] = [
      ["accounts", graph.activeAccount.id],
      ["entitlements", graph.activeEntitlement.id],
      ["capacity-pools", graph.pool.id],
      ["access-methods", graph.readyMethod.id],
      ["auth-capsules", graph.capsule!.id],
      ["credential-bindings", graph.binding.id],
    ];
    const localEnvironmentForFile = {
      HASNA_ACCOUNTS_DEPLOYMENT: "local",
      HASNA_ACCOUNTS_DATABASE_PATH: filename,
    };

    const local = new Map<string, { readonly record: unknown; readonly records: unknown }>();
    for (const [noun, id] of nouns) {
      const get = await runCliInProcess(["get", noun, id, "--json"], localEnvironmentForFile);
      const list = await runCliInProcess(["list", noun, "--json"], localEnvironmentForFile);
      expect([noun, get.exitCode, list.exitCode]).toEqual([noun, 0, 0]);
      local.set(noun, {
        record: JSON.parse(get.stdout).data.data,
        records: JSON.parse(list.stdout).data.records,
      });
    }

    const served = serveCatalog(filename);
    try {
      for (const [noun, id] of nouns) {
        const get = await runCliInProcess(
          ["get", noun, id, "--json"],
          apiEnvironment(),
          resolverOptions(),
        );
        const list = await runCliInProcess(["list", noun, "--json"], apiEnvironment(), resolverOptions());
        expect([noun, get.exitCode, list.exitCode]).toEqual([noun, 0, 0]);
        expect([noun, JSON.parse(get.stdout).data.data]).toEqual([noun, local.get(noun)!.record]);
        expect([noun, JSON.parse(list.stdout).data.records]).toEqual([noun, local.get(noun)!.records]);
      }
    } finally {
      await served.close();
    }

    const account = local.get("accounts")!.record as Record<string, unknown>;
    expect(Object.hasOwn(account, "providerSubjectRef")).toBe(false);
    expect(Object.hasOwn(account, "providerSubjectCandidateRef")).toBe(false);
    expect(account.providerSubjectRefRedacted).toBe(true);
    expect(canonicalJson([...local.values()])).not.toContain(graph.activeAccount.providerSubjectRef!);
  });

  test("round-trips a read account through the validate command in both modes", async () => {
    const directory = mkdtempSync(join(TEMP_ROOT, "round-trip-"));
    cleanup.push(directory);
    const filename = join(directory, "accounts.db");
    const graph = makeFixtureGraph();
    const repository = new SQLiteAccountsRepository(filename, {
      credentialVerifier: TEST_CREDENTIAL_VERIFIER,
      recoveryLedger: makeTestRecoveryLedger(),
      catalogIncarnation: CATALOG_INCARNATION,
      credentialUseAuthorizer: TEST_CREDENTIAL_USE_AUTHORIZER,
    });
    const seeding = new AccountsCatalog(repository, clock, TEST_AUTHORITY_POLICY);
    await seedActiveCatalog(seeding, graph, "cli-round-trip");
    await seeding.close();

    const local = await runCliInProcess(["get", "accounts", graph.activeAccount.id], {
      HASNA_ACCOUNTS_DEPLOYMENT: "local",
      HASNA_ACCOUNTS_DATABASE_PATH: filename,
    });
    expect([local.exitCode, local.stderr]).toEqual([0, ""]);

    const served = serveCatalog(filename);
    let api: { readonly stdout: string; readonly stderr: string; readonly exitCode: number };
    try {
      api = await runCliInProcess(
        ["get", "accounts", graph.activeAccount.id],
        apiEnvironment(),
        resolverOptions(),
      );
    } finally {
      await served.close();
    }
    expect([api.exitCode, api.stderr]).toEqual([0, ""]);
    expect(api.stdout).toBe(local.stdout);

    const record = JSON.parse(local.stdout).data as Record<string, unknown>;
    expect(record.status).toBe("active");
    expect(Object.hasOwn(record, "providerSubjectRef")).toBe(false);
    expect(record.providerSubjectRefRedacted).toBe(true);

    for (const [mode, document] of [["local", local.stdout], ["api", api.stdout]] as const) {
      const documentPath = join(directory, `${mode}-account.json`);
      await Bun.write(documentPath, document);
      const validated = await runCli(["validate", documentPath, "--json"]);
      expect([mode, validated.exitCode, validated.stderr]).toEqual([mode, 0, ""]);
      expect(JSON.parse(validated.stdout).data).toEqual({ valid: true, documentKind: "account" });
    }
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

  test("refuses contradictory, implicit, relative, and unavailable deployment configuration", async () => {
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

    const missingSelfHostedApi = await runCli(["doctor", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    });
    expect(missingSelfHostedApi.exitCode).toBe(2);
    expect(JSON.parse(missingSelfHostedApi.stderr).error.code).toBe("VALIDATION_FAILED");

    const missingSelfHostedAuth = await runCli(["list", "access-methods", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
      HASNA_ACCOUNTS_CAPACITY_API_URL: "https://capacity.test",
    });
    expect(missingSelfHostedAuth.exitCode).toBe(2);
    expect(JSON.parse(missingSelfHostedAuth.stderr).error.code).toBe("VALIDATION_FAILED");
  });
});
