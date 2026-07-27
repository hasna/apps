import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
  PACKAGE_VERSION,
  canonicalJson,
  newAccessMethodId,
  newEligibilityEvidenceId,
  parseCounter,
  serializeRecordEnvelope,
} from "../../src/index";
import { runAccountsCli } from "../../src/cli";
import { CREATED_AT, FUTURE, digest, makeFixtureGraph } from "../fixtures";

const TEMP_ROOT = mkdtempSync(join(tmpdir(), "capacity-cli-tests-"));
chmodSync(TEMP_ROOT, 0o700);
const cleanup: string[] = [];
const ORIGINAL_FETCH = globalThis.fetch;
const CLI_ENV_KEYS = [
  "HASNA_ACCOUNTS_DEPLOYMENT",
  "HASNA_ACCOUNTS_DATABASE_PATH",
  "HASNA_ACCOUNTS_CAPACITY_API_URL",
  "HASNA_ACCOUNTS_CAPACITY_AUTH_REF",
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
    HASNA_ACCOUNTS_CAPACITY_AUTH_REF: "capacity-client-reference",
  };
}

async function runCliInProcess(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
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
    const exitCode = await runAccountsCli(args);
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
    expect(request.headers.get("authorization")).toBe("Bearer capacity-client-reference");
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
