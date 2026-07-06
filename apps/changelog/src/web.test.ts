import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChangelogStore } from "./storage.js";
import { escapeHtml, generateChangelogSite } from "./web.js";

async function seededStore(dir: string): Promise<LocalChangelogStore> {
  const store = new LocalChangelogStore({ filePath: join(dir, "entries.jsonl") });
  await store.createEntry({
    appId: "open-todos",
    version: "1.0.0",
    title: "Add <script> safe rendering",
    message: "Escapes & renders entities",
    kind: "added",
    date: "2026-07-01",
    tags: ["web"],
  }, { source: "sdk" });
  await store.createEntry({
    appId: "open-todos",
    version: "1.1.0",
    title: "Fix feed dates",
    kind: "fixed",
    date: "2026-07-05",
  }, { source: "sdk" });
  await store.createEntry({
    appId: "open-uptime",
    title: "Pending change",
    kind: "changed",
    date: "2026-07-03",
  }, { source: "sdk" });
  return store;
}

describe("generateChangelogSite", () => {
  test("generates per-app pages, RSS, JSON feeds, and an index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-changelog-web-"));
    const store = await seededStore(dir);
    const outDir = join(dir, "site");

    const result = await generateChangelogSite({
      outDir,
      store,
      baseUrl: "https://changelog.hasna.com",
      title: "Hasna changelogs",
      now: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(result.apps.map((app) => app.appId)).toEqual(["open-todos", "open-uptime"]);
    const todos = result.apps[0]!;
    expect(todos.entries).toBe(2);
    expect(todos.latestVersion).toBe("1.1.0");

    for (const file of ["index.html", "site.json", "apps/open-todos/index.html", "apps/open-todos/rss.xml", "apps/open-todos/feed.json"]) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }

    const page = await readFile(join(outDir, "apps/open-todos/index.html"), "utf8");
    expect(page).toContain("open-todos changelog");
    expect(page).toContain("&lt;script&gt;");
    expect(page).not.toContain("<script> safe");
    expect(page).toContain('id="1.1.0"');
    expect(page).toContain("Fixed");

    const rss = await readFile(join(outDir, "apps/open-todos/rss.xml"), "utf8");
    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain("<title>open-todos changelog</title>");
    expect(rss).toContain("https://changelog.hasna.com/apps/open-todos/");
    expect(rss).toContain("[1.1.0] Fix feed dates");

    const feed = JSON.parse(await readFile(join(outDir, "apps/open-todos/feed.json"), "utf8")) as {
      version: string;
      items: Array<{ id: string; title: string; tags: string[]; _changelog: { appId: string; version: string } }>;
    };
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]!._changelog.appId).toBe("open-todos");
    expect(feed.items.some((item) => item.tags.includes("web"))).toBe(true);

    const index = await readFile(join(outDir, "index.html"), "utf8");
    expect(index).toContain("Hasna changelogs");
    expect(index).toContain('apps/open-todos/index.html');
    expect(index).toContain('apps/open-uptime/rss.xml');

    const siteJson = JSON.parse(await readFile(join(outDir, "site.json"), "utf8")) as { apps: Array<{ appId: string }> };
    expect(siteJson.apps).toHaveLength(2);
  });

  test("restricts output to one app when appId is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-changelog-web-single-"));
    const store = await seededStore(dir);
    const outDir = join(dir, "site");
    const result = await generateChangelogSite({ outDir, store, appId: "open-uptime" });
    expect(result.apps.map((app) => app.appId)).toEqual(["open-uptime"]);
    expect(existsSync(join(outDir, "apps/open-todos/index.html"))).toBe(false);
    const page = await readFile(join(outDir, "apps/open-uptime/index.html"), "utf8");
    expect(page).toContain("Unreleased");
  });

  test("escapeHtml covers the XML/HTML special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
