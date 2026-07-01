import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
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
});
