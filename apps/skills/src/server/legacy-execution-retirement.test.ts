import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler } from "./app.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { executeRun } from "./handlers.js";
import { MemorySkillsStore } from "./store.js";
import { runWorkerOnce } from "./worker.js";
import { StaleLeaseGenerationError } from "./types.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const token = "legacy-retirement-fixture";
const principal = { orgId: "retirement-test-org", userId: "retirement-test-user" };
const legacySlugs = ["transcript", "audio-transcript-pack", "video-highlight-pack", "unpublished-fixture"];

async function fixture(inlineWorker = false) {
  const store = new MemorySkillsStore([{ token, principal }]);
  const actor = store.addApiKey(token, principal);
  const artifactStorage = new ArtifactStorage();
  const handler = await createSkillsFetchHandler({
    store,
    governanceStore: new MemoryGovernanceStore(),
    artifactStorage,
    runtime: null,
    config: { allowEphemeralStore: true, inlineWorker },
  });
  const request = (path: string, init: RequestInit = {}) => handler(new Request(`http://localhost/api/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  }));
  return { store, actor, artifactStorage, request };
}

describe("retired unversioned execution", () => {
  for (const inlineWorker of [false, true]) {
    test(`rejects every unversioned submission before enqueue (inlineWorker=${inlineWorker})`, async () => {
      const ctx = await fixture(inlineWorker);
      for (const slug of legacySlugs) {
        const response = await ctx.request(`runs/${slug}`, {
          method: "POST",
          body: JSON.stringify({ input: { transcript: "Owned retirement fixture." } }),
        });
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ code: "LEGACY_EXECUTION_RETIRED" });
        expect(await ctx.store.listRuns(ctx.actor, 100)).toEqual([]);
        expect(await runWorkerOnce(ctx.store, "empty-retirement-worker")).toBe(false);
      }
    });
  }

  test("old queued rows reach a fenced terminal refusal without producing artifacts", async () => {
    const ctx = await fixture();
    for (const slug of legacySlugs) {
      const run = await ctx.store.createRun({ principal: ctx.actor, slug, input: { text: "Owned fixture." }, args: [] });
      expect(await runWorkerOnce(ctx.store, "legacy-drain-worker")).toBe(true);
      const result = await ctx.store.getRun(ctx.actor, run.id);
      expect(result).toMatchObject({ status: "failed", errorCode: "LEGACY_EXECUTION_RETIRED" });
      expect(await ctx.store.listArtifacts(ctx.actor, run.id)).toEqual([]);
    }
  });

  test("already completed historical runs and their authorized outputs remain readable", async () => {
    const ctx = await fixture();
    const run = await ctx.store.createRun({ principal: ctx.actor, slug: "historical-fixture", input: {}, args: [] });
    const completed = await ctx.store.updateRun(run.id, { status: "succeeded", completedAt: new Date().toISOString() });
    if (!completed) throw new Error("historical fixture run missing");
    const bodyText = "historical owned output\n";
    const artifact = await ctx.artifactStorage.materialize(run, {
      id: "historical-output",
      orgId: ctx.actor.orgId,
      runId: run.id,
      fileName: "result.txt",
      relativePath: "result.txt",
      contentType: "text/plain",
      byteSize: Buffer.byteLength(bodyText),
      sha256: createHash("sha256").update(bodyText).digest("hex"),
      visibility: "private",
    }, { relativePath: "result.txt", bodyText, contentType: "text/plain" });
    await ctx.store.addArtifact(artifact);
    expect(await executeRun(ctx.store, completed!, ctx.artifactStorage)).toEqual(completed);
    const read = await ctx.request(`runs/${run.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ status: "succeeded" });
    const output = await ctx.request(`runs/${run.id}/artifacts/${artifact.id}`);
    expect(output.status).toBe(200);
    expect(await output.text()).toBe(bodyText);
    expect(await ctx.store.listLogs(ctx.actor, run.id)).toEqual([]);
  });

  test("a cancelled run cannot be changed or given outputs by an older worker", async () => {
    const ctx = await fixture();
    const run = await ctx.store.createRun({ principal: ctx.actor, slug: "transcript", input: { text: "owned cancellation fixture" }, args: [] });
    const claimed = await ctx.store.claimNextRun({ workerId: "old-legacy-worker" });
    expect(claimed?.id).toBe(run.id);
    await ctx.store.transitionRun(run.id, { status: "cancelled", leaseGeneration: claimed!.leaseGeneration + 1 }, claimed!.leaseGeneration);
    await expect(executeRun(ctx.store, claimed!, ctx.artifactStorage)).rejects.toBeInstanceOf(StaleLeaseGenerationError);
    expect((await ctx.store.getRun(ctx.actor, run.id))?.status).toBe("cancelled");
    expect(await ctx.store.listArtifacts(ctx.actor, run.id)).toEqual([]);
  });
});
