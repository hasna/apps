import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChangelogRef, changelogSiteAppUrl, publishRelease } from "./release.js";
import { LocalChangelogStore } from "./storage.js";
import { normalizeAppId, parseAppId } from "./validation.js";

async function seededStore(dir: string): Promise<LocalChangelogStore> {
  const store = new LocalChangelogStore({ filePath: join(dir, "entries.jsonl") });
  await store.createEntry({
    appId: "open-todos",
    title: "Add reconcile loop",
    kind: "added",
    date: "2026-07-01",
  }, { source: "sdk" });
  await store.createEntry({
    appId: "open-todos",
    title: "Fix rollout verify race",
    kind: "fixed",
    date: "2026-07-02",
  }, { source: "sdk" });
  await store.createEntry({
    appId: "open-uptime",
    title: "Unrelated app entry",
    kind: "changed",
    date: "2026-07-03",
  }, { source: "sdk" });
  return store;
}

describe("appId alignment with hasna.app.v1", () => {
  test("normalizes npm names to the open- repo convention", () => {
    expect(normalizeAppId("@hasna/todos")).toBe("open-todos");
    expect(normalizeAppId("@hasna/open-chrome")).toBe("open-chrome");
    expect(normalizeAppId("open-todos")).toBe("open-todos");
    expect(normalizeAppId("Open_Todos ")).toBe("open-todos");
    expect(normalizeAppId("@scope/some.pkg")).toBe("some-pkg");
    expect(() => normalizeAppId("@@@")).toThrow(/appId/);
  });

  test("parseAppId validates the slug", () => {
    expect(parseAppId("@hasna/changelog")).toBe("open-changelog");
    expect(() => parseAppId(42)).toThrow();
  });
});

describe("publishRelease", () => {
  test("promotes pending entries, writes the changelog, and returns a changelogRef", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-changelog-release-"));
    process.env["CHANGELOG_DATA_DIR"] = join(dir, "data");
    const store = await seededStore(dir);
    const target = join(dir, "CHANGELOG.md");

    const result = await publishRelease({
      appId: "@hasna/todos",
      version: "1.2.3",
      date: "2026-07-06",
      store,
      targetPath: target,
      cwd: dir,
    });

    expect(result.appId).toBe("open-todos");
    expect(result.released.updated).toBe(2);
    expect(result.publish.mode).toBe("write");
    expect(existsSync(target)).toBe(true);
    const markdown = await readFile(target, "utf8");
    expect(markdown).toContain("## [1.2.3] - 2026-07-06");
    expect(markdown).toContain("Add reconcile loop");
    expect(markdown).not.toContain("Unrelated app entry");

    expect(result.changelogRef).toMatchObject({
      kind: "document",
      id: "changelog:open-todos@1.2.3",
      externalId: "open-todos@1.2.3",
      sourcePackage: "@hasna/changelog",
      tags: ["changelog"],
    });
    expect(result.changelogRef.uri).toStartWith("file://");
  });

  test("uses the site base URL for the ref and tolerates zero promoted entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-changelog-release-empty-"));
    const store = new LocalChangelogStore({ filePath: join(dir, "entries.jsonl") });
    const result = await publishRelease({
      appId: "open-todos",
      version: "2.0.0",
      store,
      targetPath: join(dir, "CHANGELOG.md"),
      cwd: dir,
      baseUrl: "https://changelog.hasna.com/",
    });
    expect(result.released.updated).toBe(0);
    expect(result.changelogRef.uri).toBe("https://changelog.hasna.com/apps/open-todos/");
  });

  test("buildChangelogRef and changelogSiteAppUrl are stable", () => {
    expect(changelogSiteAppUrl("https://x.example//", "open-todos")).toBe("https://x.example/apps/open-todos/");
    expect(buildChangelogRef({ appId: "open-todos", version: "1.0.0" }).name).toBe("open-todos 1.0.0 changelog");
  });
});
