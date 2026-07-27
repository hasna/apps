import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import { makeFixtureGraph } from "../fixtures";
import { runAccountsCli } from "../../src/cli";

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
    const exitCode = await runAccountsCli(args);
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

function apiEnvironment(): Record<string, string> {
  return {
    HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    HASNA_ACCOUNTS_CAPACITY_API_URL: "https://capacity.test",
    HASNA_ACCOUNTS_CAPACITY_AUTH_REF: "capacity-cli-auth-reference",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(canonicalJson(body), {
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

  test("self-hosted doctor, list, get, and eligibility use the HTTP API path", async () => {
    const graph = makeFixtureGraph("api_key");
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
      expect(headers.get("authorization")).toBe("Bearer capacity-cli-auth-reference");
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

    const doctor = await runCliInProcess(["doctor", "--json"], apiEnvironment());
    expect(doctor.exitCode).toBe(0);
    expect(JSON.parse(doctor.stdout).data).toEqual({
      adapter: "http",
      health: "ok",
      readiness: "ready",
      version: "1.0.0-test",
      contractSha256: "a".repeat(64),
    });

    const list = await runCliInProcess(["list", "access-methods", "--json"], apiEnvironment());
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).data.records).toEqual([
      { schemaVersion: "accounts.capacity.v1", kind: "access_method", data: graph.method },
    ]);

    const get = await runCliInProcess(["get", "access-methods", graph.method.id, "--json"], apiEnvironment());
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
    ], apiEnvironment());
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
