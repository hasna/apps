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

  test("rejects duplicate entries by default and can promote unreleased entries", async () => {
    const store = await tempStore();
    await store.createEntry({
      appId: "app-a",
      kind: "added",
      title: "Release command",
      tasks: ["123"],
    }, { now: new Date("2026-07-01T00:00:00.000Z") });

    await expect(store.createEntry({
      appId: "app-a",
      kind: "added",
      title: "Release command",
      tasks: ["123"],
    })).rejects.toThrow("Duplicate changelog entry");

    await store.createEntry({
      appId: "app-a",
      kind: "added",
      title: "Release command",
      tasks: ["123"],
    }, { allowDuplicate: true });
    expect(await store.listEntries({ appId: "app-a" })).toHaveLength(2);

    await store.createEntry({
      appId: "app-b",
      kind: "added",
      title: "Release command",
      tasks: ["123"],
    });
    await store.createEntry({
      appId: "app-b",
      kind: "fixed",
      title: "Release fix",
      tasks: ["124"],
    });
    const release = await store.releaseEntries({
      appId: "app-b",
      version: "1.0.0",
      date: "2026-07-02",
    });
    expect(release.updated).toBe(2);
    expect(await store.listEntries({ appId: "app-b", version: "1.0.0" })).toHaveLength(2);
  });

  test("does not release entries into duplicate target fingerprints", async () => {
    const store = await tempStore();
    await store.createEntry({
      appId: "app-a",
      version: "1.0.0",
      kind: "fixed",
      title: "Same fix",
    });
    await store.createEntry({
      appId: "app-a",
      kind: "fixed",
      title: "Same fix",
    });

    await expect(store.releaseEntries({
      appId: "app-a",
      version: "1.0.0",
    })).rejects.toThrow("Duplicate released changelog entry");
    expect(await store.listEntries({ appId: "app-a", version: "1.0.0" })).toHaveLength(1);
  });
});
