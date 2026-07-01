import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateChangelogMarkdown } from "./markdown.js";
import { publishChangelog } from "./publisher.js";
import { LocalChangelogStore } from "./storage.js";

describe("markdown generation and publishing", () => {
  test("generates Keep a Changelog style markdown grouped by version and category", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-md-")) });
    await store.createEntry({
      appId: "open-changelog",
      version: "0.1.0",
      kind: "added",
      title: "Initial scaffold",
      details: "SDK, API, CLI, and MCP surfaces.",
      tasks: ["731aace9"],
    }, { now: new Date("2026-07-01T00:00:00.000Z") });

    const markdown = generateChangelogMarkdown(await store.listEntries({ appId: "open-changelog" }), { appId: "open-changelog" });
    expect(markdown).toContain("# open-changelog Changelog");
    expect(markdown).toContain("## [0.1.0] - 2026-07-01");
    expect(markdown).toContain("### Added");
    expect(markdown).toContain("- Initial scaffold");
    expect(markdown).toContain("Refs: task 731aace9");
  });

  test("sorts semver versions and links repository refs", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-semver-")) });
    await store.createEntry({
      appId: "app",
      version: "1.9.0",
      kind: "fixed",
      title: "Older fix",
    }, { now: new Date("2026-07-01T00:00:00.000Z") });
    await store.createEntry({
      appId: "app",
      version: "1.10.0",
      kind: "added",
      title: "Newer feature",
      commits: ["abcdef1"],
      tasks: ["42"],
    }, { now: new Date("2026-07-02T00:00:00.000Z") });

    const markdown = generateChangelogMarkdown(await store.listEntries({ appId: "app" }), {
      appId: "app",
      repositoryUrl: "https://github.com/hasna/changelog",
    });
    expect(markdown.indexOf("## [1.10.0]")).toBeLessThan(markdown.indexOf("## [1.9.0]"));
    expect(markdown).toContain("[commit abcdef1](https://github.com/hasna/changelog/commit/abcdef1)");
    expect(markdown).toContain("[task 42](https://github.com/hasna/changelog/issues/42)");
  });

  test("sorts semver prerelease numeric identifiers correctly", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-prerelease-")) });
    await store.createEntry({
      appId: "app",
      version: "1.0.0-beta.2",
      kind: "changed",
      title: "Beta 2",
    });
    await store.createEntry({
      appId: "app",
      version: "1.0.0-beta.10",
      kind: "changed",
      title: "Beta 10",
    });

    const markdown = generateChangelogMarkdown(await store.listEntries({ appId: "app" }), { appId: "app" });
    expect(markdown.indexOf("## [1.0.0-beta.10]")).toBeLessThan(markdown.indexOf("## [1.0.0-beta.2]"));
  });

  test("dry-runs by default and writes only with explicit write mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "open-changelog-publish-"));
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-data-")) });
    await store.createEntry({
      appId: "app",
      version: "1.0.0",
      kind: "fixed",
      title: "Fix publish safety",
    }, { now: new Date("2026-07-01T00:00:00.000Z") });

    const dryRun = await publishChangelog({ store, appId: "app", cwd });
    expect(dryRun.mode).toBe("dry-run");
    await expect(Bun.file(join(cwd, "CHANGELOG.md")).exists()).resolves.toBe(false);

    const write = await publishChangelog({ store, appId: "app", cwd, write: true });
    expect(write.mode).toBe("write");
    expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toContain("Fix publish safety");
  });

  test("can preview diffs and backs up existing files before write", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "open-changelog-diff-"));
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-diff-data-")) });
    await store.createEntry({
      appId: "app",
      version: "1.0.0",
      kind: "changed",
      title: "Generated entry",
    }, { now: new Date("2026-07-01T00:00:00.000Z") });
    await writeFile(join(cwd, "CHANGELOG.md"), "# Old\n", "utf8");

    const dryRun = await publishChangelog({ store, appId: "app", cwd, diff: true });
    expect(dryRun.diff).toContain("-# Old");
    expect(dryRun.diff).toContain("+# app Changelog");

    const write = await publishChangelog({ store, appId: "app", cwd, write: true });
    expect(write.backupPath).toBeString();
    expect(await readFile(write.backupPath!, "utf8")).toBe("# Old\n");
  });
});
