import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import {
  buildResourceSnapshot,
  subscribeResource,
  unsubscribeResource,
  listSubscriptions,
  isSnapshotStale,
  getChangedResourcesSince,
  resetSubscriptions,
  resourceDiagnostics,
  RESOURCE_URIS,
} from "./resource-snapshots.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  resetSubscriptions();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  resetSubscriptions();
});

describe("buildResourceSnapshot", () => {
  it("builds deterministic snapshots for standard URIs", () => {
    createTask({ title: "Snap task" });
    for (const uri of RESOURCE_URIS) {
      const snap = buildResourceSnapshot(uri, 60_000);
      expect(snap.schema_version).toBe("todos.resource-snapshot.v1");
      expect(snap.uri).toBe(uri);
      expect(snap.content_hash).toBeTruthy();
      expect(isSnapshotStale(snap)).toBe(false);
    }
  });

  it("marks snapshot stale after stale_after", () => {
    const snap = buildResourceSnapshot("todos://tasks", 0);
    expect(isSnapshotStale(snap)).toBe(true);
  });
});

describe("subscriptions", () => {
  it("subscribe and unsubscribe resources", () => {
    subscribeResource("todos://tasks", "agent-1");
    expect(listSubscriptions("agent-1")).toHaveLength(1);
    expect(unsubscribeResource("todos://tasks", "agent-1")).toBe(true);
    expect(listSubscriptions()).toHaveLength(0);
  });
});

describe("getChangedResourcesSince", () => {
  it("detects task changes", () => {
    const since = new Date(Date.now() - 1000).toISOString();
    createTask({ title: "Changed" });
    const changes = getChangedResourcesSince(since);
    expect(changes.some((c) => c.uri === "todos://tasks")).toBe(true);
  });
});

describe("resourceDiagnostics", () => {
  it("reports subscription count and URIs", () => {
    subscribeResource("todos://agents");
    const diag = resourceDiagnostics();
    expect(diag.subscriptions).toBe(1);
    expect(diag.uris).toContain("todos://tasks");
  });
});

describe("local-only", () => {
  it("no hosted transport in module", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "resource-snapshots.ts"), "utf8");
    expect(src).not.toMatch(/fetch\s*\(|todos\.md|platform-todos/i);
  });
});
