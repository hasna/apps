import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { gatedWriteCommand, openGate, waitUntil } from "../test-helpers.js";
import { LoopsClient, migrationHash, openAutomationsRuntimeBinding, registerSelfHostedRunner } from "./index.js";

describe("loops sdk", () => {
  test("describes the OpenAutomations runtime handoff without claiming product ownership", () => {
    const binding = openAutomationsRuntimeBinding();
    expect(binding).toMatchObject({
      integration: "open-automations",
      role: "runtime",
      handoff: "claim-queue",
      queueOwner: "open-automations",
      runtimeOwner: "open-loops",
      claimCommand: "automations queue claim",
      completeCommand: "automations queue complete",
      failCommand: "automations queue fail",
      eventHandoff: {
        envelopeCommand: "automations webhooks event",
        handlerCommand: "loops routes create generic",
      },
    });
    expect(binding.guarantees.join(" ")).toContain("OpenAutomations owns automation specs");
    expect(binding.guarantees.join(" ")).toContain("exported event envelopes");
    expect(binding.nonGoals.join(" ")).toContain("must not become the OpenAutomations product surface");
    expect(binding.eventHandoff.boundary).toContain("OpenLoops owns workflow invocation");
  });

  test("lists loops and runs with filters and exposes doctor/health reports", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const active = client.create({
        name: "sdk-filter-active",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const archived = client.create({
        name: "sdk-filter-archived",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      client.archive(archived.id);

      expect(client.list().map((loop) => loop.id)).toEqual([active.id]);
      expect(client.list({ status: "active" }).map((loop) => loop.id)).toEqual([active.id]);
      expect(client.list({ status: "stopped" })).toHaveLength(0);
      expect(client.list({ archivedOnly: true }).map((loop) => loop.id)).toEqual([archived.id]);
      expect(client.list({ includeArchived: true })).toHaveLength(2);
      expect(client.list({ includeArchived: true, limit: 1 })).toHaveLength(1);

      const succeeded = await client.runNow(active.id);
      expect(succeeded.status).toBe("succeeded");
      expect(client.runs("sdk-filter-active", { status: "succeeded" }).map((run) => run.id)).toEqual([succeeded.id]);
      expect(client.runs(active.id, { status: "failed" })).toHaveLength(0);
      expect(client.runs()).toHaveLength(1);
      // v0.3.x compat: polling runs for an unknown or just-deleted loop id
      // returns [] instead of throwing LoopNotFoundError.
      expect(client.runs("no-such-loop")).toEqual([]);
      const deleted = client.create({
        name: "sdk-filter-deleted",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      client.delete(deleted.id);
      expect(client.runs(deleted.id)).toEqual([]);
      // Other loop lookups stay strict.
      expect(() => client.get("no-such-loop")).toThrow("loop not found");

      const doctor = client.doctor();
      expect(doctor.checks.map((check) => check.id)).toContain("data-dir");

      const health = client.health();
      expect(health.summary.loops).toBe(1);
      expect(health.expectations[0]?.loop.id).toBe(active.id);
      expect(client.health({ includeArchived: true }).summary.loops).toBe(2);
      const scan = client.healthScan({ daemon: true });
      expect(scan.counts.loops).toBe(1);
      expect(scan.daemon?.running).toBe(false);
      expect(scan.findings.map((finding) => finding.kind)).toContain("daemon");
    } finally {
      client.close();
    }
  });

  test("archives and unarchives loops through the client", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const loop = client.create({
        name: "sdk-archive",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const archived = client.archive(loop.id);
      expect(archived.status).toBe("paused");
      expect(archived.archivedFromStatus).toBe("active");
      expect(client.list()).toHaveLength(0);
      expect(() => client.resume(loop.id)).toThrow("loop is archived");
      await expect(client.runNow(loop.id)).rejects.toThrow("loop is archived");

      const restored = client.unarchive(loop.id);
      expect(restored.status).toBe("active");
      expect(restored.archivedAt).toBeUndefined();
      expect(client.list().map((entry) => entry.id)).toEqual([loop.id]);
    } finally {
      client.close();
    }
  });

  test("resume from stopped recomputes nextRunAt so the loop becomes due again", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const loop = client.create({
        name: "sdk-resume-stopped",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const stopped = client.stop(loop.id);
      expect(stopped.status).toBe("stopped");
      expect(stopped.nextRunAt).toBeUndefined();

      const resumed = client.resume(loop.id);
      expect(resumed.status).toBe("active");
      // Regression: resume used to leave nextRunAt null, so dueLoops (next_run_at
      // IS NOT NULL) never picked it up -> active but permanently dormant.
      expect(resumed.nextRunAt).toBeString();
      expect(store.dueLoops(new Date(Date.now() + 120_000)).map((entry) => entry.id)).toContain(loop.id);
    } finally {
      client.close();
    }
  });

  test("mutation paths reject ambiguous loop names instead of touching the newest match", () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const spec = { schedule: { type: "interval" as const, everyMs: 60_000 }, target: { type: "command" as const, command: "true" } };
      const first = client.create({ name: "sdk-dupe", ...spec });
      const second = client.create({ name: "sdk-dupe", ...spec });
      expect(first.id).not.toBe(second.id);

      expect(() => client.pause("sdk-dupe")).toThrow("ambiguous loop name");
      expect(() => client.resume("sdk-dupe")).toThrow("ambiguous loop name");
      expect(() => client.stop("sdk-dupe")).toThrow("ambiguous loop name");
      expect(() => client.delete("sdk-dupe")).toThrow("ambiguous loop name");
      // The id path still works precisely.
      expect(client.pause(second.id).status).toBe("paused");
    } finally {
      client.close();
    }
  });

  test("exports, plans, and imports migration bundles through the client", () => {
    const sourceStore = new Store(":memory:");
    const targetStore = new Store(":memory:");
    const source = new LoopsClient({ store: sourceStore, runnerId: "source" });
    const target = new LoopsClient({ store: targetStore, runnerId: "target" });
    try {
      const loop = source.create({
        name: "sdk-migration-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const bundle = source.exportBundle();
      expect(bundle.importable).toBe(true);
      expect(bundle.counts).toMatchObject({ loops: 1, runs: 0 });

      const plan = target.planImport(bundle);
      expect(plan.summary).toMatchObject({ insert: 1, blocked: 0, conflict: 0 });

      const applied = target.importBundle(bundle);
      expect(applied.applied).toEqual({ workflows: 0, loops: 1, runs: 0 });
      expect(target.get(loop.id).name).toBe("sdk-migration-loop");

      const idempotent = target.planImport(bundle);
      expect(idempotent.summary).toMatchObject({ insert: 0, skip: 1, blocked: 0, conflict: 0 });
    } finally {
      source.close();
      target.close();
    }
  });

  test("registers a self-hosted runner through the migration API helper", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(input), body });
      return Response.json({
        ok: true,
        runner: {
          id: body.runnerId,
          machineId: body.machineId,
          labels: body.labels,
          capabilities: body.capabilities,
        },
      });
    };

    const registered = await registerSelfHostedRunner({
      apiUrl: "http://127.0.0.1:8787",
      runnerId: "runner-sdk-test",
      machineId: "machine-sdk-test",
      labels: { role: "worker" },
      capabilities: { concurrency: 1 },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(registered).toMatchObject({
      ok: true,
      runner: {
        id: "runner-sdk-test",
        machineId: "machine-sdk-test",
        labels: { role: "worker" },
        capabilities: { concurrency: 1 },
      },
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8787/v1/runners/register",
        body: {
          runnerId: "runner-sdk-test",
          machineId: "machine-sdk-test",
          labels: { role: "worker" },
          capabilities: { concurrency: 1 },
        },
      },
    ]);
  });

  test("migration plans block destination live state and tampered bundles", async () => {
    const sourceStore = new Store(":memory:");
    const targetStore = new Store(":memory:");
    const source = new LoopsClient({ store: sourceStore, runnerId: "source" });
    const target = new LoopsClient({ store: targetStore, runnerId: "target" });
    try {
      source.create({
        name: "sdk-live-destination-source",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const bundle = source.exportBundle();
      targetStore.acquireDaemonLease({
        id: "daemon-live",
        pid: process.pid,
        hostname: "test-host",
        ttlMs: 60_000,
      });
      const blocked = target.planImport(bundle);
      expect(blocked.importable).toBe(false);
      expect(blocked.rows.some((row) => row.id === "destination:volatile:activeDaemonLeases" && row.action === "blocked")).toBe(true);

      const tampered = structuredClone(bundle);
      tampered.packageVersion = "tampered";
      expect(() => target.planImport(tampered)).toThrow("hash mismatch");
    } finally {
      source.close();
      target.close();
    }

    const redactedSourceStore = new Store(":memory:");
    const redactedTargetStore = new Store(":memory:");
    const redactedSource = new LoopsClient({ store: redactedSourceStore, runnerId: "source" });
    const redactedTarget = new LoopsClient({ store: redactedTargetStore, runnerId: "target" });
    try {
      redactedSource.create({
        name: "sdk-redacted-source",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "env", env: { PRIVATE_TOKEN: "very-secret-value" } },
      });
      const redactedBundle = redactedSource.exportBundle();
      const forged = structuredClone(redactedBundle);
      forged.importable = true;
      forged.blockers = [];
      const { hash: _hash, ...body } = forged;
      forged.hash = migrationHash(body);
      const plan = redactedTarget.planImport(forged);
      expect(plan.importable).toBe(false);
      expect(plan.rows.some((row) => row.resource === "loop" && row.action === "blocked" && row.reason?.includes("redacted command env"))).toBe(true);
    } finally {
      redactedSource.close();
      redactedTarget.close();
    }

    const raceSourceStore = new Store(":memory:");
    const raceTargetStore = new Store(":memory:");
    const raceSource = new LoopsClient({ store: raceSourceStore, runnerId: "source" });
    const raceTarget = new LoopsClient({ store: raceTargetStore, runnerId: "target" });
    try {
      raceSource.create({
        name: "sdk-race-source",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const raceBundle = raceSource.exportBundle();
      const originalWriteTransaction = raceTargetStore.writeTransaction.bind(raceTargetStore);
      let injected = false;
      raceTargetStore.writeTransaction = ((fn: () => unknown) => {
        if (!injected) {
          injected = true;
          raceTargetStore.acquireDaemonLease({
            id: "daemon-race",
            pid: process.pid,
            hostname: "test-host",
            ttlMs: 60_000,
          });
        }
        return originalWriteTransaction(fn);
      }) as Store["writeTransaction"];
      expect(() => raceTarget.importBundle(raceBundle)).toThrow("destination store changed before import apply");
    } finally {
      raceSource.close();
      raceTarget.close();
    }

    const conflictSourceStore = new Store(":memory:");
    const conflictTargetStore = new Store(":memory:");
    const conflictSource = new LoopsClient({ store: conflictSourceStore, runnerId: "source" });
    const conflictTarget = new LoopsClient({ store: conflictTargetStore, runnerId: "target" });
    try {
      conflictSource.create({
        name: "sdk-conflict-source",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const conflictBundle = conflictSource.exportBundle();
      const incomingLoop = conflictBundle.data.loops[0]!;
      const originalWriteTransaction = conflictTargetStore.writeTransaction.bind(conflictTargetStore);
      let injected = false;
      conflictTargetStore.writeTransaction = ((fn: () => unknown) => {
        if (!injected) {
          injected = true;
          conflictTargetStore.upsertMigrationLoop({
            ...incomingLoop,
            name: "conflicting-loop",
            updatedAt: "2026-01-01T00:00:02.000Z",
          }, { replace: true });
        }
        return originalWriteTransaction(fn);
      }) as Store["writeTransaction"];
      expect(() => conflictTarget.importBundle(conflictBundle)).toThrow("destination store changed before import apply");
      expect(conflictTargetStore.getLoop(incomingLoop.id)?.name).toBe("conflicting-loop");
    } finally {
      conflictSource.close();
      conflictTarget.close();
    }

    const pullStore = new Store(":memory:");
    const pullClient = new LoopsClient({ store: pullStore, runnerId: "pull" });
    try {
      const fetchImpl = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v1/runs")) {
          return Response.json({ ok: true, runs: [{ id: "remote-run-1", loopName: "remote-loop", status: "succeeded" }] });
        }
        return Response.json({ ok: true, loops: [{ id: "remote-loop-1", name: "remote-loop" }] });
      };
      const pull = await pullClient.planSelfHostedMigration({
        operation: "self-hosted-pull",
        apiUrl: "http://127.0.0.1:8787",
        fetchImpl: fetchImpl as typeof fetch,
      });
      expect(pull.importable).toBe(false);
      expect(pull.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ resource: "loop", id: "remote-loop-1", action: "blocked" }),
        expect.objectContaining({ resource: "run", id: "remote-run-1", action: "blocked" }),
      ]));
    } finally {
      pullClient.close();
    }
  });

  test("writes and reads scheduler-neutral run receipts", () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const receipt = client.writeReceipt({
        loop_id: "loop-sdk",
        run_id: "run-sdk",
        machine: "spark01",
        repo: "/workspace/open-loops",
        task_ids: ["task-sdk"],
        knowledge_ids: ["knowledge-sdk"],
        status: "succeeded",
        summary: "sdk receipt",
        evidence_paths: ["/tmp/sdk-receipt.json"],
        stdout: "s".repeat(50_000),
      });
      expect(receipt.digest_id).toMatch(/^sha256:/);
      expect(receipt.summary.stdout_bytes).toBe(50_000);
      expect(receipt.summary.stdout_excerpt).toContain("chars omitted");
      expect(client.receipt("run-sdk")?.summary.text).toBe("sdk receipt");
      expect(client.receipts({ taskId: "task-sdk" }).map((value) => value.run_id)).toEqual(["run-sdk"]);
    } finally {
      client.close();
    }
  });

  test("runNow falls back to ad hoc when the due slot is already terminal", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const loop = client.create({
        name: "sdk-terminal-due",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const dueSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, dueSlot, "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "seed",
          stderr: "",
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:01Z") },
      );

      const run = await client.runNow(loop.id);
      expect(run.status).toBe("succeeded");
      expect(run.scheduledFor).not.toBe(dueSlot);
      expect(store.getLoop(loop.id)?.nextRunAt).toBe(dueSlot);
    } finally {
      client.close();
    }
  });

  test("runNow records pid and heartbeats so daemon ticks do not duplicate due work", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    const root = mkdtempSync(join(tmpdir(), "loops-sdk-runnow-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const loop = client.create({
        name: "manual-due-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
        leaseMs: 50,
        maxAttempts: 2,
        retryDelayMs: 1,
        overlap: "allow",
      });
      const running = client.runNow(loop.id);
      const active = await waitUntil(() => {
        const run = store.listRuns({ loopId: loop.id, status: "running", limit: 1 })[0];
        return run?.pid !== undefined ? run : undefined;
      }, { label: "running run with pid" });
      expect(loop.nextRunAt).toBeDefined();
      expect(active?.scheduledFor).toBe(loop.nextRunAt!);
      expect(active?.pid).toBeDefined();
      await Bun.sleep(120);
      const tickResult = await tick({
        store,
        runnerId: "daemon",
        now: () => new Date(),
      });
      expect(tickResult.completed).toHaveLength(0);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
      openGate(gate);
      const run = await running;
      expect(run.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.status).toBe("stopped");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
