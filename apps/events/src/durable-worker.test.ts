import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableEventSpool } from "./durable-spool.js";
import { DurableEventsBroker } from "./durable.js";
import { runDurableWorker } from "./durable-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runDurableWorker", () => {
  test("imports committed files when the watcher reports only a temporary publication name", async () => {
    const dataDir = await temporaryDataDir();
    // Isolate the watcher substitution in a child: other tests keep native fs.watch.
    // macOS can coalesce hardlink publication into notifications for the temp inode.
    const script = `
      import { mock } from "bun:test";
      import * as fs from "node:fs";
      import { EventEmitter } from "node:events";
      import { join } from "node:path";
      let notify, closed = false;
      mock.module("node:fs", () => ({ ...fs, watch: (_path, callback) => {
        notify = callback;
        return Object.assign(new EventEmitter(), { close() { closed = true; } });
      }}));
      const { DurableEventSpool } = await import(${JSON.stringify(join(import.meta.dir, "durable-spool.ts"))});
      const { DurableEventsBroker } = await import(${JSON.stringify(join(import.meta.dir, "durable.ts"))});
      const { runDurableWorker } = await import(${JSON.stringify(join(import.meta.dir, "durable-worker.ts"))});
      const dataDir = ${JSON.stringify(dataDir)};
      let attempts = 0, cycles = 0;
      const broker = new DurableEventsBroker({ dataDir, secretResolver: () => "synthetic-watcher-fixture",
        fetchImpl: async () => new Response("synthetic", { status: ++attempts === 1 ? 503 : 202 }) });
      broker.addChannel({ id: "fixture", enabled: true, transport: "webhook",
        webhook: { url: "https://example.invalid", secretRef: "env:HASNA_EVENTS_SYNTHETIC_REFERENCE" },
        retry: { maxAttempts: 3, backoffMs: 20, multiplier: 1 } });
      const controller = new AbortController();
      const worker = runDurableWorker({ broker, signal: controller.signal, debounceMs: 5,
        reconcileMs: 60000, onCycle: () => { cycles += 1; } });
      const waitFor = async (check) => {
        const deadline = Date.now() + 1500;
        while (!check()) { if (Date.now() >= deadline) throw new Error("watcher fixture timed out"); await Bun.sleep(5); }
      };
      try {
        await waitFor(() => cycles === 1);
        const spool = new DurableEventSpool({ dataDir });
        // Incomplete writes remain excluded by the real importer even after a wakeup.
        fs.writeFileSync(join(spool.inboxDir, ".tmp-incomplete"), "not-json");
        await spool.enqueue({ id: "watcher-fixture", source: "notes", type: "note.created", data: {} });
        notify("rename", ".tmp-published-inode");
        await waitFor(() => attempts === 2);
        controller.abort();
        const result = await worker;
        console.log(JSON.stringify({ imported: result.imported, delivered: result.delivered,
          retried: result.retried, counts: broker.status().counts, closed,
          incompletePreserved: fs.existsSync(join(spool.inboxDir, ".tmp-incomplete")) }));
      } finally { controller.abort(); await worker; broker.close(); }
    `;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
      env: { PATH: process.env.PATH!, HOME: dataDir, TMPDIR: tmpdir(), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdout: "pipe", stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ imported: 1, delivered: 1, retried: 1,
      counts: { events: 1, pending: 0, leased: 0, delivered: 1 }, closed: true, incompletePreserved: true });
  });

  test("watches the spool and wakes from persisted retry time without polling notes", async () => {
    const dataDir = await temporaryDataDir();
    let attempts = 0;
    const broker = new DurableEventsBroker({
      dataDir,
      secretResolver: () => "runtime-only-test-secret",
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("retry", { status: 503 })
          : new Response("queued", { status: 202 });
      },
    });
    broker.addChannel({
      id: "notes-created",
      enabled: true,
      transport: "webhook",
      filters: [{ source: "notes", type: "note.created" }],
      webhook: { url: "https://example.invalid", secretRef: "env:HASNA_NOTES_WEBHOOK_SECRET" },
      retry: { maxAttempts: 3, backoffMs: 20, multiplier: 1 },
    });

    const controller = new AbortController();
    const worker = runDurableWorker({
      broker,
      signal: controller.signal,
      workerId: "worker-test",
      debounceMs: 5,
      reconcileMs: 60_000,
      watchRestartMs: 10,
    });
    const spool = new DurableEventSpool({ dataDir });
    await spool.enqueue({
      id: "notes:note:worker:created",
      source: "notes",
      type: "note.created",
      time: "2020-01-01T00:00:00.000Z",
      dedupeKey: "notes:note:worker:created",
      schemaVersion: "notes.v1",
      data: { noteId: "worker" },
      metadata: {},
    });

    await waitFor(() => attempts === 2, 5_000);
    controller.abort();
    const result = await worker;
    expect(result).toMatchObject({
      workerId: "worker-test",
      imported: 1,
      delivered: 1,
      retried: 1,
      dead: 0,
    });
    expect(broker.status().counts).toMatchObject({ pending: 0, leased: 0, delivered: 1 });
    broker.close();
  });

  test("survives a poison spool record and still delivers later valid records", async () => {
    const dataDir = await temporaryDataDir();
    const spool = new DurableEventSpool({ dataDir });
    const inboxDir = spool.inboxDir;
    await Bun.write(join(inboxDir, `${"a".repeat(64)}.json`), "not-json");

    const broker = new DurableEventsBroker({
      dataDir,
      secretResolver: () => "runtime-only-test-secret",
      fetchImpl: async () => new Response("queued", { status: 202 }),
    });
    broker.addChannel({
      id: "notes-created",
      enabled: true,
      transport: "webhook",
      filters: [{ source: "notes", type: "note.created" }],
      webhook: { url: "https://example.invalid", secretRef: "env:HASNA_NOTES_WEBHOOK_SECRET" },
    });

    const controller = new AbortController();
    const worker = runDurableWorker({
      broker,
      signal: controller.signal,
      workerId: "poison-worker",
      debounceMs: 5,
      reconcileMs: 60_000,
      watchRestartMs: 10,
    });
    await spool.enqueue({
      id: "notes:note:after-poison-worker:created",
      source: "notes",
      type: "note.created",
      time: "2020-01-01T00:00:00.000Z",
      dedupeKey: "notes:note:after-poison-worker:created",
      schemaVersion: "notes.v1",
      data: { noteId: "after-poison-worker" },
      metadata: {},
    });

    await waitFor(() => broker.status().counts.delivered === 1, 5_000);
    controller.abort();
    const result = await worker;
    expect(result).toMatchObject({ imported: 1, delivered: 1, dead: 0 });
    expect(broker.status().counts).toMatchObject({ pending: 0, leased: 0, delivered: 1 });
    const quarantined = await readdir(join(dataDir, "spool", "quarantine"));
    expect(quarantined.some((name) => name.endsWith(".meta.json"))).toBe(true);
    broker.close();
  });

  test("chunks retry timers beyond the runtime timeout ceiling instead of spinning", async () => {
    const dataDir = await temporaryDataDir();
    let cycles = 0;
    const broker = new DurableEventsBroker({
      dataDir,
      secretResolver: () => "runtime-only-test-secret",
      fetchImpl: async () => {
        return new Response("retry", { status: 503 });
      },
    });
    broker.addChannel({
      id: "long-retry",
      enabled: true,
      transport: "webhook",
      webhook: { url: "https://example.invalid", secretRef: "env:SAFE_REFERENCE" },
      retry: { maxAttempts: 2, backoffMs: 2_147_483_648, multiplier: 1 },
    });
    broker.enqueue({ id: "long-retry-event", source: "notes", type: "note.created" });

    const controller = new AbortController();
    const worker = runDurableWorker({
      broker,
      signal: controller.signal,
      reconcileMs: 60_000,
      debounceMs: 60_000,
      onCycle: () => { cycles += 1; },
    });
    await waitFor(() => cycles === 1, 5_000);
    await Bun.sleep(25);
    controller.abort();
    const result = await worker;
    expect(result).toMatchObject({ cycles: 1, retried: 1, delivered: 0, lost: 0 });
    broker.close();
  });
});

async function temporaryDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hasna-events-worker-test-"));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for durable worker delivery");
    await Bun.sleep(10);
  }
}
