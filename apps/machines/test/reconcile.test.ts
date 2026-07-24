import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DISTRIBUTION_EVENT_TYPES,
  buildRolloutRecord,
  defaultAppIdForPackage,
} from "../src/distribution.js";
import {
  buildReconcilePlan,
  defaultBinForPackage,
  executeReconcilePlan,
  parseBunGlobalList,
  readRolloutRecords,
  reconcileFromReleaseEvent,
  releaseEventTrigger,
  resolveDesiredPackages,
  type ExecFn,
  type ExecResult,
  type RolloutEmitInput,
} from "../src/commands/reconcile.js";
import type { FleetManifest } from "../src/types.js";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = join(repoRoot, "src", "cli", "index.ts");

// Hermetic freeze.json path: in-memory manifests now merge the on-disk freeze
// gate, so unit tests point it at an empty temp file instead of the machine's
// real freeze.json.
const emptyFreezePath = join(mkdtempSync(join(tmpdir(), "machines-reconcile-freeze-")), "freeze.json");

function manifestFixture(): FleetManifest {
  return {
    version: 1,
    packages: [
      { name: "@hasna/todos", version: "1.2.3" },
      { name: "@hasna/events", version: "0.2.0", bin: "hasna-events", mcpHealthUrl: "http://127.0.0.1:9999/health" },
      { name: "@hasna/knowledge" },
    ],
    freeze: [
      { name: "@hasna/frozen-pkg", reason: "supply-chain incident #42" },
    ],
    machines: [
      {
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "~/workspace",
        packages: [
          { name: "@hasna/todos", version: "2.0.0" },
          { name: "left-pad", version: "1.3.0" },
          { name: "brew-only", manager: "brew", version: "1.0.0" },
        ],
      },
    ],
  };
}

interface ExecCall {
  command: string;
  args: string[];
}

function mockExec(handler: (command: string, args: string[]) => Partial<ExecResult> | undefined): { exec: ExecFn; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    const result = handler(command, args) ?? {};
    return { status: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { exec, calls };
}

function collectEmitter() {
  const events: RolloutEmitInput[] = [];
  return {
    events,
    emitter: {
      emit(input: RolloutEmitInput) {
        events.push(input);
        return Promise.resolve({ ok: true });
      },
    },
  };
}

describe("distribution mirrors", () => {
  test("derives appIds aligned with the open- repo convention", () => {
    expect(defaultAppIdForPackage("@hasna/todos")).toBe("open-todos");
    expect(defaultAppIdForPackage("@hasna/open-chrome")).toBe("open-chrome");
    expect(defaultAppIdForPackage("left-pad")).toBe("left-pad");
    expect(defaultAppIdForPackage("@scope/Weird_Name")).toBe("weird-name");
  });

  test("enforces rollout record coupling rules", () => {
    expect(() => buildRolloutRecord({
      package: "@hasna/todos",
      version: "1.0.0",
      machine: "demo",
      action: "freeze-blocked",
      result: "succeeded",
    })).toThrow(/blocked or skipped/);

    expect(() => buildRolloutRecord({
      package: "@hasna/todos",
      version: "1.0.0",
      machine: "demo",
      action: "install",
      result: "succeeded",
    })).toThrow(/verifiedBy/);

    const record = buildRolloutRecord({
      package: "@hasna/todos",
      version: "1.0.0",
      machine: "demo",
      action: "update",
      result: "succeeded",
      verifiedBy: { cliVersion: "1.0.0", mcpHealth: "not_checked" },
    });
    expect(record.schema).toBe("hasna.rollout_record.v1");
    expect(record.appId).toBe("open-todos");
    expect(record.evidenceRefs).toEqual([]);
  });
});

describe("desired state and installed parsing", () => {
  test("parses bun pm ls -g output including scoped packages", () => {
    const output = [
      "/home/user/.bun/install/global node_modules (4)",
      "├── @hasna/todos@1.2.3",
      "├── @hasna/events@0.2.0",
      "├── left-pad@1.3.0",
      "└── chalk@5.6.2",
      "",
    ].join("\n");
    expect(parseBunGlobalList(output)).toEqual([
      { name: "@hasna/todos", version: "1.2.3" },
      { name: "@hasna/events", version: "0.2.0" },
      { name: "left-pad", version: "1.3.0" },
      { name: "chalk", version: "5.6.2" },
    ]);
  });

  test("merges fleet packages with per-machine overrides and filters non-bun managers", () => {
    const desired = resolveDesiredPackages(manifestFixture(), "demo-node-01");
    expect(desired.map((entry) => entry.name)).toEqual([
      "@hasna/events",
      "@hasna/knowledge",
      "@hasna/todos",
      "left-pad",
    ]);
    const todos = desired.find((entry) => entry.name === "@hasna/todos")!;
    expect(todos.version).toBe("2.0.0");
    expect(todos.appId).toBe("open-todos");
    expect(todos.bin).toBe("todos");
    const events = desired.find((entry) => entry.name === "@hasna/events")!;
    expect(events.bin).toBe("hasna-events");
    expect(events.mcpHealthUrl).toBe("http://127.0.0.1:9999/health");
    expect(defaultBinForPackage("@hasna/machines")).toBe("machines");
  });
});

describe("reconcile plan", () => {
  test("plans install, update, skip, and freeze-blocked actions", () => {
    const manifest = manifestFixture();
    manifest.packages!.push({ name: "@hasna/frozen-pkg", version: "9.9.9" });
    const plan = buildReconcilePlan({
      manifest,
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [
        { name: "@hasna/todos", version: "1.2.3" },
        { name: "@hasna/events", version: "0.2.0" },
        { name: "@hasna/frozen-pkg", version: "1.0.0" },
      ],
      now: new Date("2026-07-06T00:00:00.000Z"),
    });
    const byName = new Map(plan.actions.map((action) => [action.package, action]));
    expect(byName.get("@hasna/todos")?.action).toBe("update");
    expect(byName.get("@hasna/events")?.action).toBe("skip");
    expect(byName.get("@hasna/events")?.reason).toBe("up-to-date");
    expect(byName.get("@hasna/knowledge")?.action).toBe("skip");
    expect(byName.get("@hasna/knowledge")?.reason).toContain("unpinned");
    expect(byName.get("left-pad")?.action).toBe("install");
    expect(byName.get("@hasna/frozen-pkg")?.action).toBe("freeze-blocked");
    expect(byName.get("@hasna/frozen-pkg")?.reason).toContain("supply-chain incident #42");
    expect(byName.has("brew-only")).toBe(false);
  });

  test("expired freeze entries no longer block", () => {
    const manifest = manifestFixture();
    manifest.freeze = [{ name: "@hasna/todos", reason: "old incident", until: "2026-01-01T00:00:00.000Z" }];
    const plan = buildReconcilePlan({
      manifest,
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [],
      now: new Date("2026-07-06T00:00:00.000Z"),
    });
    expect(plan.actions.find((action) => action.package === "@hasna/todos")?.action).toBe("install");
  });

  test("on-disk freeze.json still blocks when an in-memory manifest is provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-reconcile-disk-freeze-"));
    const freezePath = join(dir, "freeze.json");
    writeFileSync(freezePath, `${JSON.stringify({
      version: 1,
      packages: [{ name: "left-pad", reason: "operator freeze via machines freeze add" }],
    })}\n`, "utf8");
    const plan = buildReconcilePlan({
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath,
      installed: [],
      now: new Date("2026-07-06T00:00:00.000Z"),
    });
    const leftPad = plan.actions.find((action) => action.package === "left-pad");
    expect(leftPad?.action).toBe("freeze-blocked");
    expect(leftPad?.reason).toContain("operator freeze");
  });

  test("unpinned packages adopt release.published event versions", () => {
    const plan = buildReconcilePlan({
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [{ name: "@hasna/knowledge", version: "0.9.0" }],
      packageFilter: "@hasna/knowledge",
      eventVersions: { "@hasna/knowledge": "1.0.0" },
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      package: "@hasna/knowledge",
      action: "update",
      desiredVersion: "1.0.0",
      installedVersion: "0.9.0",
    });
  });
});

describe("reconcile execution", () => {
  test("dry-run never executes commands and reports pending statuses", async () => {
    const { exec, calls } = mockExec(() => ({ status: 1 }));
    const plan = buildReconcilePlan({
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [],
    });
    const result = await executeReconcilePlan(plan, { dryRun: true, exec, recordsPath: null });
    expect(result.mode).toBe("dry-run");
    expect(calls).toHaveLength(0);
    expect(result.records).toHaveLength(0);
    expect(result.results.find((entry) => entry.package === "@hasna/todos")?.status).toBe("pending");
  });

  test("applies install/update, verifies, emits rollout records, and persists them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-reconcile-apply-"));
    const recordsPath = join(dir, "rollout-records.jsonl");
    const { exec, calls } = mockExec((command, args) => {
      if (command === "bun" && args[0] === "install") return { status: 0 };
      if (args[0] === "--version") {
        if (command === "todos") return { status: 0, stdout: "2.0.0\n" };
        if (command === "left-pad") return { status: 0, stdout: "left-pad v1.3.0\n" };
      }
      return { status: 1, stderr: "unexpected call" };
    });
    const { emitter, events } = collectEmitter();
    const plan = buildReconcilePlan({
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [
        { name: "@hasna/todos", version: "1.2.3" },
        { name: "@hasna/events", version: "0.2.0" },
      ],
      packageFilter: undefined,
    });
    const filtered = { ...plan, actions: plan.actions.filter((action) => action.package !== "@hasna/knowledge" && action.package !== "@hasna/events") };
    const result = await executeReconcilePlan(filtered, {
      dryRun: false,
      exec,
      emitter,
      recordsPath,
    });

    expect(result.mode).toBe("apply");
    const todos = result.results.find((entry) => entry.package === "@hasna/todos")!;
    expect(todos.status).toBe("succeeded");
    expect(todos.verifiedBy).toEqual({ cliVersion: "2.0.0", mcpHealth: "not_checked" });
    const leftPad = result.results.find((entry) => entry.package === "left-pad")!;
    expect(leftPad.status).toBe("succeeded");

    expect(calls.some((call) => call.command === "bun" && call.args.join(" ") === "install -g @hasna/todos@2.0.0")).toBe(true);
    expect(calls.some((call) => call.command === "bun" && call.args.join(" ") === "install -g left-pad@1.3.0")).toBe(true);

    const types = events.map((event) => event.type);
    expect(types).toContain(DISTRIBUTION_EVENT_TYPES.rolloutStarted);
    expect(types).toContain(DISTRIBUTION_EVENT_TYPES.rolloutCompleted);
    expect(types).toContain(DISTRIBUTION_EVENT_TYPES.appInstalled);
    const completed = events.find((event) => event.type === DISTRIBUTION_EVENT_TYPES.rolloutCompleted)!;
    expect(completed.data).toMatchObject({
      appId: "open-todos",
      package: "@hasna/todos",
      version: "2.0.0",
      machine: "demo-node-01",
      action: "update",
      result: "succeeded",
    });

    const persisted = readRolloutRecords(recordsPath);
    expect(persisted).toHaveLength(2);
    expect(persisted.every((record) => record.schema === "hasna.rollout_record.v1")).toBe(true);
  });

  test("rolls back to the prior version when verification fails", async () => {
    const { exec, calls } = mockExec((command, args) => {
      if (command === "bun" && args[0] === "install") return { status: 0 };
      if (command === "todos" && args[0] === "--version") return { status: 0, stdout: "1.2.3\n" };
      return { status: 1 };
    });
    const { emitter, events } = collectEmitter();
    const plan = buildReconcilePlan({
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [{ name: "@hasna/todos", version: "1.2.3" }],
      packageFilter: "@hasna/todos",
    });
    const result = await executeReconcilePlan(plan, { dryRun: false, exec, emitter, recordsPath: null });
    const todos = result.results[0]!;
    expect(todos.status).toBe("failed");
    expect(todos.error).toContain("expected 2.0.0");
    expect(todos.rolledBackTo).toBe("1.2.3");
    expect(calls.some((call) => call.command === "bun" && call.args.join(" ") === "install -g @hasna/todos@1.2.3")).toBe(true);

    const failed = events.filter((event) => event.type === DISTRIBUTION_EVENT_TYPES.rolloutFailed);
    expect(failed.length).toBe(1);
    const rollbackCompleted = events.find((event) =>
      event.type === DISTRIBUTION_EVENT_TYPES.rolloutCompleted && (event.data as { action?: string }).action === "rollback"
    );
    expect(rollbackCompleted).toBeDefined();
    expect(result.records.map((record) => [record.action, record.result])).toEqual([
      ["update", "failed"],
      ["rollback", "succeeded"],
    ]);
  });

  for (const health of ["degraded", "unavailable"] as const) {
    test(`declared MCP health ${health} fails verify:true rollout and rolls back`, async () => {
      const manifest = manifestFixture();
      const eventsPackage = manifest.packages!.find((entry) => entry.name === "@hasna/events")!;
      eventsPackage.version = "0.3.0";
      const { exec, calls } = mockExec((command, args) => {
        if (command === "bun" && args[0] === "install") return { status: 0 };
        if (command === "hasna-events" && args[0] === "--version") return { status: 0, stdout: "0.3.0\n" };
        return { status: 1 };
      });
      const plan = buildReconcilePlan({
        manifest,
        machineId: "demo-node-01",
        freezePath: emptyFreezePath,
        installed: [{ name: "@hasna/events", version: "0.2.0" }],
        packageFilter: "@hasna/events",
      });
      const result = await executeReconcilePlan(plan, {
        dryRun: false,
        exec,
        recordsPath: null,
        healthCheck: async () => health,
      });

      const events = result.results[0]!;
      expect(events.status).toBe("failed");
      expect(events.error).toContain(`MCP health ${health}`);
      expect(events.verifiedBy).toEqual({ cliVersion: "0.3.0", mcpHealth: health });
      expect(events.rolledBackTo).toBe("0.2.0");
      expect(calls.some((call) => call.command === "bun" && call.args.join(" ") === "install -g @hasna/events@0.2.0")).toBe(true);
      expect(result.records.map((record) => [record.action, record.result])).toEqual([
        ["update", "failed"],
        ["rollback", "succeeded"],
      ]);
    });
  }

  test("verify: false packages succeed on install exit code without a CLI check", async () => {
    const manifest = manifestFixture();
    manifest.packages!.push({ name: "@hasna/contracts", version: "0.1.0", verify: false });
    const { exec, calls } = mockExec((command, args) => {
      if (command === "bun" && args[0] === "install") return { status: 0 };
      return { status: 1, stderr: "no CLI available" };
    });
    const plan = buildReconcilePlan({
      manifest,
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [],
      packageFilter: "@hasna/contracts",
    });
    expect(plan.actions[0]?.verify).toBe(false);
    const result = await executeReconcilePlan(plan, { dryRun: false, exec, recordsPath: null });
    const contracts = result.results[0]!;
    expect(contracts.status).toBe("succeeded");
    expect(contracts.verifiedBy).toEqual({ mcpHealth: "not_checked" });
    expect(calls.every((call) => call.args[0] !== "--version")).toBe(true);
  });

  for (const health of ["degraded", "unavailable"] as const) {
    test(`declared MCP health ${health} fails verify:false package without a CLI check`, async () => {
      const manifest = manifestFixture();
      manifest.packages!.push({
        name: "@hasna/contracts",
        version: "0.1.0",
        verify: false,
        mcpHealthUrl: "http://127.0.0.1:9999/contracts/health",
      });
      const { exec, calls } = mockExec((command, args) => {
        if (command === "bun" && args[0] === "install") return { status: 0 };
        return { status: 1, stderr: "no CLI available" };
      });
      const plan = buildReconcilePlan({
        manifest,
        machineId: "demo-node-01",
        freezePath: emptyFreezePath,
        installed: [],
        packageFilter: "@hasna/contracts",
      });
      const result = await executeReconcilePlan(plan, {
        dryRun: false,
        exec,
        recordsPath: null,
        healthCheck: async () => health,
      });

      const contracts = result.results[0]!;
      expect(contracts.status).toBe("failed");
      expect(contracts.error).toContain(`MCP health ${health}`);
      expect(contracts.verifiedBy).toEqual({ mcpHealth: health });
      expect(contracts.rolledBackTo).toBeNull();
      expect(result.warnings).toContain("rollback_unavailable:@hasna/contracts");
      expect(calls).toEqual([{ command: "bun", args: ["install", "-g", "@hasna/contracts@0.1.0"] }]);
    });
  }

  test("freeze gate blocks frozen packages and emits a blocked rollout record", async () => {
    const manifest = manifestFixture();
    manifest.packages!.push({ name: "@hasna/frozen-pkg", version: "9.9.9" });
    const { exec, calls } = mockExec(() => ({ status: 0 }));
    const { emitter, events } = collectEmitter();
    const plan = buildReconcilePlan({
      manifest,
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [],
      packageFilter: "@hasna/frozen-pkg",
    });
    const result = await executeReconcilePlan(plan, { dryRun: false, exec, emitter, recordsPath: null });
    expect(result.results[0]?.status).toBe("blocked");
    expect(calls).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(DISTRIBUTION_EVENT_TYPES.rolloutFailed);
    expect(result.records[0]).toMatchObject({ action: "freeze-blocked", result: "blocked" });
  });
});

describe("release.published trigger", () => {
  test("extracts triggers only from valid release.published envelopes", () => {
    expect(releaseEventTrigger({ type: "machines.tmux.pane_died" })).toBeNull();
    expect(releaseEventTrigger({ type: "release.published", data: { package: "@hasna/knowledge" } })).toBeNull();
    expect(releaseEventTrigger({
      type: "release.published",
      data: { appId: "open-knowledge", package: "@hasna/knowledge", version: "1.0.0" },
    })).toEqual({
      packageFilter: "@hasna/knowledge",
      eventVersions: { "@hasna/knowledge": "1.0.0" },
    });
  });

  test("reconciles a tracked package in response to release.published", async () => {
    const { exec } = mockExec((command, args) => {
      if (command === "bun" && args[0] === "install") return { status: 0 };
      if (command === "knowledge" && args[0] === "--version") return { status: 0, stdout: "1.0.0\n" };
      return { status: 1 };
    });
    const { emitter, events } = collectEmitter();
    const result = await reconcileFromReleaseEvent({
      type: "release.published",
      data: { appId: "open-knowledge", package: "@hasna/knowledge", version: "1.0.0", publishPath: "skill" },
    }, {
      manifest: manifestFixture(),
      machineId: "demo-node-01",
      freezePath: emptyFreezePath,
      installed: [{ name: "@hasna/knowledge", version: "0.9.0" }],
      dryRun: false,
      exec,
      emitter,
      recordsPath: null,
    });
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(1);
    expect(result!.results[0]).toMatchObject({ package: "@hasna/knowledge", action: "update", status: "succeeded" });
    expect(events.some((event) => event.type === DISTRIBUTION_EVENT_TYPES.rolloutCompleted)).toBe(true);

    const ignored = await reconcileFromReleaseEvent({ type: "app.installed", data: {} }, { manifest: manifestFixture(), freezePath: emptyFreezePath });
    expect(ignored).toBeNull();
  });
});

describe("machines reconcile CLI", () => {
  function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env,
      input,
      encoding: "utf8",
    });
  }

  function cliEnv(dir: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HASNA_MACHINES_DIR: dir,
      HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
      HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
      HASNA_MACHINES_FREEZE_PATH: join(dir, "freeze.json"),
      HASNA_MACHINES_MACHINE_ID: "demo-node-01",
      HASNA_MACHINES_ALLOW_MUTATIONS: "1",
    };
  }

  function writeFixtures(dir: string): { installedPath: string } {
    writeFileSync(join(dir, "machines.json"), `${JSON.stringify(manifestFixture(), null, 2)}\n`, "utf8");
    const installedPath = join(dir, "installed.json");
    writeFileSync(installedPath, `${JSON.stringify([
      { name: "@hasna/todos", version: "1.2.3" },
      { name: "@hasna/events", version: "0.2.0" },
    ])}\n`, "utf8");
    return { installedPath };
  }

  test("machines reconcile --dry-run plans without mutating anything", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-reconcile-"));
    const { installedPath } = writeFixtures(dir);
    const result = runCli(["reconcile", "--dry-run", "--installed-json", installedPath, "--json"], cliEnv(dir));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      mode: string;
      machineId: string;
      results: Array<{ package: string; action: string; status: string }>;
      records: unknown[];
    };
    expect(output.mode).toBe("dry-run");
    expect(output.machineId).toBe("demo-node-01");
    expect(output.records).toHaveLength(0);
    const byName = new Map(output.results.map((entry) => [entry.package, entry]));
    expect(byName.get("@hasna/todos")).toMatchObject({ action: "update", status: "pending" });
    expect(byName.get("@hasna/events")).toMatchObject({ action: "skip", status: "skipped" });
    expect(byName.get("left-pad")).toMatchObject({ action: "install", status: "pending" });
  });

  test("machines reconcile --dry-run --event-json scopes the plan to the released package", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-reconcile-event-"));
    const { installedPath } = writeFixtures(dir);
    const eventPath = join(dir, "event.json");
    writeFileSync(eventPath, JSON.stringify({
      id: "evt-1",
      source: "releases",
      type: "release.published",
      data: { appId: "open-knowledge", package: "@hasna/knowledge", version: "1.0.0" },
    }), "utf8");
    const result = runCli([
      "reconcile", "--dry-run", "--event-json", eventPath, "--installed-json", installedPath, "--json",
    ], cliEnv(dir));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { results: Array<{ package: string; action: string; desiredVersion: string }> };
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ package: "@hasna/knowledge", action: "install", desiredVersion: "1.0.0" });
  });

  test("machines reconcile rejects non release.published event envelopes", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-reconcile-bad-event-"));
    const { installedPath } = writeFixtures(dir);
    const eventPath = join(dir, "event.json");
    writeFileSync(eventPath, JSON.stringify({ type: "announcement.sent", data: {} }), "utf8");
    const result = runCli(["reconcile", "--dry-run", "--event-json", eventPath, "--installed-json", installedPath], cliEnv(dir));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release.published");
  });

  test("machines reconcile --apply exits non-zero when an action is freeze-blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-reconcile-blocked-"));
    const { installedPath } = writeFixtures(dir);
    writeFileSync(join(dir, "freeze.json"), `${JSON.stringify({
      version: 1,
      packages: [{ name: "left-pad", reason: "rollout hold" }],
    })}\n`, "utf8");
    const result = runCli([
      "reconcile",
      "--apply",
      "--installed-json",
      installedPath,
      "--package",
      "left-pad",
      "--json",
      "--no-emit",
    ], cliEnv(dir));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as {
      mode: string;
      results: Array<{ package: string; action: string; status: string; error?: string }>;
      records: Array<{ action: string; result: string }>;
    };
    expect(output.mode).toBe("apply");
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({
      package: "left-pad",
      action: "freeze-blocked",
      status: "blocked",
    });
    expect(output.results[0]?.error).toContain("rollout hold");
    expect(output.records[0]).toMatchObject({ action: "freeze-blocked", result: "blocked" });
  });

  test("machines freeze add/check/list/remove drive the reconcile freeze gate", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-freeze-"));
    const { installedPath } = writeFixtures(dir);
    const env = cliEnv(dir);

    const add = runCli(["freeze", "add", "left-pad", "--reason", "incident #7", "--json"], env);
    expect(add.stderr).toBe("");
    expect(add.status).toBe(0);

    const check = runCli(["freeze", "check", "left-pad", "--json"], env);
    expect(check.status).toBe(1);
    expect(JSON.parse(check.stdout)).toMatchObject({ package: "left-pad", frozen: true });

    const plan = runCli(["reconcile", "--dry-run", "--installed-json", installedPath, "--json"], env);
    expect(plan.status).toBe(0);
    const output = JSON.parse(plan.stdout) as { results: Array<{ package: string; action: string; status: string }> };
    expect(output.results.find((entry) => entry.package === "left-pad")).toMatchObject({
      action: "freeze-blocked",
      status: "blocked",
    });

    const list = runCli(["freeze", "list", "--json"], env);
    expect(list.status).toBe(0);
    const listed = JSON.parse(list.stdout) as { packages: Array<{ name: string }> };
    // manifest freeze entries are merged with freeze.json entries
    expect(listed.packages.map((entry) => entry.name).sort()).toEqual(["@hasna/frozen-pkg", "left-pad"]);

    const remove = runCli(["freeze", "remove", "left-pad", "--json"], env);
    expect(remove.status).toBe(0);
    const checkAgain = runCli(["freeze", "check", "left-pad"], env);
    expect(checkAgain.status).toBe(0);

    const freezeFile = JSON.parse(readFileSync(join(dir, "freeze.json"), "utf8")) as { version: number; packages: unknown[] };
    expect(freezeFile.version).toBe(1);
    expect(freezeFile.packages).toHaveLength(0);
  });
});
