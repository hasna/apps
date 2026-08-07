import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { ConversationsClient, type ProjectPage } from "./index.js";

describe("generated SDK project linkage and pagination contract", () => {
  test("generated Channel type exposes the stable channel id without removing name", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
    expect(source).toContain('export interface Channel { "id"?: string; "name"?: string;');
  });

  test("listProjects accepts limit/cursor/offset and listChannels accepts project_id", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(source).toContain(
      'async listProjects(query?: { "status"?: string; "limit"?: number; "cursor"?: number; "offset"?: number }',
    );
    expect(source).toContain(
      'async listChannels(query?: { "include_archived"?: boolean; "project_id"?: string }',
    );
  });

  test("a caller can follow SDK project pages to exhaustion and filter linked channels", async () => {
    const requestedUrls: string[] = [];
    const pages: Record<number, ProjectPage> = {
      0: {
        projects: [{ id: "project-alpha", name: "Alpha" }, { id: "project-bravo", name: "Bravo" }],
        count: 2,
        cursor: 0,
        limit: 2,
        has_more: true,
        next_cursor: 2,
      },
      2: {
        projects: [{ id: "project-charlie", name: "Charlie" }],
        count: 1,
        cursor: 2,
        limit: 2,
        has_more: false,
        next_cursor: null,
      },
    };
    const client = new ConversationsClient({
      baseUrl: "https://conversations.example.invalid",
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        requestedUrls.push(url.toString());
        if (url.pathname === "/v1/channels") {
          return new Response(JSON.stringify({ channels: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const cursor = Number(url.searchParams.get("cursor") ?? "0");
        return new Response(JSON.stringify(pages[cursor]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const ids: string[] = [];
    let cursor = 0;
    while (true) {
      const page = await client.listProjects({ limit: 2, cursor });
      ids.push(...page.projects.map((project) => project.id ?? ""));
      if (!page.has_more || page.next_cursor === null || page.next_cursor === undefined) break;
      cursor = page.next_cursor;
    }
    await client.listChannels({ project_id: "project-alpha" });

    expect(ids).toEqual(["project-alpha", "project-bravo", "project-charlie"]);
    expect(requestedUrls[0]).toContain("limit=2");
    expect(requestedUrls[1]).toContain("cursor=2");
    expect(requestedUrls[2]).toContain("project_id=project-alpha");
  });
});
