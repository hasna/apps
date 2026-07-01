import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalChangelogStore } from "../storage.js";
import { buildChangelogMcpTools } from "./tools.js";

function textFromResult(result: Awaited<ReturnType<ReturnType<typeof buildChangelogMcpTools>[number]["run"]>>): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

describe("changelog MCP tools", () => {
  test("registers tool definitions and covers add/list/get/generate/publish", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "open-changelog-mcp-")) });
    const tools = buildChangelogMcpTools(store);
    expect(tools.map((tool) => tool.name)).toEqual([
      "add_changelog_entry",
      "list_changelog_entries",
      "get_changelog_entry",
      "update_changelog_entry",
      "generate_changelog",
      "publish_changelog",
      "changelog_stats",
      "export_changelog_jsonl",
    ]);

    const add = tools.find((tool) => tool.name === "add_changelog_entry");
    expect(add).toBeDefined();
    const addResult = await add!.run({
      app_id: "mcp-app",
      version: "0.1.0",
      title: "Agent changelog",
      kind: "added",
    });
    const created = JSON.parse(textFromResult(addResult)) as { id: string; appId: string; source: string };
    expect(created).toMatchObject({
      appId: "mcp-app",
      source: "mcp",
    });

    const list = tools.find((tool) => tool.name === "list_changelog_entries");
    expect(JSON.parse(textFromResult(await list!.run({ app_id: "mcp-app" })))).toHaveLength(1);

    const get = tools.find((tool) => tool.name === "get_changelog_entry");
    expect(JSON.parse(textFromResult(await get!.run({ id: created.id })))).toMatchObject({ id: created.id });

    const update = tools.find((tool) => tool.name === "update_changelog_entry");
    expect(JSON.parse(textFromResult(await update!.run({ id: created.id, kind: "fixed" })))).toMatchObject({ kind: "fixed" });

    const generate = tools.find((tool) => tool.name === "generate_changelog");
    expect(textFromResult(await generate!.run({ app_id: "mcp-app" }))).toContain("### Fixed");

    const publish = tools.find((tool) => tool.name === "publish_changelog");
    const publishResult = JSON.parse(textFromResult(await publish!.run({ app_id: "mcp-app", kind: "fixed", title: "MCP Notes" })));
    expect(publishResult).toMatchObject({ mode: "dry-run" });
    expect(publishResult.markdown).toContain("# MCP Notes");

    const stats = tools.find((tool) => tool.name === "changelog_stats");
    expect(JSON.parse(textFromResult(await stats!.run({})))).toMatchObject({ total: 1 });

    const exportJsonl = tools.find((tool) => tool.name === "export_changelog_jsonl");
    expect(textFromResult(await exportJsonl!.run({ app_id: "mcp-app" }))).toContain("Agent changelog");
  });
});
