import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFeedbackStore } from "./storage.js";

async function tempStore(): Promise<LocalFeedbackStore> {
  const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-"));
  return new LocalFeedbackStore({ dataDir });
}

describe("LocalFeedbackStore", () => {
  test("creates, lists, reads, updates, and counts feedback", async () => {
    const store = await tempStore();
    const first = await store.createFeedback({
      appId: "app-a",
      message: "first",
      kind: "bug",
      severity: "high",
      tags: ["Bug"],
    });
    await store.createFeedback({
      appId: "app-b",
      message: "second",
      kind: "idea",
    });

    expect(await store.getFeedback(first.id)).toMatchObject({ message: "first" });
    expect(await store.listFeedback({ appId: "app-a" })).toHaveLength(1);
    expect(await store.updateFeedbackStatus(first.id, "triaged")).toMatchObject({ status: "triaged" });

    const stats = await store.stats();
    expect(stats.total).toBe(2);
    expect(stats.byApp["app-a"]).toBe(1);
    expect(stats.byKind.bug).toBe(1);
    expect(stats.byStatus.triaged).toBe(1);
    expect(stats.bySeverity.high).toBe(1);
  });
});

