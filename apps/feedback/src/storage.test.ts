import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFeedbackStore, describeFeedbackStoreRuntime, LocalFeedbackStore } from "./storage.js";

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

  test("filters by date range and search text", async () => {
    const store = await tempStore();
    await store.createFeedback(
      {
        appId: "app-a",
        message: "billing export needs CSV",
        tags: ["reports"],
        context: { route: "/billing" },
      },
      { now: new Date("2026-01-01T00:00:00.000Z") },
    );
    await store.createFeedback(
      {
        appId: "app-a",
        message: "profile avatar upload fails",
        tags: ["account"],
      },
      { now: new Date("2026-02-01T00:00:00.000Z") },
    );

    expect(await store.listFeedback({ since: "2026-01-15", search: "avatar" })).toHaveLength(1);
    expect(await store.listFeedback({ until: "2026-01-15", search: "billing" })).toHaveLength(1);
    expect(await store.listFeedback({ tag: "reports", search: "/billing" })).toHaveLength(1);
  });

  test("serializes concurrent status updates", async () => {
    const store = await tempStore();
    const first = await store.createFeedback({ appId: "app-a", message: "first" });
    const second = await store.createFeedback({ appId: "app-a", message: "second" });

    await Promise.all([
      store.updateFeedbackStatus(first.id, "triaged"),
      store.updateFeedbackStatus(second.id, "closed"),
    ]);

    expect(await store.getFeedback(first.id)).toMatchObject({ status: "triaged" });
    expect(await store.getFeedback(second.id)).toMatchObject({ status: "closed" });
  });
});

describe("feedback storage runtime", () => {
  test("uses local JSONL storage by default", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-runtime-"));
    const diagnostics = describeFeedbackStoreRuntime({ env: { FEEDBACK_DATA_DIR: dataDir } });
    expect(diagnostics).toMatchObject({
      mode: "local",
      activeStore: "local-jsonl",
      ok: true,
      blockers: [],
    });
    expect(diagnostics.local?.dataFile).toBe(join(dataDir, "feedback.jsonl"));
    expect(createFeedbackStore({ env: { FEEDBACK_DATA_DIR: dataDir } })).toBeInstanceOf(LocalFeedbackStore);
  });

  test("fails closed for cloud mode until a host adapter is injected", async () => {
    const diagnostics = describeFeedbackStoreRuntime({
      env: {
        FEEDBACK_STORE: "cloud",
        FEEDBACK_CLOUD_PROVIDER: "aws-rds",
        FEEDBACK_CLOUD_DATABASE_URL: "postgres://user:super-secret@example.test/feedback",
        FEEDBACK_CLOUD_SECRET_ARN: "arn:aws:secretsmanager:example:secret:feedback",
        FEEDBACK_CLOUD_RESOURCE_ARN: "arn:aws:rds:example:cluster:feedback",
        FEEDBACK_CLOUD_TABLE: "feedback_items",
      },
    });

    expect(diagnostics).toMatchObject({
      mode: "cloud",
      activeStore: "unavailable",
      ok: false,
      cloud: {
        provider: "aws-rds",
        adapterProvided: false,
        databaseUrlConfigured: true,
        secretArnConfigured: true,
        resourceArnConfigured: true,
        tableNameConfigured: true,
        ready: false,
      },
    });
    expect(diagnostics.blockers.join(" ")).toContain("host-provided FeedbackStore adapter");
    expect(JSON.stringify(diagnostics)).not.toContain("super-secret");
    expect(JSON.stringify(diagnostics)).not.toContain("postgres://");
    expect(() => createFeedbackStore({ env: { FEEDBACK_STORE: "cloud" } })).toThrow("host-provided FeedbackStore adapter");
  });

  test("uses an injected cloud adapter when cloud mode is selected", async () => {
    const cloudStore = await tempStore();
    expect(createFeedbackStore({ env: { FEEDBACK_STORE: "cloud" }, cloudStore })).toBe(cloudStore);
    expect(describeFeedbackStoreRuntime({ env: { FEEDBACK_STORE: "cloud" }, cloudStore })).toMatchObject({
      mode: "cloud",
      activeStore: "cloud-adapter",
      ok: true,
      cloud: {
        adapterProvided: true,
        ready: true,
      },
    });
  });

  test("does not echo invalid runtime values in diagnostics", () => {
    const diagnostics = describeFeedbackStoreRuntime({
      env: {
        FEEDBACK_STORE: "postgres://user:secret-value@example.test/feedback",
      },
    });

    expect(diagnostics).toMatchObject({
      mode: "invalid",
      requestedMode: "invalid",
      activeStore: "unavailable",
      ok: false,
    });
    expect(diagnostics.blockers.join(" ")).toContain("Unsupported FEEDBACK_STORE");
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value");
    expect(JSON.stringify(diagnostics)).not.toContain("postgres://");
  });
});
