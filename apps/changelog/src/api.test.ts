import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChangelogHandler } from "./api.js";
import { ChangelogClient } from "./client.js";
import { LocalChangelogStore } from "./storage.js";

async function createTestClient() {
  const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-api-")) });
  const handler = createChangelogHandler({ store, apiToken: "test-token" });
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request);
  };
  return new ChangelogClient({
    baseUrl: "http://changelog.test",
    token: "test-token",
    fetch: fetchImpl,
  });
}

describe("Changelog HTTP API and SDK", () => {
  test("adds, lists, gets, updates, generates, and publishes through SDK", async () => {
    const client = await createTestClient();
    const created = await client.add({
      appId: "sdk-app",
      version: "0.1.0",
      kind: "added",
      title: "SDK issue",
    });
    expect(created.id).toBeString();
    expect(created.source).toBe("api");

    const list = await client.list({ appId: "sdk-app" });
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("SDK issue");
    expect(await client.get(created.id)).toMatchObject({ version: "0.1.0" });
    expect(await client.update(created.id, { kind: "fixed" })).toMatchObject({ kind: "fixed" });
    await client.add({
      appId: "sdk-app",
      version: "0.1.0",
      kind: "added",
      title: "Added-only entry",
      commits: ["abcdef1"],
    });
    const generatedAdded = await client.generate({ appId: "sdk-app", kind: "added", title: "SDK App Notes" });
    expect(generatedAdded).toContain("# SDK App Notes");
    expect(generatedAdded).toContain("Added-only entry");
    expect(generatedAdded).not.toContain("SDK issue");
    const generatedWithRefs = await client.generate({
      appId: "sdk-app",
      kind: "added",
      repositoryUrl: "https://github.com/hasna/changelog",
    });
    expect(generatedWithRefs).toContain("[commit abcdef1](https://github.com/hasna/changelog/commit/abcdef1)");
    const publish = await client.publish({ appId: "sdk-app", kind: "added", title: "SDK Publish Notes" });
    expect(publish.mode).toBe("dry-run");
    expect(publish.markdown).toContain("# SDK Publish Notes");
    expect(await client.exportJsonl({ appId: "sdk-app" })).toContain("SDK issue");
    expect(await client.stats()).toMatchObject({ total: 2 });
  });

  test("prevents duplicate SDK submissions unless explicitly allowed and releases entries", async () => {
    const client = await createTestClient();
    await client.add({
      appId: "release-app",
      kind: "added",
      title: "Release helper",
      tasks: ["17"],
    });
    await expect(client.add({
      appId: "release-app",
      kind: "added",
      title: "Release helper",
      tasks: ["17"],
    })).rejects.toThrow("Duplicate changelog entry");

    await client.add({
      appId: "release-app",
      kind: "added",
      title: "Release helper",
      tasks: ["17"],
    }, { allowDuplicate: true });
    expect(await client.list({ appId: "release-app" })).toHaveLength(2);

    await client.add({
      appId: "release-ok",
      kind: "added",
      title: "Release helper",
      tasks: ["17"],
    });
    await client.add({
      appId: "release-ok",
      kind: "fixed",
      title: "Release fix",
      tasks: ["18"],
    });
    const release = await client.release({
      appId: "release-ok",
      version: "1.0.0",
      date: "2026-07-01",
    });
    expect(release.updated).toBe(2);
    expect(await client.generate({ appId: "release-ok", version: "1.0.0" })).toContain("## [1.0.0] - 2026-07-01");
  });

  test("rejects requests with missing token when configured", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-auth-")) });
    const handler = createChangelogHandler({ store, apiToken: "required" });
    const response = await handler(new Request("http://changelog.test/v1/entries"));
    expect(response.status).toBe(401);
  });

  test("requires configured token auth for API publish write mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "open-changelog-api-write-"));
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-write-data-")) });
    await store.createEntry({
      appId: "api-app",
      version: "0.1.0",
      kind: "added",
      title: "Write-safe endpoint",
    });
    const handler = createChangelogHandler({ store });
    const response = await handler(new Request("http://changelog.test/v1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: "api-app", targetPath: join(cwd, "CHANGELOG.md"), write: true }),
    }));
    expect(response.status).toBe(403);
    await expect(Bun.file(join(cwd, "CHANGELOG.md")).exists()).resolves.toBe(false);
  });

  test("writes through API only with configured token and safe relative target", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "open-changelog-api-write-token-"));
    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-write-token-data-")) });
      await store.createEntry({
        appId: "api-app",
        version: "0.1.0",
        kind: "added",
        title: "Authorized write",
      });
      const handler = createChangelogHandler({ store, apiToken: "required" });
      const response = await handler(new Request("http://changelog.test/v1/publish", {
        method: "POST",
        headers: { "authorization": "Bearer required", "content-type": "application/json" },
        body: JSON.stringify({ appId: "api-app", targetPath: "CHANGELOG.md", write: true }),
      }));
      expect(response.status).toBe(200);
      expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toContain("Authorized write");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
