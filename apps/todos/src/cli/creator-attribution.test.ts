import { describe, it, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * End-to-end CLI coverage for task authorship (todos task a98803b4), part 2 of the
 * hotfix: an unassigned task must be DELIBERATE.
 *
 * Before the fix, `todos add "<title>"` produced an ownerless, unattributable row
 * in silence — so the filer read "filed and announced, therefore routed" while no
 * seat was ever queued. Measured live against the hosted API, every attribution
 * field on such a row came back null.
 *
 * These assert observable CLI behaviour through a real subprocess, not internals.
 */

setDefaultTimeout(30_000);

let testRoot = "";
let dbPath = "";

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-cli-attribution-"));
  mkdirSync(join(testRoot, "home"), { recursive: true });
  dbPath = join(testRoot, "todos.db");
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: localRoutingTestEnv({
      HOME: join(testRoot, "home"),
      HASNA_EVENTS_DIR: join(testRoot, "events"),
      ...extraEnv,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function addJson(args: string[], extraEnv: Record<string, string> = {}) {
  const result = await runCli(["--json", "add", ...args], extraEnv);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as {
    id: string; title: string; created_by: string | null; assigned_to: string | null; agent_id: string | null;
  };
}

describe("todos add — records who FILED the task", () => {
  it("attributes to the ambient identity from the environment", async () => {
    const task = await addJson(["env-identified task"], { TODOS_AGENT_ID: "cassius" });
    expect(task.created_by).toBe("cassius");
  });

  it("attributes to --agent when given", async () => {
    const task = await addJson(["--agent", "brutus", "flag-identified task"]);
    expect(task.created_by).toBe("brutus");
  });

  it("records the filer even when the task is assigned to someone else", async () => {
    const task = await addJson(["--assign", "brutus", "routed work"], { TODOS_AGENT_ID: "cassius" });
    expect(task.created_by).toBe("cassius");
    expect(task.assigned_to).toBe("brutus");
  });
});

describe("todos add — an unassigned task must be deliberate", () => {
  it("defaults the assignee to the filer, so there is somebody to ask", async () => {
    const task = await addJson(["needs an owner"], { TODOS_AGENT_ID: "cassius" });
    expect(task.assigned_to).toBe("cassius");
  });

  it("--assign still wins over the default", async () => {
    const task = await addJson(["--assign", "brutus", "explicitly routed"], { TODOS_AGENT_ID: "cassius" });
    expect(task.assigned_to).toBe("brutus");
  });

  it("--unassigned leaves it ownerless on purpose, and says nothing about it", async () => {
    const result = await runCli(["--json", "add", "--unassigned", "deliberately ownerless"], { TODOS_AGENT_ID: "cassius" });
    expect(result.exitCode).toBe(0);
    const task = JSON.parse(result.stdout) as { assigned_to: string | null; created_by: string | null };
    expect(task.assigned_to).toBeNull();
    // Still attributed — deliberate absence of an owner, not absence of an author.
    expect(task.created_by).toBe("cassius");
    expect(result.stderr).not.toContain("ownerless");
  });

  it("warns when there is no identity AND no assignee — the silent case that produced the 72%", async () => {
    const result = await runCli(["--json", "add", "anonymous and ownerless"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("ownerless and unattributable");
    const task = JSON.parse(result.stdout) as { assigned_to: string | null; created_by: string | null };
    expect(task.assigned_to).toBeNull();
    expect(task.created_by).toBeNull();
  });

  it("does not warn when the task is explicitly assigned", async () => {
    const result = await runCli(["--json", "add", "--assign", "brutus", "routed by an anonymous filer"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("ownerless and unattributable");
  });
});

describe("todos init — persists the identity so later commands inherit it", () => {
  it("makes a subsequent bare `add` attributable with no flags and no env", async () => {
    const init = await runCli(["init", "Cassius"]);
    expect(init.exitCode).toBe(0);

    const task = await addJson(["inherits the registered identity"]);
    expect(task.created_by).not.toBeNull();
    expect(task.assigned_to).toBe(task.created_by);
  });

  it("stops attributing once the identity is released", async () => {
    await runCli(["init", "Cassius"]);
    const release = await runCli(["release", "Cassius"]);
    expect(release.exitCode).toBe(0);

    const result = await runCli(["--json", "add", "after release"]);
    const task = JSON.parse(result.stdout) as { created_by: string | null };
    expect(task.created_by).toBeNull();
  });
});

describe("todos list --inbox — work others routed to me", () => {
  it("excludes my own filings and keeps what someone else assigned me", async () => {
    await addJson(["--assign", "cassius", "routed to me by brutus"], { TODOS_AGENT_ID: "brutus" });
    await addJson(["my own note to self"], { TODOS_AGENT_ID: "cassius" });

    const result = await runCli(["--json", "list", "--inbox"], { TODOS_AGENT_ID: "cassius" });
    expect(result.exitCode).toBe(0);
    const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toEqual(["routed to me by brutus"]);
  });

  it("without --inbox both tasks are visible — proving --inbox is what filters", async () => {
    await addJson(["--assign", "cassius", "routed to me by brutus"], { TODOS_AGENT_ID: "brutus" });
    await addJson(["my own note to self"], { TODOS_AGENT_ID: "cassius" });

    const result = await runCli(["--json", "list", "--assigned", "cassius"], { TODOS_AGENT_ID: "cassius" });
    const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
    expect(titles.sort()).toEqual(["my own note to self", "routed to me by brutus"]);
  });
});

// `registerAgent` canonicalises the name to lower case (src/db/agents.ts), so the
// persisted identity — and therefore created_by — is the lower-cased form. That is
// deliberate: a single canonical spelling is what makes authorship comparable
// between agents. Note the asymmetry it leaves: `--assign Cassius` stores the raw
// string, so a mixed-case assignment will not match a lower-cased identity. That
// is pre-existing behaviour of `--assigned` and is not widened here.
describe("todos init — a second session must not silently take over the identity", () => {
  it("refuses to overwrite a different agent's persisted identity, and names the escape hatch", async () => {
    expect((await runCli(["init", "Brutus"])).exitCode).toBe(0);

    const second = await runCli(["init", "Cassius"]);
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("already has a persisted todos identity");
    expect(second.stderr).toContain("TODOS_AGENT_ID");

    // And the first session's identity is intact — a refused takeover must not
    // half-apply, or both sessions end up misattributed instead of one.
    const task = await addJson(["still brutus"]);
    expect(task.created_by).toBe("brutus");
  });

  it("--force takes it over deliberately", async () => {
    await runCli(["init", "Brutus"]);
    const forced = await runCli(["init", "Cassius", "--force"]);
    expect(forced.exitCode).toBe(0);
    const task = await addJson(["now cassius"]);
    expect(task.created_by).toBe("cassius");
  });

  it("re-registering the same name is not a collision", async () => {
    await runCli(["init", "Cassius"]);
    expect((await runCli(["init", "Cassius"])).exitCode).toBe(0);
  });

  it("a concurrent session can attribute to itself via the environment without touching the file", async () => {
    await runCli(["init", "Brutus"]);
    // Canonicalised to lower case, exactly as `todos init` would have stored it for
    // the same agent — so the two sanctioned ways of declaring an identity produce ONE
    // author string, and not_created_by can actually exclude the agent's own filings.
    const task = await addJson(["filed by the other session"], { TODOS_AGENT_ID: "Cassius" });
    expect(task.created_by).toBe("cassius");
    // The file still belongs to Brutus, canonicalised by registration.
    const brutusTask = await addJson(["filed by the file owner"]);
    expect(brutusTask.created_by).toBe("brutus");
  });
});
