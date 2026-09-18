import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";
import { buildServer } from "./server.js";

let root = "";
afterEach(() => {
  closeDb();
  delete process.env.HASNA_REPOS_DB_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("Repos MCP stable list cursor", () => {
  test("updated_at churn and appends do not shift compact pages", async () => {
    root = mkdtempSync(join(tmpdir(), "repos-mcp-stable-"));
    process.env.HASNA_REPOS_DB_PATH = join(root, "repos.db");
    upsertRepo({ path: join(root, "a"), name: "a", remote_url: "github.com/hasna/a" });
    upsertRepo({ path: join(root, "b"), name: "b", remote_url: "github.com/hasna/b" });
    upsertRepo({ path: join(root, "c"), name: "c", remote_url: "github.com/hasna/c" });

    const tools = (buildServer() as any)._registeredTools;
    const first = parse(await tools.list_repos.handler({ limit: 1 }));
    expect(first.items.map((repo: any) => repo.name)).toEqual(["a"]);

    getDb().query("UPDATE repos SET updated_at = '2099-01-01T00:00:00Z' WHERE name = 'a'").run();
    upsertRepo({ path: join(root, "d"), name: "d", remote_url: "github.com/hasna/d" });

    const second = parse(await tools.list_repos.handler({ limit: 1, cursor: first.next_cursor }));
    expect(second.items.map((repo: any) => repo.name)).toEqual(["b"]);
    expect(second.total).toBe(3);
    expect(second.snapshot_max_id).toBe(first.snapshot_max_id);
  });
});
