import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression coverage for the orphaned-task inflow (todos task 65971b1f).
 *
 * MEASURED, 2026-08-03, against the live hosted store: 17.9% of pending rows
 * (578 of 3231) carry project_id NULL, and the INFLOW is worse than the stock —
 * 93 of the 283 pending rows created in the previous 24h, 32.9%. A task with no
 * project appears in no per-seat list and no drain reaches it.
 *
 * THE CAUSE IS A MISSING ELSE-BRANCH ON ONE PATH. `todos add` has two branches.
 * The local one (task-commands.ts) falls back to `autoProject(globalOpts)` when
 * `--project` is absent; the CLOUD one had a bare ternary that fell to
 * `undefined`. The fleet runs cloud — HASNA_TODOS_API_URL / _API_KEY /
 * _STORAGE_MODE are all set on every station — so every fleet create took the
 * branch with no fallback and silently stored NULL. The `--project` flag's own
 * help text says "overrides auto-detect"; on the cloud path there was no
 * auto-detect to override.
 *
 * NOT the cause, checked and refuted before writing this: an unresolvable
 * `--project` does NOT degrade to NULL. `cloudResolveProjectRef` returns
 * Promise<string> and throws (cloud-router.ts:1102, covered by
 * cloud-router.test.ts:1031-1109). That path was already correct.
 *
 * These tests drive the REAL CLI against a fixture /v1 server and assert the
 * bytes actually sent on the wire plus the bytes actually written to stderr —
 * not that a code path ran. The suppression case (`--no-project`) and the
 * non-breaking guard both fail on the pre-fix source for their stated reasons:
 * the flag does not exist there, and no warning is emitted there.
 *
 * DELIBERATELY NOT ASSERTED HERE: that a task acquires a project by inference.
 * No git-root inference is added on the cloud path — see the PR body for why
 * that decision is blocked on data this fix is what starts collecting.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = ["test", "api", "key"].join("-");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PROJECT_ID = "11111111-2222-4333-8444-555555555555";

/**
 * A fixture /v1 server that RECORDS the create payload. The assertions below read
 * that recorded body, so they observe what the CLI actually transmitted rather
 * than what it returned to the terminal — a client that printed a project it
 * never sent would still fail these.
 */
function startServer() {
  const creates: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/projects") {
        return Response.json({
          projects: [{ id: PROJECT_ID, name: "fixture-project", path: null, task_list_id: null }],
          count: 1,
        });
      }
      if (url.pathname === "/v1/tasks" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        creates.push(body);
        return Response.json(
          {
            task: {
              id: "99999999-2222-4333-8444-555555555555",
              short_id: "FIX-00001",
              title: body["title"] ?? "untitled",
              status: "pending",
              priority: "medium",
              project_id: body["project_id"] ?? null,
              working_dir: body["working_dir"] ?? null,
              tags: [],
              metadata: {},
              version: 1,
              created_at: "2026-08-03T00:00:00.000Z",
              updated_at: "2026-08-03T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { creates, server };
}

async function runCli(args: string[], root: string, baseUrl: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "self_hosted",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
      // Pinned so the pre-existing ownerless warning cannot fire and be mistaken
      // for the project warning these tests are actually about.
      TODOS_AGENT_ID: "cassius",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function makeRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `todos-orphan-${label}-`));
  tempRoots.push(root);
  return root;
}

describe("orphan inflow — `todos add` with no project on the cloud path", () => {
  test("warns, names both remedies, and still creates the task", async () => {
    // The warning is the whole day-one deliverable, so it is asserted on the
    // literal stderr bytes. It must name BOTH ways out, because an agent that is
    // told only "pass --project" and genuinely has no project has been given no
    // reachable action and will learn to scroll past the line.
    const { creates, server } = startServer();
    const root = makeRoot("warn");
    try {
      const result = await runCli(["--json", "add", "orphan candidate"], root, `http://127.0.0.1:${server.port}`);

      // NON-BREAKING GUARD. This half must hold on the pre-fix source too: the
      // remedy is a warning, never a rejection. 32.9% of live creations omit the
      // project, so a hard failure here would be a fleet-wide outage of the CLI
      // every agent files work through.
      expect(result.exitCode).toBe(0);
      expect(creates).toHaveLength(1);
      expect(creates[0]!["project_id"]).toBeUndefined();

      expect(result.stderr).toContain("no project");
      expect(result.stderr).toContain("--project");
      expect(result.stderr).toContain("--no-project");

      // The warning goes to stderr and must not contaminate --json stdout. Every
      // agent on the fleet parses that stdout; a warning printed on the wrong
      // stream would turn a fix for silent orphans into a parse failure for
      // every caller, which is a strictly worse outage than the bug.
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("--no-project suppresses the warning — an omission can be deliberate", async () => {
    // Mirrors the `--unassigned` flag this same command already ships. Without an
    // explicit opt-out the warning fires on every legitimate global task too, and
    // a warning that cannot be silenced by doing the right thing is noise.
    const { creates, server } = startServer();
    const root = makeRoot("noproject");
    try {
      const result = await runCli(
        ["--json", "add", "deliberately global", "--no-project"],
        root,
        `http://127.0.0.1:${server.port}`,
      );

      expect(result.exitCode).toBe(0);
      expect(creates).toHaveLength(1);
      expect(creates[0]!["project_id"]).toBeUndefined();
      expect(result.stderr).not.toContain("no project");
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("an explicit --project still resolves, is transmitted, and warns about nothing", async () => {
    // Regression guard on the path that already worked. A fix that warned even
    // when the caller did supply a project would train agents to ignore it.
    const { creates, server } = startServer();
    const root = makeRoot("explicit");
    try {
      const result = await runCli(
        ["--json", "add", "properly filed", "--project", "fixture-project"],
        root,
        `http://127.0.0.1:${server.port}`,
      );

      expect(result.exitCode).toBe(0);
      expect(creates).toHaveLength(1);
      expect(creates[0]!["project_id"]).toBe(PROJECT_ID);
      expect(result.stderr).not.toContain("no project");
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("the cloud create transmits working_dir, as the local branch already does", async () => {
    // The cloud branch omitted working_dir entirely while the local branch set
    // process.cwd(). That is why 96.5% of orphans have working_dir NULL — and so
    // do 91.1% of NON-orphans, because every cloud row loses it regardless.
    //
    // This is not cosmetic. cwd is the only signal that could later justify
    // inferring a project, and with it dropped that decision cannot be measured
    // on real traffic at all. Restoring it is what makes the follow-up decidable.
    const { creates, server } = startServer();
    const root = makeRoot("workingdir");
    try {
      const result = await runCli(["--json", "add", "records its cwd"], root, `http://127.0.0.1:${server.port}`);

      expect(result.exitCode).toBe(0);
      expect(creates).toHaveLength(1);
      expect(creates[0]!["working_dir"]).toBe(REPO_ROOT);
    } finally {
      server.stop(true);
    }
  }, 30000);
});
