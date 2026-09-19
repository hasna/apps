process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDatabase, resetDatabase } from "../db/database.js";
import { countMemories, createMemory, indexMemoryEmbedding, listMemoriesPage } from "../db/memories.js";
import { registerMemoryInjectTools } from "../mcp/tools/memory-inject.js";
import { DEFAULT_CONFIG } from "./config.js";
import { MemoryInjector, smartInject } from "./injector.js";

// These tests use only synthetic in-memory records and the local embedding
// implementation. No provider credential or customer store is used.
const providerEnv = new Map(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"].map((key) => [key, process.env[key]]));
for (const key of providerEnv.keys()) delete process.env[key];
const network = spyOn(globalThis, "fetch").mockImplementation(() => {
  throw new Error("Project injection fixture must not make network requests");
});

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type RegisteredServer = McpServer & {
  _registeredTools: Record<string, { handler(args: Record<string, unknown>): Promise<ToolResult> }>;
};
let db: ReturnType<typeof getDatabase>;
let ids: Record<string, string>;

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
  ids = {};
  for (const id of ["project-a", "project-b"]) {
    db.run("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))", [id, id, `/fixture/${id}`]);
  }
  db.run(
    "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    ["project-alias-stable-id", "friendly-project-alias", "/fixture/friendly-project-alias"],
  );
  for (const id of ["owner", "other-agent"]) {
    db.run("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))", [id, id]);
  }
  for (const scope of ["global", "shared", "private", "working"] as const) {
    for (const [suffix, project_id] of [["selected", "project-a"], ["elsewhere", "project-b"], ["unassigned", undefined]] as const) {
      const key = `${scope}-${suffix}`;
      ids[key] = createMemory({
        key, value: `synthetic ${key}`, scope, category: "fact", importance: 8,
        project_id, agent_id: scope === "private" || scope === "working" ? "owner" : undefined,
        session_id: scope === "working" ? "fixture-session" : undefined,
      }, db).id;
    }
  }
  ids["different-owner"] = createMemory({ key: "different-owner", value: "synthetic different owner", scope: "private", category: "fact", importance: 8, project_id: "project-a", agent_id: "other-agent" }, db).id;
  for (const scope of ["shared", "private", "working"] as const) {
    const key = `${scope}-alias-selected`;
    ids[key] = createMemory({
      key,
      value: `synthetic ${key}`,
      scope,
      category: "fact",
      importance: 9,
      project_id: "project-alias-stable-id",
      agent_id: scope === "private" || scope === "working" ? "owner" : undefined,
      session_id: scope === "working" ? "fixture-session" : undefined,
    }, db).id;
  }
});

afterEach(() => {
  expect(network).not.toHaveBeenCalled();
});

afterAll(() => {
  network.mockRestore();
  resetDatabase();
  for (const [key, value] of providerEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function accessCount(key: string): number {
  return (db.query("SELECT access_count FROM memories WHERE id = ?").get(ids[key]) as { access_count: number }).access_count;
}

function crowdOtherProjectPrivatePage(): string[] {
  return Array.from({ length: 105 }, (_, index) => createMemory({
    key: `other-project-crowding-${index}`, value: "synthetic other-project candidate", scope: "private", category: "fact", importance: 10, project_id: "project-b", agent_id: "owner",
  }, db).id);
}

async function invokeMcp(args: Record<string, unknown>): Promise<ToolResult> {
  const server = new McpServer({ name: "project-scope-fixture", version: "0.0.0" }) as RegisteredServer;
  registerMemoryInjectTools(server);
  return server._registeredTools["memory_inject"]!.handler(args);
}

const aliasProjectRefs = ["friendly-project-alias", "/fixture/friendly-project-alias"] as const;
const libraryStrategies = ["default", "smart-no-query", "smart-no-embeddings", "smart-embeddings", "smart-pipeline"] as const;
async function invokeLibrary(strategy: typeof libraryStrategies[number], project_id?: string): Promise<string> {
  const options = { project_id, agent_id: "owner", session_id: "fixture-session", machine_id: null, max_tokens: 12000, min_importance: 1, categories: ["fact" as const], db };
  const injector = new MemoryInjector(DEFAULT_CONFIG);
  if (strategy === "default") return injector.getInjectionContext(options);
  if (strategy === "smart-pipeline") return (await smartInject({ ...options, task_context: "synthetic scope fixture" })).output;
  if (strategy === "smart-embeddings") {
    const memoryId = project_id && aliasProjectRefs.includes(project_id as typeof aliasProjectRefs[number])
      ? ids["private-alias-selected"]!
      : ids["private-selected"]!;
    await indexMemoryEmbedding(memoryId, "synthetic scope fixture", db);
  }
  return injector.getSmartInjectionContext({ ...options, query: strategy === "smart-no-query" ? undefined : "synthetic scope fixture" });
}

describe("library injector explicit project visibility", () => {
  for (const strategy of libraryStrategies) {
    test(`${strategy} applies private project eligibility before the candidate limit`, async () => {
      crowdOtherProjectPrivatePage();
      const output = await invokeLibrary(strategy, "project-a");
      expect(output).toContain("private-selected");
      expect(output).toContain("private-unassigned");
      expect(output).not.toContain("other-project-crowding");
      expect(accessCount("private-selected")).toBeGreaterThan(0);
      expect(accessCount("private-unassigned")).toBeGreaterThan(0);
      expect((db.query("SELECT SUM(access_count) AS count FROM memories WHERE key LIKE 'other-project-crowding-%'").get() as { count: number }).count).toBe(0);
    });

    test(`${strategy} keeps unassigned owner-private and global memories, excludes other-project private memories`, async () => {
      const output = await invokeLibrary(strategy, "project-a");
      // Library global visibility and unassigned agent-private context are
      // intentional; an explicit project only excludes private rows owned by a
      // different project. Shared and working rows remain project-scoped.
      for (const key of ["private-selected", "private-unassigned", "global-selected", "global-elsewhere", "global-unassigned", "shared-selected", "working-selected"]) expect(output).toContain(key);
      for (const key of ["private-elsewhere", "shared-elsewhere", "shared-unassigned", "working-elsewhere", "working-unassigned", "different-owner"]) {
        expect(output).not.toContain(key);
        expect(accessCount(key)).toBe(0);
      }
      expect(accessCount("private-selected")).toBeGreaterThan(0);
      expect(accessCount("private-unassigned")).toBeGreaterThan(0);
    });

    test(`${strategy} preserves private visibility without an explicit project`, async () => {
      const output = await invokeLibrary(strategy);
      for (const key of ["private-selected", "private-elsewhere", "private-unassigned"]) expect(output).toContain(key);
      expect(output).not.toContain("different-owner");
    });

    test(`${strategy} canonicalizes project names and paths to the stable id exactly once`, async () => {
      for (const projectRef of aliasProjectRefs) {
        if (strategy === "smart-pipeline") {
          await indexMemoryEmbedding(ids["private-alias-selected"]!, "synthetic scope fixture", db);
        }
        const queries = spyOn(db, "query");
        try {
          const output = await invokeLibrary(strategy, projectRef);
          for (const key of ["shared-alias-selected", "private-alias-selected", "working-alias-selected"]) {
            expect(output).toContain(key);
            expect(accessCount(key)).toBeGreaterThan(0);
          }
          for (const key of ["shared-selected", "private-selected", "working-selected", "private-elsewhere"]) {
            expect(output).not.toContain(key);
          }
          const projectLookups = queries.mock.calls.filter(([statement]) =>
            /^SELECT \* FROM projects WHERE (?:id|path|LOWER\(name\)) = \?/.test(String(statement))
          );
          expect(projectLookups).toHaveLength(projectRef.startsWith("/") ? 2 : 3);
          if (strategy === "smart-pipeline") {
            expect(db.query("SELECT project_id FROM memories WHERE key = ?").get("_profile_project_project-alias-stable-id")).toMatchObject({ project_id: "project-alias-stable-id" });
            expect(db.query("SELECT id FROM memories WHERE key = ?").get(`_profile_project_${projectRef}`)).toBeNull();
          }
        } finally {
          queries.mockRestore();
        }
      }
    });

    test(`${strategy} rejects unknown projects before reading or touching memories`, async () => {
      // A missing project must fail before candidate/profile reads, not merely
      // return an empty render after already reading or touching other rows.
      const queries = spyOn(db, "query");
      const prepared = spyOn(db, "prepare");
      try {
        await expect(invokeLibrary(strategy === "smart-embeddings" ? "smart-no-embeddings" : strategy, "missing-project")).rejects.toThrow("Project not found: missing-project");
        const sql = [...queries.mock.calls, ...prepared.mock.calls].map(([statement]) => statement);
        expect(sql.some((statement) => /\b(?:memories|memory_embeddings|tool_events)\b/i.test(statement))).toBe(false);
      } finally {
        queries.mockRestore();
        prepared.mockRestore();
      }
      for (const key of Object.keys(ids)) expect(accessCount(key)).toBe(0);
    });
  }
});

const mcpStrategies = [
  ["default", {}],
  ["hints", { mode: "hints" }],
  ["explicit-full", { mode: "full" }],
  ["smart-query", { mode: "full", strategy: "smart", query: "synthetic scope fixture" }],
  ["activation", { mode: "full", task_context: "synthetic scope fixture" }],
  ["smart-pipeline", { mode: "full", strategy: "smart", task_context: "synthetic scope fixture" }],
] as const;
describe("MCP injector explicit project visibility", () => {
  for (const [name, strategy] of mcpStrategies) {
    test(`${name} applies private project eligibility before the candidate limit`, async () => {
      crowdOtherProjectPrivatePage();
      const result = await invokeMcp({ ...strategy, project_id: "project-a", agent_id: "owner", session_id: "fixture-session", machine_id: "fixture-machine", max_tokens: 12000, min_importance: 1, categories: ["fact"], format: "compact" });
      expect(result.isError).not.toBe(true);
      const output = result.content[0]!.text;
      if (name === "default" || name === "hints") {
        expect(output).toContain("Facts (5)");
        expect(output).toContain("unassigned");
      } else {
        expect(output).toContain("private-selected");
        expect(output).toContain("private-unassigned");
        expect(accessCount("private-selected")).toBeGreaterThan(0);
      }
      expect(output).not.toContain("crowding");
      expect((db.query("SELECT SUM(access_count) AS count FROM memories WHERE key LIKE 'other-project-crowding-%'").get() as { count: number }).count).toBe(0);
    });

    test(`${name} preserves unassigned owner-private context without exposing other-project private memories`, async () => {
      const result = await invokeMcp({ ...strategy, project_id: "project-a", agent_id: "owner", session_id: "fixture-session", machine_id: "fixture-machine", max_tokens: 12000, min_importance: 1, categories: ["fact"], format: "compact" });
      expect(result.isError).not.toBe(true);
      const output = result.content[0]!.text;
      if (name === "default" || name === "hints") {
        // MCP default candidates: selected global/shared, selected and
        // unassigned private, and selected working memory = five facts.
        expect(output).toContain("Facts (5)");
        expect(output).toContain("unassigned");
        expect(output).not.toContain("elsewhere");
      } else {
        for (const key of ["private-selected", "private-unassigned", "shared-selected", "working-selected"]) expect(output).toContain(key);
        for (const key of ["private-elsewhere", "shared-elsewhere", "shared-unassigned", "working-elsewhere", "working-unassigned", "different-owner"]) expect(output).not.toContain(key);
        // The full smart pipeline retains library global visibility; the MCP
        // direct strategy already restricts global records to the project.
        expect(output.includes("global-elsewhere")).toBe(name === "smart-pipeline");
        expect(accessCount("private-selected")).toBeGreaterThan(0);
      }
      expect(accessCount("private-elsewhere")).toBe(0);
      expect(accessCount("different-owner")).toBe(0);
    });

    test(`${name} preserves private visibility without an explicit project`, async () => {
      const result = await invokeMcp({ ...strategy, agent_id: "owner", session_id: "fixture-session", machine_id: "fixture-machine", max_tokens: 12000, min_importance: 1, categories: ["fact"], format: "compact" });
      expect(result.isError).not.toBe(true);
      const output = result.content[0]!.text;
      if (name === "default" || name === "hints") {
        expect(output).toContain("Facts (11)");
        expect(output).toContain("elsewhere");
        expect(output).toContain("unassigned");
      } else {
        for (const key of ["private-selected", "private-elsewhere", "private-unassigned"]) expect(output).toContain(key);
        expect(output).not.toContain("different-owner");
        expect(output).not.toContain("shared-selected");
      }
    });

    test(`${name} canonicalizes project names and paths to the stable id exactly once`, async () => {
      for (const projectRef of aliasProjectRefs) {
        if (name === "smart-query" || name === "activation" || name === "smart-pipeline") {
          await indexMemoryEmbedding(ids["private-alias-selected"]!, "synthetic scope fixture", db);
        }
        const queries = spyOn(db, "query");
        try {
          const result = await invokeMcp({
            ...strategy,
            project_id: projectRef,
            agent_id: "owner",
            session_id: "fixture-session",
            machine_id: "fixture-machine",
            max_tokens: 12000,
            min_importance: 1,
            categories: ["fact"],
            format: "compact",
          });
          expect(result.isError).not.toBe(true);
          const output = result.content[0]!.text;
          if (name === "default" || name === "hints") {
            expect(output).toContain("alias");
          } else {
            for (const key of ["shared-alias-selected", "private-alias-selected", "working-alias-selected"]) {
              expect(output).toContain(key);
            }
            expect(output).not.toContain("private-selected");
            expect(output).not.toContain("private-elsewhere");
            expect(accessCount("private-alias-selected")).toBeGreaterThan(0);
          }
          const projectLookups = queries.mock.calls.filter(([statement]) =>
            /^SELECT \* FROM projects WHERE (?:id|path|LOWER\(name\)) = \?/.test(String(statement))
          );
          expect(projectLookups).toHaveLength(projectRef.startsWith("/") ? 2 : 3);
        } finally {
          queries.mockRestore();
        }
      }
    });

    test(`${name} rejects unknown projects before any memory or profile work`, async () => {
      const queries = spyOn(db, "query");
      const prepared = spyOn(db, "prepare");
      try {
        const result = await invokeMcp({ ...strategy, project_id: "missing-project", agent_id: "owner", machine_id: "fixture-machine" });
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("Project not found: missing-project");
        const sql = [...queries.mock.calls, ...prepared.mock.calls].map(([statement]) => statement);
        expect(sql.some((statement) => /\b(?:memories|memory_embeddings|tool_events)\b/i.test(statement))).toBe(false);
      } finally {
        queries.mockRestore();
        prepared.mockRestore();
      }
      for (const key of Object.keys(ids)) expect(accessCount(key)).toBe(0);
    });
  }
});

test("null-or-project list eligibility is opt-in and applied before pagination", () => {
  crowdOtherProjectPrivatePage();
  db.run("UPDATE memories SET importance = 9 WHERE id = ?", [ids["private-selected"]]);
  const base = { scope: "private" as const, agent_id: "owner", project_id: "project-a", limit: 1 };
  expect(listMemoriesPage(base, db).rows.map((row) => row.key)).toEqual(["private-selected"]);
  expect(listMemoriesPage({ ...base, include_unassigned_project: false, offset: 1 }, db).rows).toEqual([]);
  expect(listMemoriesPage({ ...base, include_unassigned_project: true }, db).rows.map((row) => row.key)).toEqual(["private-selected"]);
  expect(listMemoriesPage({ ...base, include_unassigned_project: true, offset: 1 }, db).rows.map((row) => row.key)).toEqual(["private-unassigned"]);
  expect(listMemoriesPage({ ...base, include_unassigned_project: true, offset: 2 }, db).rows).toEqual([]);
  expect(countMemories(base, db)).toBe(1);
  expect(countMemories({ ...base, include_unassigned_project: true }, db)).toBe(2);
  expect(listMemoriesPage({ scope: "private", agent_id: "owner", include_unassigned_project: true, limit: 200 }, db).rows).toHaveLength(109);
});
