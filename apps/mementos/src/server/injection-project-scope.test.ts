import { mintApiKey } from "@hasna/contracts/auth";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { isApiMode } from "../db/api-mode.js";
import { MementosClient } from "../sdk/index.js";
import { matchRoute } from "./router.js";
import { checkApiKey } from "./auth.js";
import "./routes/memories-crud.js";
import "./routes/memories-search.js";
import "./routes/memories-misc.js";
import "./routes/projects.js";
import "./routes/agents.js";

// Actual CLI and SDK -> HTTP -> real route -> synthetic SQLite. The preload
// selects local storage before credential resolution. CLI children receive only
// a fixture authority and a fresh HOME, never ambient credentials or settings.
const home = mkdtempSync(join(tmpdir(), "mementos-inject-project-"));
const signingSecret = randomBytes(32).toString("hex");
const apiKey = mintApiKey({ app: "mementos", scopes: ["mementos:*"], signingSecret }).token;
const requests: { path: string; query: Record<string, string>; body: any }[] = [];
let server: ReturnType<typeof Bun.serve>;
let client: MementosClient;
let db: ReturnType<typeof getDatabase>;
const projectPath = join(home, "alpha");
const aliasProject = {
  id: "gamma-stable-project-id",
  name: "friendly-gamma-project",
  path: join(home, "friendly-gamma-project"),
};
const ids: Record<string, string> = {};
beforeAll(() => {
  process.env.MEMENTOS_DB_PATH = ":memory:";
  for (const key of ["API_KEY_SIGNING_SECRET", "HASNA_MEMENTOS_API_SIGNING_KEY", "HASNA_API_SIGNING_KEY"]) delete process.env[key];
  process.env.API_KEY_SIGNING_SECRET = signingSecret;
  expect(isApiMode()).toBe(false);
  resetDatabase();
  db = getDatabase(":memory:");
  for (const id of ["alpha", "beta"]) db.run("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))", [id, id, join(home, id)]);
  db.run(
    "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    [aliasProject.id, aliasProject.name, aliasProject.path],
  );
  for (const id of ["owner", "other-owner"]) db.run("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))", [id, id]);
  for (const scope of ["global", "shared", "private"] as const) {
    for (const project of ["alpha", "beta", undefined]) {
      const key = `${scope}-${project ?? "unassigned"}`;
      ids[key] = createMemory({ key, value: "scopeprobe", scope, category: "fact", importance: 8, agent_id: "owner", project_id: project }, db).id;
    }
    const key = `${scope}-gamma`;
    ids[key] = createMemory({ key, value: "scopeprobe", scope, category: "fact", importance: 9, agent_id: "owner", project_id: aliasProject.id }, db).id;
  }
  for (const id of ["fixture-machine", "other-machine"]) db.run("INSERT INTO machines (id, name, hostname) VALUES (?, ?, ?)", [id, id, id]);
  ids.otherOwner = createMemory({ key: "private-other-owner", value: "scopeprobe", scope: "private", category: "fact", importance: 8, agent_id: "other-owner", project_id: "alpha" }, db).id;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/v1(?=\/)/, "/api");
    requests.push({ path, query: Object.fromEntries(url.searchParams), body: req.method === "POST" ? await req.clone().json() : null });
    const denied = await checkApiKey(req, req.method, path);
    if (denied) return denied;
    const route = matchRoute(req.method, path);
    return route ? route.handler(req, url, route.params) : Response.json({ error: "No fixture route" }, { status: 404 });
  }});
  client = new MementosClient({ baseUrl: server.url.origin, apiKey, env: {} });
});
beforeEach(() => {
  requests.length = 0;
  db.run("UPDATE memories SET access_count = 0, accessed_at = NULL");
});
afterAll(() => { server?.stop(true); resetDatabase(); rmSync(home, { recursive: true, force: true }); });
async function cli(args: string[], categories: string | null = "fact") {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", "--json", ...args, "--agent", "owner", "--machine", "fixture-machine", "--max-tokens", "10000", ...(categories === null ? [] : ["--categories", categories])], {
    cwd: new URL("../../", import.meta.url).pathname,
    env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_STATION: "mementos-test-fixture-no-such-station", PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HASNA_MEMENTOS_API_URL: server.url.origin, HASNA_MEMENTOS_API_KEY: apiKey },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}
function expectExactProject(context: string, project = "alpha") {
  for (const scope of ["global", "shared", "private"]) {
    expect(context).toContain(`${scope}-${project}`);
    expect(context).not.toContain(`${scope}-${project === "alpha" ? "beta" : "alpha"}`);
    expect(context).not.toContain(`${scope}-unassigned`);
  }
  expect(context).not.toContain("private-other-owner");
}
function touched(key: string): number {
  return (db.query("SELECT access_count FROM memories WHERE id = ?").get(ids[key]!) as { access_count: number }).access_count;
}
for (const command of ["context", "inject"]) {
  test(`${command}: explicit project scopes every memory-list request over HTTP`, async () => {
    const result = await cli([command, "--project", projectPath]);
    expect(result.code).toBe(0);
    expectExactProject(JSON.parse(result.stdout).context);
    const lists = requests.filter(r => r.path === "/api/memories");
    expect(lists.map(r => r.query.scope).sort()).toEqual(["global", "private", "shared"]);
    expect(lists.every(r => r.query.project_id === "alpha")).toBe(true);
    expect(lists.find(r => r.query.scope === "private")?.query.agent_id).toBe("owner");
  }, 15000);
  test(`${command}: global --project option has the same scope`, async () => {
    const result = await cli(["--project", projectPath, command]);
    expect(result.code).toBe(0);
    expectExactProject(JSON.parse(result.stdout).context);
  }, 15000);
  test(`${command}: absent project keeps existing scope policy`, async () => {
    const result = await cli([command]);
    expect(result.code).toBe(0);
    const context = JSON.parse(result.stdout).context as string;
    for (const project of ["alpha", "beta", "unassigned"]) {
      expect(context).toContain(`private-${project}`);
      expect(context).toContain(`global-${project}`);
      expect(context.includes(`shared-${project}`)).toBe(command === "context");
    }
    expect(context).not.toContain("private-other-owner");
  }, 15000);
  test(`${command}: unknown project fails before memory reads or touches`, async () => {
    const result = await cli([command, "--project", join(home, "missing")]);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Project not found");
    expect(requests.filter(r => r.path.startsWith("/api/memories"))).toEqual([]);
    expect(touched("private-beta")).toBe(0);
  }, 15000);
}
test("context query sends exact project and agent in actual search body", async () => {
  const result = await cli(["context", "scopeprobe", "--project", projectPath]);
  expect(result.code).toBe(0);
  expectExactProject(JSON.parse(result.stdout).context);
  expect(requests.find(r => r.path === "/api/memories/search")?.body).toMatchObject({ project_id: "alpha", agent_id: "owner", query: "scopeprobe" });
}, 15000);
test("context query rejects unknown project before search", async () => {
  const result = await cli(["context", "scopeprobe", "--project", join(home, "missing")]);
  expect(result.code).not.toBe(0);
  expect(requests.filter(r => r.path.startsWith("/api/memories"))).toEqual([]);
}, 15000);
test("SDK project query reaches the real inject route; only selected rows are touched", async () => {
  const result = await client.getContext({ project_id: "alpha", agent_id: "owner", max_tokens: 10000 });
  expect(requests.find(r => r.path === "/api/inject")?.query).toMatchObject({ project_id: "alpha", agent_id: "owner" });
  expectExactProject(result.context);
  expect(result.memories_count).toBe(3);
  expect(touched("private-alpha")).toBe(1);
  expect(touched("private-beta")).toBe(0);
  expect(touched("private-unassigned")).toBe(0);
  expectExactProject((await client.getContext({ project_id: "beta", agent_id: "owner", max_tokens: 10000 })).context, "beta");
});
test("SDK/HTTP injection canonicalizes project names and paths to the stable id exactly once", async () => {
  for (const [projectRef, expectedLookups] of [[aliasProject.id, 1], [aliasProject.name, 3], [aliasProject.path, 2]] as const) {
    db.run("UPDATE memories SET access_count = 0, accessed_at = NULL");
    const queries = spyOn(db, "query");
    try {
      const result = await client.getContext({ project_id: projectRef, agent_id: "owner", max_tokens: 10000 });
      for (const scope of ["global", "shared", "private"]) {
        expect(result.context).toContain(`${scope}-gamma`);
        expect(result.context).not.toContain(`${scope}-alpha`);
        expect(result.context).not.toContain(`${scope}-beta`);
        expect(result.context).not.toContain(`${scope}-unassigned`);
      }
      expect(result.memories_count).toBe(3);
      expect(touched("private-gamma")).toBe(1);
      expect(touched("private-alpha")).toBe(0);
      const projectLookups = queries.mock.calls.filter(([statement]) =>
        /^SELECT \* FROM projects WHERE (?:id|path|LOWER\(name\)) = \?/.test(String(statement))
      );
      expect(projectLookups).toHaveLength(expectedLookups);
    } finally {
      queries.mockRestore();
    }
  }
});

test("SDK unknown explicit project errors without touching owner memories", async () => {
  await expect(client.getContext({ project_id: "missing", agent_id: "owner" })).rejects.toThrow("Project not found");
  expect(touched("private-alpha")).toBe(0);
  expect(touched("private-beta")).toBe(0);
  expect(touched("private-unassigned")).toBe(0);
});
test("SDK no project preserves owner-wide private and global, without shared", async () => {
  const result = await client.getContext({ agent_id: "owner", max_tokens: 10000 });
  for (const project of ["alpha", "beta", "unassigned"]) {
    expect(result.context).toContain(`private-${project}`);
    expect(result.context).toContain(`global-${project}`);
    expect(result.context).not.toContain(`shared-${project}`);
  }
});

test("inject intersects project with the existing private session and machine filters", async () => {
  const sessionMemories = [
    { key: "session-alpha-current", project_id: "alpha", session_id: "current-session" },
    { key: "session-beta-current", project_id: "beta", session_id: "current-session" },
    { key: "session-alpha-other", project_id: "alpha", session_id: "other-session" },
  ];
  const added: string[] = [];
  try {
    added.push(createMemory({ key: "private-other-machine", value: "scopeprobe", scope: "private", category: "fact", importance: 8, agent_id: "owner", project_id: "alpha", session_id: "current-session", machine_id: "other-machine" }, db).id);
    for (const row of sessionMemories) added.push(createMemory({ ...row, value: "scopeprobe", scope: "private", category: "fact", importance: 8, agent_id: "owner", machine_id: "fixture-machine" }, db).id);
    const result = await cli(["inject", "--project", projectPath, "--session", "current-session"]);
    expect(result.code).toBe(0);
    const context = JSON.parse(result.stdout).context as string;
    expect(context).toContain("session-alpha-current");
    expect(context).not.toContain("session-beta-current");
    expect(context).not.toContain("session-alpha-other");
    expect(context).not.toContain("private-other-machine");
    const privateRequest = requests.find(r => r.path === "/api/memories" && r.query.scope === "private");
    expect(privateRequest?.query).toMatchObject({ project_id: "alpha", agent_id: "owner", session_id: "current-session", visible_to_machine_id: "fixture-machine" });
  } finally {
    for (const id of added) db.run("DELETE FROM memories WHERE id = ?", [id]);
  }
}, 15000);

test("CLI inject default categories return facts, preferences and knowledge over HTTP", async () => {
  const added: string[] = [];
  try {
    for (const category of ["preference", "knowledge"] as const) added.push(createMemory({ key: `default-${category}`, value: "scopeprobe", scope: "private", category, importance: 8, agent_id: "owner", project_id: "alpha" }, db).id);
    const result = await cli(["inject", "--project", projectPath], null);
    expect(result.code).toBe(0);
    const context = JSON.parse(result.stdout).context as string;
    expectExactProject(context);
    expect(context).toContain("default-preference");
    expect(context).toContain("default-knowledge");
    expect(requests.find(r => r.path === "/api/memories")?.query.category).toBe("preference,fact,knowledge");
  } finally {
    for (const id of added) db.run("DELETE FROM memories WHERE id = ?", [id]);
  }
}, 15000);

test("SDK and domain HTTP listing apply null-or-project eligibility before pagination and counts", async () => {
  const added: string[] = [];
  try {
    for (let i = 0; i < 105; i++) added.push(createMemory({ key: `crowded-beta-${i}`, value: "scopeprobe", scope: "private", category: "fact", importance: 9, agent_id: "owner", project_id: "beta" }, db).id);
    added.push(createMemory({ key: "unassigned-other-owner", value: "scopeprobe", scope: "private", category: "fact", importance: 10, agent_id: "other-owner" }, db).id);
    const filter = { scope: "private" as const, agent_id: "owner", project_id: "alpha", include_unassigned_project: true, limit: 1 };
    const first = await client.listMemories(filter);
    const second = await client.listMemories({ ...filter, offset: 1 });
    expect(new Set([...first.memories, ...second.memories].map(m => m.key))).toEqual(new Set(["private-alpha", "private-unassigned"]));
    expect(first.total).toBe(2);
    expect(first.has_more).toBe(true);
    expect(second.total).toBe(2);
    expect(second.has_more).toBe(false);
    expect(requests.filter(r => r.path === "/api/memories").every(r => r.query.include_unassigned_project === "true")).toBe(true);
    const exact = await client.listMemories({ ...filter, include_unassigned_project: false });
    expect(exact.memories.map(m => m.key)).toEqual(["private-alpha"]);
    expect(exact.total).toBe(1);

    // Exercise the synchronous domain HTTP client used by library/MCP as well,
    // not just SDK query serialization. Child env is the same isolated fixture.
    const proc = Bun.spawn([process.execPath, "-e", 'import { listMemories } from "./src/db/memories.ts"; console.log(JSON.stringify(listMemories({ scope: "private", agent_id: "owner", project_id: "alpha", include_unassigned_project: true, limit: 2 }).map(m => m.key)))'], {
      cwd: new URL("../../", import.meta.url).pathname,
      env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_STATION: "mementos-test-fixture-no-such-station", PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HASNA_MEMENTOS_API_URL: server.url.origin, HASNA_MEMENTOS_API_KEY: apiKey },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(new Set(JSON.parse(stdout))).toEqual(new Set(["private-alpha", "private-unassigned"]));
    expect(requests.at(-1)?.query).toMatchObject({ project_id: "alpha", include_unassigned_project: "true", agent_id: "owner", scope: "private", limit: "2" });
  } finally {
    for (const id of added) db.run("DELETE FROM memories WHERE id = ?", [id]);
  }
}, 15000);

test("empty explicit projects never become an unfiltered context", async () => {
  for (const command of ["context", "inject"]) {
    const result = await cli([command, "--project", ""]);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Project not found");
  }
  await expect(client.getContext({ project_id: "", agent_id: "owner" })).rejects.toThrow("Project not found");
  expect(requests.filter(r => r.path.startsWith("/api/memories"))).toEqual([]);
  expect(touched("private-alpha")).toBe(0);
}, 15000);
