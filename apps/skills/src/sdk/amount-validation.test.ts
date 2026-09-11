import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import { publicPrincipal } from "../server/auth.js";
import { MemoryGovernanceStore } from "./governance-store.js";
import { SqliteGovernanceStore } from "../server/sqlite-governance-store.js";
import { createSpendService } from "./spend.js";
import { createRunService, settleRun } from "./runs.js";
import { createRunEventEmitter } from "./events.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const principal = publicPrincipal({ orgId: "owned-amount-org", userId: "owned-amount-user", apiKeyId: "owned-amount-key", email: "amount@example.test" });
async function owned(action: (store: SqliteSkillsStore, governance: SqliteGovernanceStore) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "skills-amounts-"));
  let store: SqliteSkillsStore | undefined, governance: SqliteGovernanceStore | undefined;
  try { store = new SqliteSkillsStore(join(directory, "owned.sqlite")); governance = new SqliteGovernanceStore(join(directory, "owned.sqlite"));
    await store.ensureBootstrapApiKey("owned-amount-token", principal); await action(store, governance);
  } finally { try { await governance?.close(); } finally { try { await store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); } } }
}
const input = { principal, slug: "transcript", args: [], input: {} };
const malformed: Array<[string, number]> = [["negative", -1], ["NaN", NaN], ["Infinity", Infinity], ["negative Infinity", -Infinity], ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["fraction", 0.5], ["numeric string", "2" as unknown as number], ["null", null as unknown as number]];

const malformedReservation: Array<[string, number]> = [...malformed, ["int32 overflow", 2_147_483_648], ["safe integer above storage range", Number.MAX_SAFE_INTEGER]];

for (const [name, amount] of malformedReservation) test("malformed " + name + " never writes admission, reservation, settlement or events", async () => owned(async (store, governance) => {
  const events: unknown[] = [], emitter = createRunEventEmitter({ sink: async event => { events.push(event); } });
  const spend = createSpendService({ governanceStore: governance });
  const service = createRunService({ store, governance: { spend, events: emitter, estimatedCents: amount } });
  await expect(service.admit(input)).rejects.toBeInstanceOf(RangeError);
  expect(await store.listRuns(principal, 100)).toEqual([]); expect(events).toEqual([]);
  await expect(spend.admit({ principal, slug: input.slug, estimatedCents: amount })).rejects.toBeInstanceOf(RangeError);
  const run = await store.createRun(input);
  await expect(spend.reserve(principal.orgId, run.id, amount)).rejects.toBeInstanceOf(RangeError);
  await expect(governance.createReservation({ orgId: principal.orgId, runId: run.id, estimatedCents: amount })).rejects.toBeInstanceOf(RangeError);
  expect(await governance.reservationsForRun(principal.orgId, run.id)).toEqual([]);
  const reservation = await spend.reserve(principal.orgId, run.id, 7);
  await expect(spend.reconcile(principal.orgId, run.id, amount)).rejects.toBeInstanceOf(RangeError);
  await expect(governance.reconcileReservation(reservation.id, amount, "charged")).rejects.toBeInstanceOf(RangeError);
  await expect(settleRun(store, { spend, events: emitter }, run, amount)).rejects.toBeInstanceOf(RangeError);
  await expect(settleRun(store, { spend, events: emitter }, { ...run, costCents: amount })).rejects.toBeInstanceOf(RangeError);
  expect(await governance.reservationsForRun(principal.orgId, run.id)).toEqual([reservation]); expect(events).toEqual([]);
  expect((await store.getRun(principal, run.id))?.status).toBe("queued");
}));

for (const [estimate, actual] of [[0, 0], [25, 9], [2_147_483_647, 2_147_483_647]] as const) test("valid cents preserve reserve and first-reconciliation replay: " + estimate, async () => owned(async (store, governance) => {
  const spend = createSpendService({ governanceStore: governance, ceilings: { perRun: { cpu: 1, memoryMB: 128, durationSeconds: 1, networkMB: 0, artifactBytes: 0 }, concurrency: 1, monthlyTotalCents: Number.MAX_SAFE_INTEGER } });
  const run = await createRunService({ store, governance: { spend, estimatedCents: estimate } }).admit(input);
  const before = await governance.reservationsForRun(principal.orgId, run.id); expect(before[0]?.estimatedCents).toBe(estimate);
  const claim = await store.claimNextRun({ workerId: "owned-amount-worker" }); expect(claim?.id).toBe(run.id);
  const terminal = await store.transitionRun(run.id, { status: "succeeded" }, claim!.leaseGeneration); expect(terminal).not.toBeNull();
  await settleRun(store, { spend }, terminal!, actual);
  const after = await governance.reservationsForRun(principal.orgId, run.id); expect(after[0]?.actualCents).toBe(actual); expect(after[0]?.status).toBe(actual ? "charged" : "released");
  await settleRun(store, { spend }, terminal!, 0); expect(await governance.reservationsForRun(principal.orgId, run.id)).toEqual(after);
  for (const [, amount] of malformedReservation) await expect(settleRun(store, { spend }, terminal!, amount)).rejects.toBeInstanceOf(RangeError);
  expect(await governance.reservationsForRun(principal.orgId, run.id)).toEqual(after);
}));

test("admission captures validated estimate before asynchronous offline work", async () => owned(async (store, governance) => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const options = { spend: createSpendService({ governanceStore: governance }), estimatedCents: 7, offline: { async assertCanRunLocal() { entered(); await held; } } };
  const pending = createRunService({ store, governance: options }).admit(input);
  try { await ready; options.estimatedCents = -1; } finally { release(); }
  const run = await pending; expect((await governance.reservationsForRun(principal.orgId, run.id))[0]?.estimatedCents).toBe(7);
}));

test("memory store refuses invalid direct writes and preserves terminal reconciliation", async () => {
  const store = new MemoryGovernanceStore();
  for (const [, amount] of malformedReservation) await expect(store.createReservation({ orgId: "owned", runId: "owned", estimatedCents: amount })).rejects.toBeInstanceOf(RangeError);
  expect(await store.reservationsForRun("owned", "owned")).toEqual([]);
  const reservation = await store.createReservation({ orgId: "owned", runId: "owned", estimatedCents: 0 });
  for (const [, amount] of malformedReservation) await expect(store.reconcileReservation(reservation.id, amount, "charged")).rejects.toBeInstanceOf(RangeError);
  expect(await store.reservationsForRun("owned", "owned")).toEqual([reservation]);
  const released = await store.reconcileReservation(reservation.id, 0, "released");
  expect(await store.reconcileReservation(reservation.id, 1, "charged")).toEqual(released);
});

for (const [name, amount] of malformed) test("malformed monthly ceiling " + name + " refuses before store use", () => {
  expect(() => createSpendService({ governanceStore: new MemoryGovernanceStore(), ceilings: { perRun: { cpu: 1, memoryMB: 128, durationSeconds: 1, networkMB: 0, artifactBytes: 0 }, concurrency: 1, monthlyTotalCents: amount } })).toThrow(RangeError);
});


test("monthly totals and ceilings can exceed a single reservation's storage range", async () => {
  const now = new Date("2026-01-15T00:00:00.000Z");
  const store = new MemoryGovernanceStore({ runs: [0, 1].map(() => ({ orgId: principal.orgId, costCents: 2_147_483_647, status: "succeeded", createdAt: now.toISOString() })) });
  expect(await store.monthlySpendCents(principal.orgId, "2026-01")).toBe(4_294_967_294);
  const ceilings = { perRun: { cpu: 1, memoryMB: 128, durationSeconds: 1, networkMB: 0, artifactBytes: 0 }, concurrency: 1, monthlyTotalCents: 4_294_967_319 };
  const spend = createSpendService({ governanceStore: store, ceilings });
  await expect(spend.admit({ principal, slug: input.slug, estimatedCents: 25, now })).resolves.toBeUndefined();
  await expect(spend.admit({ principal, slug: input.slug, estimatedCents: 26, now })).rejects.toMatchObject({ code: "RUN_BUDGET_EXHAUSTED" });
  const large = createSpendService({ governanceStore: store, ceilings: { ...ceilings, monthlyTotalCents: Number.MAX_SAFE_INTEGER } });
  await expect(large.admit({ principal, slug: input.slug, estimatedCents: 2_147_483_647, now })).resolves.toBeUndefined();
});
