import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildExactBunAppsPlan,
  exactBunTargetPayload,
  executeExactBunTargetStatus,
  executeExactBunTargetTransaction,
  parseExactBunPackageProbe,
  resolveExactSourceOnce,
  runExactBunControllerStatus,
  runExactBunControllerTransaction,
} from "../src/commands/bun-registry-installer.js";
import type { MachineCommandRunner } from "../src/remote.js";
import type {
  ExactBunAppsStatusResult,
  ExactBunPackageProbe,
  ExactBunRegistryDeliveryV1,
  ExactBunRegistryPlanStep,
  ExactBunRegistrySourceRef,
  MachineManifest,
} from "../src/types.js";

const roots: string[] = [];
const sourceBytes = Buffer.from("export const exactInstallerFixture = true;\n", "utf8");
const source: ExactBunRegistrySourceRef = {
  provider: "files",
  ref: "asset_exact_bun_registry_fixture",
  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  sizeBytes: sourceBytes.byteLength,
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function delivery(order: 10 | 20, packageName: string, bin: string, archiveSha256: string, integrity: string): ExactBunRegistryDeliveryV1 {
  return {
    schema: "machines.exact_bun_registry.v1",
    order,
    mode: "live-global",
    source: { ...source },
    archiveSha256,
    registryIntegrity: integrity,
    secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"],
    quarantine: {
      minimumReleaseAge: 604800,
      exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"],
    },
    probe: { sdkImport: packageName, cli: { bin, args: ["--help"] } },
    rollback: "byte-preimage",
  };
}

function machineFixture(): MachineManifest {
  const root = mkdtempSync(join(tmpdir(), "machines-exact-bun-test-"));
  roots.push(root);
  const home = join(root, "private-home");
  const bunRoot = join(home, ".bun");
  const binRoot = join(bunRoot, "bin");
  mkdirSync(binRoot, { recursive: true });
  const bunPath = join(binRoot, "bun");
  writeFileSync(bunPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(binRoot, "unrelated-bin"), "unchanged\n", { mode: 0o755 });
  writeFileSync(join(home, ".bunfig.toml"), [
    "[install]",
    'registry = "https://registry.npmjs.org"',
    "minimumReleaseAge = 604800",
    'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"]',
    "",
  ].join("\n"));
  const globalRoot = join(bunRoot, "install", "global");
  writePackage(globalRoot, "@hasnaxyz/factory", "0.6.3");
  writePackage(globalRoot, "unrelated", "9.9.9");
  writeFileSync(join(globalRoot, "bun.lock"), "preimage-lock\n");

  return {
    id: "station-private-id",
    friendlyName: "private friendly name",
    sshAddress: "private-user@private-host",
    tailscaleName: "private-tailnet",
    platform: "linux",
    workspacePath: "/private/workspace/path",
    bunPath,
    metadata: { private_target_metadata: "must-not-escape" },
    packages: [
      {
        name: "@hasnaxyz/infinity",
        manager: "bun",
        version: "1.0.12",
        bin: "infinity",
        exactBunRegistry: delivery(
          10,
          "@hasnaxyz/infinity",
          "infinity",
          "09601425f753a053b3a55303448acd55da2acf1625916587f3e4f46c25af16d8",
          "sha512-Q0qujfbzuEpAaW3gManHgMnp9przdIxcqY2hzDrX1ZN9ssBbQS2Dx3lLhse7pUSLyZU0nxODZAdFKwWNAkRVVA==",
        ),
      },
      {
        name: "@hasnaxyz/factory",
        manager: "bun",
        version: "0.6.9",
        bin: "factory",
        exactBunRegistry: delivery(
          20,
          "@hasnaxyz/factory",
          "factory",
          "d7452f2903738761b33450bfdaeadda9631d140ed29eafee4cc3a482380a3d70",
          "sha512-Up6mD2fYBFPlrOkqpEngaDk3ANKiM4wMr8ikCd/widCXNZpOu8SNwbIvzP7QP2lqymdFzhLrUY1Izh1Qo24fFA==",
        ),
      },
    ],
  };
}

function machinesSelfUpgradeFixture(): MachineManifest {
  const machine = machineFixture();
  machine.packages = [
    {
      name: "@hasna/machines",
      manager: "bun",
      version: "0.2.20",
      bin: "machines",
      exactBunRegistry: delivery(
        10,
        "@hasna/machines",
        "machines",
        "6".repeat(64),
        "sha512-OjF8N2Y5ZThmZTc2NzA4MjU0N2M1NWI2NzUxY2UwM2I3YTY5OTM4MDIxODQ2ZDUwNzg2ZTQ5NzE3Zg==",
      ),
    },
  ];
  return machine;
}

function globalRoot(machine: MachineManifest): string {
  return join(machine.bunPath!, "..", "..", "install", "global");
}

function writePackage(root: string, name: string, version: string): void {
  const directory = join(root, "node_modules", ...name.split("/"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name, version })}\n`);
}

function writeRegistryLock(root: string, steps: ExactBunRegistryPlanStep[]): void {
  writeFileSync(join(root, "bun.lock"), `${steps.map((step) => [
    step.package.name,
    step.package.version,
    step.package.registryIntegrity,
  ].join(" ")).join("\n")}\n`);
}

function readVersion(root: string, name: string): string | null {
  const path = join(root, "node_modules", ...name.split("/"), "package.json");
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

function probe(step: ExactBunRegistryPlanStep, observedVersion = step.package.version): ExactBunPackageProbe {
  return {
    schema: "machines.bun_package_probe.v1",
    package: step.package.name,
    expectedVersion: step.package.version,
    observedVersion,
    installed: true,
    checks: {
      packageJson: { ok: true, version: step.package.version },
      registryProvenance: { ok: true, integrity: step.package.registryIntegrity, lockSource: "registry" },
      sdkImport: { ok: true },
      cliHelp: { ok: true, bin: step.package.bin, exitCode: 0 },
    },
    status: "pass",
    reasonCodes: [],
  };
}

describe("exact Bun registry plan", () => {
  test("builds exactly two ordered safe steps and resolves one verified source", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    expect(plan.schema).toBe("machines.apps.plan.v2");
    expect(plan.steps.map((step) => [step.order, step.package.selector])).toEqual([
      [10, "@hasnaxyz/infinity@1.0.12"],
      [20, "@hasnaxyz/factory@0.6.9"],
    ]);
    let loads = 0;
    expect(resolveExactSourceOnce(plan.steps, () => { loads += 1; return sourceBytes; })).toEqual(sourceBytes);
    expect(loads).toBe(1);

    const serialized = JSON.stringify(plan);
    for (const privateValue of [
      machine.bunPath!, machine.workspacePath, machine.sshAddress!, machine.tailscaleName!, "private friendly name", "must-not-escape",
    ]) expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain(sourceBytes.toString("base64"));
    expect(serialized).not.toContain('"command"');
    expect(serialized).not.toContain("publish-token");
    expect(JSON.stringify(exactBunTargetPayload(machine, plan))).not.toContain("publish-token");
  });

  test("builds and executes one exact Machines self-upgrade step", () => {
    const machine = machinesSelfUpgradeFixture();
    const plan = buildExactBunAppsPlan(machine);
    expect(plan.steps.map((step) => [step.order, step.package.selector])).toEqual([
      [10, "@hasna/machines@0.2.20"],
    ]);

    const payload = exactBunTargetPayload(machine, plan);
    expect(() => executeExactBunTargetStatus(payload)).toThrow("quarantine_exclusions_mismatch");

    const bunfig = join(machine.bunPath!, "..", "..", "..", ".bunfig.toml");
    writeFileSync(bunfig, [
      "[install]",
      'registry = "https://registry.npmjs.org"',
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events", "@hasna/machines"]',
      "",
    ].join("\n"));

    const selectors: string[] = [];
    const result = executeExactBunTargetTransaction(payload, sourceBytes, {
      temporaryRoot: roots[roots.length - 1],
      runSource(_command, env) {
        selectors.push(env["HASNA_MACHINES_EXACT_BUN_SELECTOR"]!);
        const step = plan.steps[0]!;
        writePackage(globalRoot(machine), step.package.name, step.package.version);
        writeRegistryLock(globalRoot(machine), [step]);
        return { status: 0, stdout: JSON.stringify(probe(step)), stderr: "" };
      },
    });

    expect(result.state).toBe("COMMITTED");
    expect(result.executed).toBe(1);
    expect(selectors).toEqual(["@hasna/machines@0.2.20"]);

    const wrongOrder = exactBunTargetPayload(machine, plan);
    wrongOrder.steps[0]!.order = 20;
    expect(() => executeExactBunTargetStatus(wrongOrder)).toThrow("transaction_step_mismatch");

    const mixedTransaction = exactBunTargetPayload(machine, plan);
    mixedTransaction.steps.push(buildExactBunAppsPlan(machineFixture()).steps[1]!);
    expect(() => executeExactBunTargetStatus(mixedTransaction)).toThrow("transaction_step_mismatch");
  });

  test("keeps Infinity before Factory when the target step contract is generalized", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    expect(plan.steps.map((step) => [step.order, step.package.name])).toEqual([
      [10, "@hasnaxyz/infinity"],
      [20, "@hasnaxyz/factory"],
    ]);

    const reversed = exactBunTargetPayload(machine, plan);
    reversed.steps.reverse();
    expect(() => executeExactBunTargetStatus(reversed)).toThrow("transaction_step_mismatch");

    const factoryOnly = exactBunTargetPayload(machine, plan);
    factoryOnly.steps = [plan.steps[1]!];
    expect(() => executeExactBunTargetStatus(factoryOnly)).not.toThrow();
  });

  test("uses a bounded controller bootstrap without candidate target commands and fails before source when unavailable", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const bootstrap = Buffer.from("// reviewed bootstrap fixture\n");
    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command, options) => {
      calls.push(command);
      expect(command).toBe(`'${machine.bunPath}' run -`);
      expect(options?.stdin).toBeInstanceOf(Buffer);
      expect(String(options?.stdin)).toContain("machines.exact_bun_bootstrap.v1");
      expect(String(options?.stdin)).not.toContain("apps exact-bun-status");
      expect(String(options?.stdin)).not.toContain("apps exact-bun-transaction");
      return {
        machineId,
        source: "ssh",
        stdout: JSON.stringify({
          schema: "machines.exact_bun_transaction_result.v1",
          machineId,
          platform: "linux",
          state: "COMMITTED",
          executed: plan.steps.length,
          probes: plan.steps.map((step) => probe(step)),
          reasonCodes: [],
        }),
        stderr: "",
        exitCode: 0,
      };
    };

    const status = runExactBunControllerStatus(machine, plan, runner, () => bootstrap);
    expect(status.result.probes).toHaveLength(2);

    let sourceLoads = 0;
    const transaction = runExactBunControllerTransaction(
      machine,
      plan,
      () => { sourceLoads += 1; return sourceBytes; },
      runner,
      () => bootstrap,
    );
    expect(transaction.state).toBe("COMMITTED");
    expect(sourceLoads).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls.every((command) => !command.includes("apps exact-bun-"))).toBe(true);

    sourceLoads = 0;
    expect(() => runExactBunControllerTransaction(
      machine,
      plan,
      () => { sourceLoads += 1; return sourceBytes; },
      runner,
      () => { throw new Error("missing"); },
    )).toThrow("exact_bun_bootstrap_unavailable");
    expect(sourceLoads).toBe(0);
    expect(calls).toHaveLength(2);
  });

  test("consumes exact installed-state proof and replans to zero mutation steps", () => {
    const machine = machineFixture();
    const initial = buildExactBunAppsPlan(machine);
    const installedState: ExactBunAppsStatusResult = {
      schema: "machines.apps.status.v2",
      machineId: machine.id,
      platform: "linux",
      source: "ssh",
      packages: initial.steps.map((step) => probe(step)),
      status: "pass",
      reasonCodes: [],
    };

    const outdatedFactory = structuredClone(installedState);
    outdatedFactory.status = "unmanaged";
    outdatedFactory.packages[1]!.observedVersion = "0.6.8";
    outdatedFactory.packages[1]!.checks.packageJson = { ok: false, version: "0.6.8" };
    outdatedFactory.packages[1]!.status = "fail";
    outdatedFactory.packages[1]!.reasonCodes = ["installed_version_mismatch"];
    const oneStep = buildExactBunAppsPlan(machine, outdatedFactory);
    expect(oneStep.steps).toEqual([initial.steps[1]]);
    expect(oneStep.planDigest).not.toBe(initial.planDigest);

    const replanned = buildExactBunAppsPlan(machine, installedState);
    expect(replanned.steps).toEqual([]);
    expect(replanned.probes).toEqual(installedState.packages);
    expect(replanned.planDigest).not.toBe(oneStep.planDigest);
    expect(replanned.planDigest).not.toBe(initial.planDigest);
    console.info(`REPLAN_CONTROL steps_before=${oneStep.steps.length} steps_after=${replanned.steps.length} digest_equal=${replanned.planDigest === oneStep.planDigest}`);
  });

  test("fails closed on source hash mismatch", () => {
    const plan = buildExactBunAppsPlan(machineFixture());
    expect(() => resolveExactSourceOnce(plan.steps, () => Buffer.from("wrong"))).toThrow("source_size_mismatch");
    const sameSizeWrong = Buffer.alloc(sourceBytes.byteLength, 120);
    expect(() => resolveExactSourceOnce(plan.steps, () => sameSizeWrong)).toThrow("source_sha256_mismatch");
  });

  test("strict probes reject extra output and version mismatches", () => {
    const step = buildExactBunAppsPlan(machineFixture()).steps[0]!;
    expect(() => parseExactBunPackageProbe(`${JSON.stringify(probe(step))}\nextra`, step)).toThrow("probe_not_single_json_object");
    expect(() => parseExactBunPackageProbe(JSON.stringify(probe(step, "1.0.11")), step)).toThrow("probe_version_mismatch");
  });

  test("strict probes reject every unexpected nested key before public serialization", () => {
    const step = buildExactBunAppsPlan(machineFixture()).steps[0]!;
    const cases = [
      ["packageJson", "probe_package_json_keys_mismatch"],
      ["registryProvenance", "probe_registry_provenance_keys_mismatch"],
      ["sdkImport", "probe_sdk_import_keys_mismatch"],
      ["cliHelp", "probe_cli_help_keys_mismatch"],
    ] as const;

    for (const [nestedKey, expectedError] of cases) {
      const candidate = structuredClone(probe(step)) as ExactBunPackageProbe & {
        checks: Record<string, Record<string, unknown>>;
      };
      candidate.checks[nestedKey]!["privateMetadataSentinel"] = "must-not-serialize";
      expect(() => parseExactBunPackageProbe(JSON.stringify(candidate), step)).toThrow(expectedError);
    }
    console.info(`NESTED_PROBE_CONTROL keys=${cases.map(([key]) => key).join(",")} rejected=${cases.length} serialized_sentinel=absent`);
  });
});

describe("exact Bun target transaction", () => {
  test("runs SDK probes from the global install root", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const root = globalRoot(machine);
    for (const step of plan.steps) {
      writePackage(root, step.package.name, step.package.version);
      writeFileSync(join(dirname(machine.bunPath!), step.package.bin), [
        "#!/bin/sh",
        '[ -z "${HASNA_TEST_API_KEY+x}" ] || exit 90',
        `[ "$PATH" = ${JSON.stringify(dirname(machine.bunPath!))} ] || exit 91`,
        "exit 0",
        "",
      ].join("\n"), { mode: 0o755 });
    }
    writeRegistryLock(root, plan.steps);
    writeFileSync(machine.bunPath!, [
      "#!/bin/sh",
      `[ "$PWD" = ${JSON.stringify(root)} ] || exit 88`,
      '[ -z "${HASNA_TEST_API_KEY+x}" ] || exit 89',
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 });

    const wrongCwd = spawnSync(machine.bunPath!, ["-e", "import('@hasnaxyz/infinity')"], {
      cwd: dirname(root),
    });
    expect(wrongCwd.status).toBe(88);

    const previousSentinel = process.env["HASNA_TEST_API_KEY"];
    process.env["HASNA_TEST_API_KEY"] = "non-secret-test-sentinel";
    try {
      const result = executeExactBunTargetStatus(exactBunTargetPayload(machine, plan));
      expect(result.probes).toHaveLength(2);
      expect(result.probes.every((entry) => entry.status === "pass")).toBe(true);
    } finally {
      if (previousSentinel === undefined) delete process.env["HASNA_TEST_API_KEY"];
      else process.env["HASNA_TEST_API_KEY"] = previousSentinel;
    }
  });

  test("does not execute SDK code before package and registry provenance are proven", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const step = plan.steps[0]!;
    const payload = exactBunTargetPayload(machine, plan);
    payload.steps = [step];
    const root = globalRoot(machine);
    const sdkMarker = join(roots[roots.length - 1]!, "sdk-import-executed");
    const cliMarker = join(roots[roots.length - 1]!, "cli-help-executed");
    writeFileSync(
      join(dirname(machine.bunPath!), step.package.bin),
      `#!/bin/sh\n: > ${JSON.stringify(cliMarker)}\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(machine.bunPath!, `#!/bin/sh\n: > ${JSON.stringify(sdkMarker)}\nexit 0\n`, { mode: 0o755 });

    writePackage(root, step.package.name, "0.0.0");
    writeRegistryLock(root, [step]);
    const wrongPackage = executeExactBunTargetStatus(payload).probes[0]!;
    expect(wrongPackage.checks.packageJson.ok).toBe(false);
    expect(wrongPackage.checks.registryProvenance.ok).toBe(true);
    expect(wrongPackage.checks.sdkImport.ok).toBe(false);
    expect(wrongPackage.checks.cliHelp.ok).toBe(false);
    expect(existsSync(sdkMarker)).toBe(false);
    expect(existsSync(cliMarker)).toBe(false);

    writePackage(root, step.package.name, step.package.version);
    writeFileSync(join(root, "bun.lock"), "unproven-registry-lock\n");
    const wrongRegistry = executeExactBunTargetStatus(payload).probes[0]!;
    expect(wrongRegistry.checks.packageJson.ok).toBe(true);
    expect(wrongRegistry.checks.registryProvenance.ok).toBe(false);
    expect(wrongRegistry.checks.sdkImport.ok).toBe(false);
    expect(wrongRegistry.checks.cliHelp.ok).toBe(false);
    expect(existsSync(sdkMarker)).toBe(false);
    expect(existsSync(cliMarker)).toBe(false);
  });

  test("accepts a quarantine exclusion superset and rejects any missing required entry", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const bunfig = join(machine.bunPath!, "..", "..", "..", ".bunfig.toml");
    writeFileSync(bunfig, [
      "[install]",
      'registry = "https://registry.npmjs.org"',
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events", "@hasna/machines", "@hasna/contracts"]',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetStatus(exactBunTargetPayload(machine, plan))).not.toThrow();

    writeFileSync(bunfig, [
      "[install]",
      'registry = "https://registry.npmjs.org"',
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/machines", "@hasna/contracts"]',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetStatus(exactBunTargetPayload(machine, plan))).toThrow("quarantine_exclusions_mismatch");
  });

  test("accepts the omitted default registry and rejects an explicit alternate registry", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const bunfig = join(machine.bunPath!, "..", "..", "..", ".bunfig.toml");
    writeFileSync(bunfig, [
      "[install]",
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"]',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetStatus(exactBunTargetPayload(machine, plan))).not.toThrow();

    writeFileSync(bunfig, [
      "[install]",
      'registry = "https://registry.example.invalid"',
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"]',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetStatus(exactBunTargetPayload(machine, plan))).toThrow("registry_mismatch");

    writeFileSync(bunfig, [
      "[install]",
      "minimumReleaseAge = 604800",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"]',
      "[install.scopes]",
      'hasnaxyz = "https://registry.example.invalid"',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetStatus(exactBunTargetPayload(machine, plan))).toThrow("registry_mismatch");
  });

  test("runs one selector per ordered step through nested Secrets references", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const payload = exactBunTargetPayload(machine, plan);
    const selectors: string[] = [];
    const commands: string[] = [];
    const result = executeExactBunTargetTransaction(payload, sourceBytes, {
      temporaryRoot: roots[roots.length - 1],
      runSource(command, env) {
        commands.push(command);
        selectors.push(env["HASNA_MACHINES_EXACT_BUN_SELECTOR"]!);
        const step = plan.steps[selectors.length - 1]!;
        writePackage(globalRoot(machine), step.package.name, step.package.version);
        writeRegistryLock(globalRoot(machine), plan.steps.slice(0, selectors.length));
        return { status: 0, stdout: JSON.stringify(probe(step)), stderr: "" };
      },
    });
    expect(result.state).toBe("COMMITTED");
    expect(result.executed).toBe(2);
    expect(selectors).toEqual(["@hasnaxyz/infinity@1.0.12", "@hasnaxyz/factory@0.6.9"]);
    expect(commands.every((command) => command.includes("secrets exec") && command.includes("hasna/npm/live/publish-token") && command.includes("hasnaxyz/npm/live/publish-token"))).toBe(true);
    expect(commands.every((command) => !command.includes(sourceBytes.toString("base64")))).toBe(true);
  });

  test("runs the source from a cwd holding a placeholder npmrc bun can authenticate with", () => {
    // O15-00346: the tokens are delivered to HASNA_NPM_PUBLISH_TOKEN /
    // HASNAXYZ_NPM_PUBLISH_TOKEN env vars, which bun never reads for registry
    // auth (bun reads .npmrc _authToken entries with ${NAME} expansion and
    // BUN_CONFIG_TOKEN / NPM_CONFIG_TOKEN). Without a bun-readable surface,
    // fresh-machine global installs of private-scope packages
    // (@hasnaxyz/infinity, @hasnaxyz/factory) cannot fetch the tarball, and on
    // macOS the clonefile install step fails with "failed opening
    // cache/package/version dir for package @hasnaxyz/infinity".
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const payload = exactBunTargetPayload(machine, plan);
    const runCwd: string[] = [];
    const result = executeExactBunTargetTransaction(payload, sourceBytes, {
      temporaryRoot: roots[roots.length - 1],
      runSource(_command, _env, cwd) {
        // The npmrc must exist at RUN time — the transaction deletes its temp
        // root on exit, so assert inside the run.
        const npmrcPath = join(cwd ?? "", ".npmrc");
        expect(existsSync(npmrcPath)).toBe(true);
        const content = readFileSync(npmrcPath, "utf8");
        expect(content).toContain("//registry.npmjs.org/:_authToken=${HASNA_NPM_PUBLISH_TOKEN}");
        expect(content).toContain("//registry.npmjs.org/@hasnaxyz/:_authToken=${HASNAXYZ_NPM_PUBLISH_TOKEN}");
        // placeholder text only — a captured token value must never reach the file
        expect(content).not.toMatch(/npm_[A-Za-z0-9]{20,}/);
        expect(statSync(npmrcPath).mode & 0o777).toBe(0o600);
        runCwd.push(cwd ?? "");
        const step = plan.steps[runCwd.length - 1]!;
        writePackage(globalRoot(machine), step.package.name, step.package.version);
        writeRegistryLock(globalRoot(machine), plan.steps.slice(0, runCwd.length));
        return { status: 0, stdout: JSON.stringify(probe(step)), stderr: "" };
      },
    });
    expect(result.state).toBe("COMMITTED");
    expect(runCwd).toHaveLength(2);
    expect(runCwd[1]).toBe(runCwd[0]);
  });

  test("rejects a wrong Bun path before execution", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const missingSecret = exactBunTargetPayload(machine, plan);
    const wrongPath = exactBunTargetPayload(machine, plan);
    wrongPath.bunPath = join(roots[roots.length - 1]!, "missing", "bin", "bun");
    expect(() => executeExactBunTargetTransaction(wrongPath, sourceBytes)).toThrow("bun_path_not_executable");

    const wrongShape = exactBunTargetPayload(machine, plan);
    wrongShape.bunPath = "/bin/sh";
    expect(() => executeExactBunTargetTransaction(wrongShape, sourceBytes)).toThrow("bun_path_not_executable");
  });

  test("rejects quarantine age and exact-exclusion drift", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const bunfig = join(machine.bunPath!, "..", "..", "..", ".bunfig.toml");
    writeFileSync(bunfig, [
      "[install]",
      'registry = "https://registry.npmjs.org"',
      "minimumReleaseAge = 0",
      'minimumReleaseAgeExcludes = ["@hasnaxyz/infinity"]',
      "",
    ].join("\n"));
    expect(() => executeExactBunTargetTransaction(exactBunTargetPayload(machine, plan), sourceBytes)).toThrow("quarantine_age_mismatch");
  });

  test("restores the complete byte preimage when step two reports the wrong version", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const root = globalRoot(machine);
    const bunfig = join(machine.bunPath!, "..", "..", "..", ".bunfig.toml");
    const preBunfig = readFileSync(bunfig);
    const preBin = readFileSync(join(machine.bunPath!, "..", "unrelated-bin"));
    let call = 0;
    const result = executeExactBunTargetTransaction(exactBunTargetPayload(machine, plan), sourceBytes, {
      temporaryRoot: roots[roots.length - 1],
      runSource(_command, _env) {
        const step = plan.steps[call++]!;
        writePackage(root, step.package.name, step.package.version);
        writeRegistryLock(root, plan.steps.slice(0, call));
        if (call === 2) writeFileSync(join(machine.bunPath!, "..", "unrelated-bin"), "mutated\n");
        return { status: 0, stdout: JSON.stringify(probe(step, call === 2 ? "0.0.0" : step.package.version)), stderr: "" };
      },
    });
    expect(result.state).toBe("ROLLED_BACK");
    expect(result.reasonCodes).toEqual(["probe_version_mismatch"]);
    expect(readVersion(root, "@hasnaxyz/infinity")).toBeNull();
    expect(readVersion(root, "@hasnaxyz/factory")).toBe("0.6.3");
    expect(readVersion(root, "unrelated")).toBe("9.9.9");
    expect(readFileSync(bunfig)).toEqual(preBunfig);
    expect(readFileSync(join(machine.bunPath!, "..", "unrelated-bin"))).toEqual(preBin);
  });

  test("rolls back when the source emits non-structured stderr", () => {
    const machine = machineFixture();
    const plan = buildExactBunAppsPlan(machine);
    const root = globalRoot(machine);
    const result = executeExactBunTargetTransaction(exactBunTargetPayload(machine, plan), sourceBytes, {
      temporaryRoot: roots[roots.length - 1],
      runSource(_command, _env) {
        const step = plan.steps[0]!;
        writePackage(root, step.package.name, step.package.version);
        writeRegistryLock(root, [step]);
        return { status: 0, stdout: JSON.stringify(probe(step)), stderr: "unexpected diagnostic\n" };
      },
    });
    expect(result.state).toBe("ROLLED_BACK");
    expect(result.reasonCodes).toEqual(["source_stderr_not_empty:10"]);
    expect(readVersion(root, "@hasnaxyz/infinity")).toBeNull();
    expect(readVersion(root, "@hasnaxyz/factory")).toBe("0.6.3");
  });
});
