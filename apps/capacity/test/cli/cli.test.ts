import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
  PACKAGE_VERSION,
  canonicalJson,
  newAccessMethodId,
  parseCounter,
  serializeRecordEnvelope,
} from "../../src/index";
import { makeFixtureGraph } from "../fixtures";

const TEMP_ROOT = join(import.meta.dir, "..", "..", ".tmp", "cli-tests");
mkdirSync(TEMP_ROOT, { recursive: true, mode: 0o700 });
chmodSync(join(import.meta.dir, "..", "..", ".tmp"), 0o700);
chmodSync(TEMP_ROOT, 0o700);
const cleanup: string[] = [];

afterAll(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
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

    const reserved = await runCli(["doctor", "--json"], {
      HASNA_ACCOUNTS_DEPLOYMENT: "self_hosted",
    });
    expect(reserved.exitCode).toBe(6);
    expect(JSON.parse(reserved.stderr).error.code).toBe("NOT_IMPLEMENTED");
  });
});
