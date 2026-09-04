import { describe, it, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function commentJson(taskId: string, text: string, extraEnv: Record<string, string> = {}) {
  const result = await runCli(["--json", "comment", taskId, text], extraEnv);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as { id: string; task_id: string; agent_id: string | null; content: string };
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

// ADDED (todos task 39b4255b). `todos comment` never called resolveWritableIdentity
// at all — `agent_id: globalOpts.agent` was a bare read of the flag, so the
// documented per-session escape hatch (TODOS_AGENT_ID) was silently invisible to
// this one command while working for `add`, `start`, `done`, and the rest. rc=0,
// "Comment added.", no warning: the comment landed and read back fine, so nothing
// signalled that provenance had been dropped.
describe("todos comment — records who wrote it", () => {
  it("reads UTF-8 comment content from --file while preserving agent, session, and JSON output", async () => {
    const task = await addJson(["a task to comment on"]);
    const commentPath = join(testRoot, "comment-utf8.txt");
    const content = "În lucru — verificare ✓\n";
    writeFileSync(commentPath, content, "utf8");

    const result = await runCli([
      "--agent", "brutus",
      "--session", "comment-file-session",
      "--json",
      "comment", "--file", commentPath,
      task.id,
    ]);

    expect(result.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(JSON.parse(result.stdout)).toMatchObject({
      task_id: task.id,
      agent_id: "brutus",
      session_id: "comment-file-session",
      content,
    });
  });

  it("rejects ambiguous, missing, non-file, and empty file input without adding a comment", async () => {
    const task = await addJson(["a task to protect from invalid comments"]);
    const contentPath = join(testRoot, "comment.txt");
    const emptyPath = join(testRoot, "empty-comment.txt");
    const directoryPath = join(testRoot, "not-a-comment-file");
    writeFileSync(contentPath, "file content", "utf8");
    writeFileSync(emptyPath, " \n\t", "utf8");
    mkdirSync(directoryPath);

    const invalidCases: Array<{ args: string[]; expected: RegExp }> = [
      {
        args: ["comment", task.id, "positional content", "--file", contentPath],
        expected: /exactly one.*content source|not both/i,
      },
      {
        args: ["comment", task.id, "--file", join(testRoot, "missing-comment.txt")],
        expected: /unable to read comment file/i,
      },
      {
        args: ["comment", task.id, "--file", directoryPath],
        expected: /regular file/i,
      },
      {
        args: ["comment", task.id, "--file", emptyPath],
        expected: /comment content.*empty/i,
      },
      {
        args: ["comment", task.id],
        expected: /exactly one.*content source/i,
      },
    ];

    for (const invalidCase of invalidCases) {
      const result = await runCli(["--json", ...invalidCase.args]);
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(invalidCase.expected);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option '--file'");
    }

    const shown = await runCli(["--json", "show", task.id]);
    expect(shown.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(shown.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(JSON.parse(shown.stdout).comments).toHaveLength(0);
  });

  it("attributes to the ambient identity from the environment, matching `add`", async () => {
    const task = await addJson(["a task to comment on"]);
    const comment = await commentJson(task.id, "progress note from the environment", { TODOS_AGENT_ID: "cassius" });
    expect(comment.agent_id).toBe("cassius");
  });

  it("still attributes to --agent when given — the path that already worked", async () => {
    const task = await addJson(["a task to comment on"]);
    const result = await runCli(["--agent", "brutus", "--json", "comment", task.id, "flag-identified comment"]);
    expect(result.exitCode).toBe(0);
    const comment = JSON.parse(result.stdout) as { agent_id: string | null };
    expect(comment.agent_id).toBe("brutus");
  });

  it("--agent wins over TODOS_AGENT_ID when both are present, exactly as it does for `add`", async () => {
    const task = await addJson(["a task to comment on"]);
    const result = await runCli(
      ["--agent", "brutus", "--json", "comment", task.id, "flag beats env"],
      { TODOS_AGENT_ID: "cassius" },
    );
    expect(result.exitCode).toBe(0);
    const comment = JSON.parse(result.stdout) as { agent_id: string | null };
    expect(comment.agent_id).toBe("brutus");
  });

  it("is unattributable — null, not a plausible guess — with no flag and no environment", async () => {
    const task = await addJson(["a task to comment on"], { TODOS_AGENT_ID: "cassius" });
    // The comment call under test must not inherit the runner's own ambient
    // TODOS_AGENT_ID/HASNA_TODOS_AGENT_ID (runCli's env starts from process.env via
    // localRoutingTestEnv, and neither var is in SHARED_TODOS_STORE_ENV_KEYS) — blank
    // both explicitly so "no environment" is actually no environment.
    const comment = await commentJson(task.id, "anonymous progress note", {
      TODOS_AGENT_ID: "",
      HASNA_TODOS_AGENT_ID: "",
    });
    expect(comment.agent_id).toBeNull();
  });

  it("does not attribute from the station-shared identity file, matching `add`", async () => {
    expect((await runCli(["init", "Cassius"])).exitCode).toBe(0);
    const task = await addJson(["a task to comment on"]);
    const comment = await commentJson(task.id, "should stay unattributed", {
      TODOS_AGENT_ID: "",
      HASNA_TODOS_AGENT_ID: "",
    });
    expect(comment.agent_id).toBeNull();
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

  // AMENDED (todos task a3f4bb1a, F1). This test previously asserted the OPPOSITE —
  // that no warning fires here. That was correct before #192 and became wrong the
  // moment #192 landed: --assign gives the row an owner, but #192 routes created_by
  // through the WRITABLE identity only (explicit --agent or TODOS_AGENT_ID), which an
  // anonymous filer with --assign still lacks. The row is not ownerless — it has an
  // assignee — but it IS unattributable, and the old gate (keyed on `assignee` alone)
  // went silent on exactly this branch. Measured live: created_by stayed null while
  // stderr carried no attribution warning at all.
  it("warns about unattributable created_by even when the task is explicitly assigned", async () => {
    const result = await runCli(["--json", "add", "--assign", "brutus", "routed by an anonymous filer"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("unattributable");
    // It has an owner (brutus), so the ownerless half must stay silent — printing
    // "ownerless" here would be a false claim about a row that is not ownerless.
    expect(result.stderr).not.toContain("ownerless");
    const task = JSON.parse(result.stdout) as { created_by: string | null; assigned_to: string | null };
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).toBe("brutus");
  });

  it("stays silent when a per-process identity is set, even with --assign to someone else", async () => {
    const result = await runCli(
      ["--json", "add", "--assign", "brutus", "filed by cassius for brutus"],
      { TODOS_AGENT_ID: "cassius" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("unattributable");
    expect(result.stderr).not.toContain("ownerless");
    const task = JSON.parse(result.stdout) as { created_by: string | null; assigned_to: string | null };
    expect(task.created_by).toBe("cassius");
    expect(task.assigned_to).toBe("brutus");
  });

  it("warns about unattributable created_by on a deliberately unassigned row with no identity at all", async () => {
    // --unassigned suppresses the OWNERLESS half on purpose (see the test above),
    // but it says nothing about attribution. A row with no identity anywhere is
    // still unattributable and the attribution half must fire independent of
    // --unassigned, exactly as it must independent of --assign above.
    const result = await runCli(["--json", "add", "--unassigned", "ownerless on purpose, still unidentified"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("unattributable");
    const task = JSON.parse(result.stdout) as { created_by: string | null; assigned_to: string | null };
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).toBeNull();
  });
});

describe("todos init — persisted identity is diagnostic, never writable task attribution", () => {
  it("does not make a subsequent bare `add` attributable with no flags and no env", async () => {
    const init = await runCli(["init", "Cassius"]);
    expect(init.exitCode).toBe(0);

    const task = await addJson(["inherits the registered identity"]);
    expect(task.created_by).toBeNull();
  });

  // ADDED (todos task a3f4bb1a, F2). `init`'s own success line claimed "later
  // commands attribute to this agent automatically" — false on every column since
  // #192, as the test directly above this one proves in the same breath. The
  // collision path (exit 2) already prints the correct escape hatch
  // (`export TODOS_AGENT_ID=<name>`); the success path — the one every fresh
  // session hits — must say the same thing instead of the opposite.
  it("tells the truth about attribution on the success path, instead of promising automatic credit", async () => {
    const init = await runCli(["init", "Brutus"]);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).not.toContain("automatically");
    expect(init.stdout).toContain("export TODOS_AGENT_ID=brutus");
  });

  // AMENDED 2026-07-31 (todos task 64131fb1). This case previously also asserted
  // `assigned_to === created_by` — that a bare `add` AUTO-ASSIGNS to the persisted
  // identity. That assertion encoded the defect as a requirement.
  //
  // identity.json is one file keyed on $HOME and this fleet runs many agent
  // sessions per station under one HOME, so it names the STATION, not the caller.
  // Auto-assigning from it queued one agent's work onto another: on station01,
  // `titus-skill-corpus` registered at 17:31:04Z and every unregistered session on
  // the box filed against it from 17:37:36Z, still producing at 19:37:00Z.
  //
  // Attribution (`created_by`) no longer inherits the file either: a plausible
  // wrong author is the same integrity defect as a plausible wrong assignee.
  it("does not attribute or auto-assign from the station-shared identity file", async () => {
    expect((await runCli(["init", "Cassius"])).exitCode).toBe(0);

    const result = await runCli(["--json", "add", "unattributable and not routed"]);
    expect(result.exitCode).toBe(0);
    const task = JSON.parse(result.stdout) as { created_by: string | null; assigned_to: string | null };
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).toBeNull();
    // and the omission is not silent
    expect(result.stderr).toContain("ownerless");
  });

  it("auto-assigns from a PROCESS-bound identity, which cannot leak between sessions", async () => {
    expect((await runCli(["init", "Cassius"])).exitCode).toBe(0);

    const task = await addJson(["routed by the env identity"], { TODOS_AGENT_ID: "Cassius" });
    expect(task.created_by).toBe("cassius");
    expect(task.assigned_to).toBe("cassius");
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

// `registerAgent` canonicalises the persisted name to lower case
// (src/db/agents.ts). The file remains useful for collision detection and display,
// but it is deliberately not writable task attribution because it is shared by
// every session under the station's HOME.
describe("todos init — a second session must not silently take over the identity", () => {
  it("refuses to overwrite a different agent's persisted identity, and names the escape hatch", async () => {
    expect((await runCli(["init", "Brutus"])).exitCode).toBe(0);

    const second = await runCli(["init", "Cassius"]);
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("already has a persisted todos identity");
    expect(second.stderr).toContain("TODOS_AGENT_ID");

    // And the first session's identity is intact — re-registering Brutus would
    // collide if the refused Cassius takeover had half-applied.
    expect((await runCli(["init", "Brutus"])).exitCode).toBe(0);
    const task = await addJson(["still brutus"]);
    expect(task.created_by).toBeNull();
  });

  it("--force takes it over deliberately", async () => {
    await runCli(["init", "Brutus"]);
    const forced = await runCli(["init", "Cassius", "--force"]);
    expect(forced.exitCode).toBe(0);
    expect((await runCli(["init", "Cassius"])).exitCode).toBe(0);
    const task = await addJson(["now cassius"]);
    expect(task.created_by).toBeNull();
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
    // The file still belongs to Brutus, but a bare add may not write that
    // station-shared identity into created_by.
    expect((await runCli(["init", "Brutus"])).exitCode).toBe(0);
    const brutusTask = await addJson(["filed by the file owner"]);
    expect(brutusTask.created_by).toBeNull();
  });
});

describe("todos list --created-by is case-insensitive from the command line", () => {
  it("finds a canonically-stored task from a capitalised filter value", async () => {
    await addJson(["filed by cassius"], { TODOS_AGENT_ID: "cassius" });

    const result = await runCli(["--json", "list", "--created-by", "Cassius"]);
    expect(result.exitCode).toBe(0);
    const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toEqual(["filed by cassius"]);
  });

  // BEHAVIOUR LOCK, not a defect control: this already passed with only the
  // write-side fix, because both the stored value and the filter value went through
  // the resolver. It pins that the two fixes agree; the read-side defect is
  // demonstrated by the test above it and by the two DB-level tests.
  it("--inbox excludes the caller's own filing regardless of the casing it was filed under", async () => {
    // Same real agent, two sanctioned identity paths, historically two casings.
    await addJson(["my own filing"], { TODOS_AGENT_ID: "Cassius" });
    await addJson(["--assign", "cassius", "routed to me"], { TODOS_AGENT_ID: "brutus" });

    const result = await runCli(["--json", "list", "--inbox"], { TODOS_AGENT_ID: "CASSIUS" });
    expect(result.exitCode).toBe(0);
    const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toEqual(["routed to me"]);
  });
});
