import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { gatedWriteCommand, openGate, waitUntil } from "../test-helpers.js";
import { LoopsClient as HttpLoopsClient } from "./http.js";
import { LoopsClient, migrationHash, openAutomationsRuntimeBinding } from "./index.js";

describe("loops sdk", () => {
  test("generated HTTP client exposes pagination and output query params", async () => {
    const urls: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      urls.push(String(input));
      return Response.json({ ok: true, runs: [] });
    };
    const client = new HttpLoopsClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl as typeof fetch });

    await client.listLoops({ limit: 10, offset: 20, includeArchived: true });
    await client.listRuns({ limit: 5, offset: 15, showOutput: true });
    await client.getRun("run-1", { showOutput: true });

    expect(urls[0]).toBe("http://127.0.0.1:8787/v1/loops?limit=10&offset=20&includeArchived=true");
    expect(urls[1]).toBe("http://127.0.0.1:8787/v1/runs?limit=5&offset=15&showOutput=true");
    expect(urls[2]).toBe("http://127.0.0.1:8787/v1/runs/run-1?showOutput=true");
  });

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
      const active = await client.create({
        name: "sdk-filter-active",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const archived = await client.create({
        name: "sdk-filter-archived",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      await client.archive(archived.id);

      expect((await client.list()).map((loop) => loop.id)).toEqual([active.id]);
      expect((await client.list({ status: "active" })).map((loop) => loop.id)).toEqual([active.id]);
      expect(await client.list({ status: "stopped" })).toHaveLength(0);
      expect((await client.list({ archivedOnly: true })).map((loop) => loop.id)).toEqual([archived.id]);
      expect(await client.list({ includeArchived: true })).toHaveLength(2);
      expect(await client.list({ includeArchived: true, limit: 1 })).toHaveLength(1);

      const succeeded = await client.runNow(active.id);
      expect(succeeded.status).toBe("succeeded");
      expect((await client.runs("sdk-filter-active", { status: "succeeded" })).map((run) => run.id)).toEqual([succeeded.id]);
      expect(await client.runs(active.id, { status: "failed" })).toHaveLength(0);
      expect(await client.runs()).toHaveLength(1);
      // v0.3.x compat: polling runs for an unknown or just-deleted loop id
      // returns [] instead of throwing LoopNotFoundError.
      expect(await client.runs("no-such-loop")).toEqual([]);
      const deleted = await client.create({
        name: "sdk-filter-deleted",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      await client.delete(deleted.id);
      expect(await client.runs(deleted.id)).toEqual([]);
      // Other loop lookups stay strict.
      await expect(client.get("no-such-loop")).rejects.toThrow("loop not found");

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
      const loop = await client.create({
        name: "sdk-archive",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const archived = await client.archive(loop.id);
      expect(archived.status).toBe("paused");
      expect(archived.archivedFromStatus).toBe("active");
      expect(await client.list()).toHaveLength(0);
      await expect(client.resume(loop.id)).rejects.toThrow("loop is archived");
      await expect(client.runNow(loop.id)).rejects.toThrow("loop is archived");

      const restored = await client.unarchive(loop.id);
      expect(restored.status).toBe("active");
      expect(restored.archivedAt).toBeUndefined();
      expect((await client.list()).map((entry) => entry.id)).toEqual([loop.id]);
    } finally {
      client.close();
    }
  });

  test("resume from stopped recomputes nextRunAt so the loop becomes due again", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const loop = await client.create({
        name: "sdk-resume-stopped",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const stopped = await client.stop(loop.id);
      expect(stopped.status).toBe("stopped");
      expect(stopped.nextRunAt).toBeUndefined();

      const resumed = await client.resume(loop.id);
      expect(resumed.status).toBe("active");
      // Regression: resume used to leave nextRunAt null, so dueLoops (next_run_at
      // IS NOT NULL) never picked it up -> active but permanently dormant.
      expect(resumed.nextRunAt).toBeString();
      expect(store.dueLoops(new Date(Date.now() + 120_000)).map((entry) => entry.id)).toContain(loop.id);
    } finally {
      client.close();
    }
  });

  test("mutation paths reject ambiguous loop names instead of touching the newest match", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const spec = { schedule: { type: "interval" as const, everyMs: 60_000 }, target: { type: "command" as const, command: "true" } };
      const first = await client.create({ name: "sdk-dupe", ...spec });
      const second = await client.create({ name: "sdk-dupe", ...spec });
      expect(first.id).not.toBe(second.id);

      await expect(client.pause("sdk-dupe")).rejects.toThrow("ambiguous loop name");
      await expect(client.resume("sdk-dupe")).rejects.toThrow("ambiguous loop name");
      await expect(client.stop("sdk-dupe")).rejects.toThrow("ambiguous loop name");
      await expect(client.delete("sdk-dupe")).rejects.toThrow("ambiguous loop name");
      // The id path still works precisely.
      expect((await client.pause(second.id)).status).toBe("paused");
    } finally {
      await client.close();
    }
  });

  test("exports, plans, and imports migration bundles through the client", async () => {
    const sourceStore = new Store(":memory:");
    const targetStore = new Store(":memory:");
    const source = new LoopsClient({ store: sourceStore, runnerId: "source" });
    const target = new LoopsClient({ store: targetStore, runnerId: "target" });
    try {
      const loop = await source.create({
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
      expect((await target.get(loop.id)).name).toBe("sdk-migration-loop");

      const idempotent = target.planImport(bundle);
      expect(idempotent.summary).toMatchObject({ insert: 0, skip: 1, blocked: 0, conflict: 0 });
    } finally {
      await source.close();
      await target.close();
    }
  });

  test("migration plans block destination live state and tampered bundles", async () => {
    const sourceStore = new Store(":memory:");
    const targetStore = new Store(":memory:");
    const source = new LoopsClient({ store: sourceStore, runnerId: "source" });
    const target = new LoopsClient({ store: targetStore, runnerId: "target" });
    try {
      await source.create({
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
      await redactedSource.create({
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
      await raceSource.create({
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
      await conflictSource.create({
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

  test("writes and reads scheduler-neutral run receipts", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const receipt = await client.writeReceipt({
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
      expect((await client.receipt("run-sdk"))?.summary.text).toBe("sdk receipt");
      expect((await client.receipts({ taskId: "task-sdk" })).map((value) => value.run_id)).toEqual(["run-sdk"]);
    } finally {
      client.close();
    }
  });

  test("runNow falls back to ad hoc when the due slot is already terminal", async () => {
    const store = new Store(":memory:");
    const client = new LoopsClient({ store, runnerId: "manual" });
    try {
      const loop = await client.create({
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
      const loop = await client.create({
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
