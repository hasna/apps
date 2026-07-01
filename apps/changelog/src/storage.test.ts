import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalChangelogStore } from "./storage.js";

async function tempStore(): Promise<LocalChangelogStore> {
  const dataDir = await mkdtemp(join(tmpdir(), "open-changelog-"));
  return new LocalChangelogStore({ dataDir });
}

describe("LocalChangelogStore", () => {
  test("creates, lists, reads, updates, and counts entries", async () => {
    const store = await tempStore();
    const first = await store.createEntry({
      appId: "app-a",
      version: "0.1.0",
      kind: "added",
      title: "first",
      tags: ["Release"],
    });
    await store.createEntry({
      appId: "app-b",
      version: "0.2.0",
      kind: "fixed",
      title: "second",
    });

    expect(await store.getEntry(first.id)).toMatchObject({ title: "first" });
    expect(await store.listEntries({ appId: "app-a" })).toHaveLength(1);
    expect(await store.updateEntry(first.id, { kind: "changed", title: "first updated" })).toMatchObject({
      kind: "changed",
      title: "first updated",
    });

    const stats = await store.stats();
    expect(stats.total).toBe(2);
    expect(stats.byApp["app-a"]).toBe(1);
    expect(stats.byVersion["0.1.0"]).toBe(1);
    expect(stats.byKind.changed).toBe(1);
  });
});

