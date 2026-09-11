import { planProjectLinkReceiptId } from "../lib/plan-project-link-contract.js";
import { test, expect, setDefaultTimeout } from "bun:test";
// Spawns child processes (CLI/server/scripts); bun's 5s default is too tight on a loaded host.
setDefaultTimeout(60_000);

import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { toV1BaseUrl } from "@hasna/contracts/client";
import { createTodosCloudQueryClient } from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
const pgTest = process.env.TODOS_TEST_PG_URL ? test : test.skip;
pgTest(
  "fresh plans CLI uses saved API credentials and preserves tasks, Markdown and committed action receipts",
  async () => {
    const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, {
      max: 4,
    });
    const table = `lists_cli_${randomUUID().replaceAll("-", "")}`;
    const store = createPostgresTodosStorageAdapter({
      client,
      service: "lists-cli-fixture",
      tableName: table,
      cursorTableName: `${table}_cursor`,
    });
    const root = mkdtempSync(join(tmpdir(), "todos-lists-cli-"));
    const signingSecret = randomUUID() + randomUUID();
    const key = mintApiKey({
      app: "todos",
      scopes: ["todos:read", "todos:write"],
      signingSecret,
      tid: "fixture-tenant",
      agent: "fixture",
    });
    const verifier = verifyApiKey({
      app: "todos",
      signingSecret,
      keyStatus: async (kid: string) =>
        kid === key.kid ? "active" : "unknown",
    });
    const deps: V1RequestDependencies = {
      ensureSchema: async () => {},
      getStorageAdapter: () => store,
      getMachineRegistryTenantId: () => "fixture-tenant",
      getVerifier: () => verifier,
    };
    let rejectDelete = false;
    let failTaskRead: string | undefined;
    let requests = 0;
    let readFailure: string | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        requests++;
        const url = new URL(req.url);
        if (
          failTaskRead &&
          url.pathname === "/v1/tasks" &&
          url.searchParams.get("plan_id") === failTaskRead
        )
          return new Response("fixture unavailable", { status: 503 });
        if (
          readFailure?.startsWith("comments") &&
          url.pathname.endsWith("/comments")
        ) {
          if (readFailure === "comments-empty-legacy")
            return Response.json({ comments: [], count: 0 });
          if (readFailure === "comments404")
            return new Response(null, { status: 404 });
          const row = {
            id: "fixture-comment",
            plan_id: url.pathname.split("/")[3],
            agent_id: null,
            session_id: null,
            content: "fixture history",
            type: "comment",
            progress_pct: null,
            created_at: "2026-01-01T00:00:00Z",
          };
          const comments =
            readFailure === "comments-malformed"
              ? [{ id: row.id }]
              : readFailure === "comments-foreign"
                ? [{ ...row, plan_id: "other-plan" }]
                : [row, row];
          return Response.json({
            comments,
            count: comments.length,
            history_selection: {
              schema_version: 1,
              plan_id: url.pathname.split("/")[3],
              complete: true,
            },
          });
        }
        if (rejectDelete && url.pathname.endsWith("/delete-preserving"))
          return new Response(null, { status: 405 });
        const response =
          (await handleV1Request(req, url, deps)) ??
          new Response(null, { status: 404 });
        if (
          readFailure &&
          url.pathname === "/v1/tasks" &&
          response.status === 200
        ) {
          const body: any = await response.json();
          if (readFailure === "total-less") {
            delete body.total;
            body.tasks = body.tasks.slice(0, 1);
            body.count = body.tasks.length;
          }
          if (readFailure === "archive-unproved") delete body.selection;
          return Response.json(body);
        }
        return response;
      },
    });
    const config = join(root, ".hasna/todos/config");
    mkdirSync(config, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(config, "credentials"),
      `HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=${key.token}\n`,
      { mode: 0o600 },
    );
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: root,
      USERPROFILE: root,
      HASNA_STATION: `fixture-${randomUUID()}`,
      TMPDIR: root,
      NO_COLOR: "1",
    };
    const run = async (args: string[]) => {
      const child = Bun.spawn(
        [process.execPath, "--no-env-file", "src/cli/index.tsx", ...args],
        {
          cwd: join(import.meta.dir, "../.."),
          env,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };
    try {
      const project = await store.projects.create({
        name: "API project",
        path: "/untrusted/api/path",
      });
      const artifactRoot = join(root, "chosen-project");
      mkdirSync(artifactRoot, { mode: 0o700 });
      const created = await run([
        "--json",
        "--project",
        project.id,
        "plans",
        "--add",
        " Shared plan ",
        "--slug",
        "Shared Plan",
      ]);
      expect(created.code, created.stderr).toBe(0);
      const plan = JSON.parse(created.stdout);
      expect(plan).toMatchObject({
        name: "Shared plan",
        slug: "shared-plan",
        status: "active",
      });
      const target = await store.projects.create({
        name: "Target project",
        path: "/unused/target",
      });
      const linkPlan = await store.plans.create({ name: "Link receipt plan" });
      const preview = await run([
        "plans",
        "--link-project",
        linkPlan.id,
        "--to-project",
        target.id,
      ]);
      expect(preview.code, preview.stderr).toBe(0);
      expect(preview.stdout).toContain(linkPlan.id);
      expect(preview.stdout).toContain(target.name);
      const linkKey = randomUUID();
      const applied = await run([
        "plans",
        "--link-project",
        linkPlan.id,
        "--to-project",
        target.id,
        "--apply",
        "--idempotency-key",
        linkKey,
      ]);
      expect(applied.code, applied.stderr).toBe(0);
      expect(applied.stdout).toContain(planProjectLinkReceiptId(linkKey));
      const rolled = await run([
        "plans",
        "--rollback-project-link",
        linkPlan.id,
        "--to-project",
        target.id,
        "--receipt",
        planProjectLinkReceiptId(linkKey),
      ]);
      expect(rolled.code, rolled.stderr).toBe(0);
      expect(rolled.stdout).toContain("restored");
      expect(rolled.stdout).toContain(planProjectLinkReceiptId(linkKey));
      const emptyDeleted = await run(["plans", "--delete", linkPlan.id]);
      expect(emptyDeleted.code, emptyDeleted.stderr).toBe(0);
      expect(emptyDeleted.stdout).toContain(linkPlan.id);
      expect(emptyDeleted.stdout).toContain("true");
      const task = await store.tasks.create({
        title: "kept task",
        plan_id: plan.id,
        project_id: project.id,
      });
      for (let i = 1; i < 201; i++) {
        const row = { ...task, id: randomUUID() };
        await client.query(
          `INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('lists-cli-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,
          [row.id, JSON.stringify(row), row.updated_at],
        );
      }
      const shown = await run(["--json", "plans", "--show", plan.id]);
      expect(shown.code, shown.stderr).toBe(0);
      expect(JSON.parse(shown.stdout).tasks).toHaveLength(201);
      for (const query of [
        `plan_read_contract=1&plan_id=${plan.id}&include_subtasks=true&include_archived=false&status=pending`,
        `plan_read_contract=1&plan_id=${plan.id}&include_subtasks=true&include_archived=invalid`,
        `plan_read_contract=1&plan_id=${plan.id}&plan_id=other&include_subtasks=true&include_archived=true`,
      ]) {
        const response = await fetch(`${toV1BaseUrl(server.url.href)}/tasks?${query}`, {
          headers: { authorization: `Bearer ${key.token}` },
        });
        expect(response.status).toBe(400);
      }
      const archived = {
        ...task,
        id: randomUUID(),
        archived_at: new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('lists-cli-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,
        [archived.id, JSON.stringify(archived), archived.updated_at],
      );
      const activeOnly = await run(["--json", "plans", "--show", plan.id]);
      expect(activeOnly.code, activeOnly.stderr).toBe(0);
      expect(JSON.parse(activeOnly.stdout).tasks).toHaveLength(201);
      expect(
        JSON.parse(activeOnly.stdout).tasks.some(
          (row: any) => row.id === archived.id,
        ),
      ).toBe(false);
      const missingRoot = await run(["plans", "--write-artifacts"]);
      expect(missingRoot.code).not.toBe(0);
      expect(missingRoot.stderr).toContain("--artifact-root");
      const written = await run([
        "--json",
        "plans",
        "--write-artifacts",
        "--artifact-root",
        artifactRoot,
      ]);
      expect(written.code, written.stderr).toBe(0);
      expect(JSON.parse(written.stdout).count).toBe(1);
      const humanWritten = await run([
        "plans",
        "--write-artifacts",
        "--artifact-root",
        artifactRoot,
      ]);
      expect(humanWritten.code, humanWritten.stderr).toBe(0);
      expect(humanWritten.stdout).toContain(plan.id);
      expect(humanWritten.stdout).toContain(artifactRoot);
      const inspect = await run([
        "--json",
        "plans",
        "--artifact",
        plan.id,
        "--artifact-root",
        artifactRoot,
      ]);
      expect(inspect.code, inspect.stderr).toBe(0);
      expect(JSON.parse(inspect.stdout).artifact).toMatchObject({
        exists: true,
        conflicts: [],
      });
      expect(JSON.parse(inspect.stdout).artifact.task_references).toHaveLength(
        202,
      );
      const artifactPath = JSON.parse(written.stdout).artifacts[0].path;
      const originalBytes = readFileSync(artifactPath);
      for (const failure of ["total-less", "archive-unproved"]) {
        readFailure = failure;
        const refusedRead = await run([
          "--json",
          "plans",
          "--write-artifacts",
          "--artifact-root",
          artifactRoot,
        ]);
        expect(refusedRead.code).not.toBe(0);
        expect(readFileSync(artifactPath)).toEqual(originalBytes);
      }
      readFailure = undefined;
      for (const failure of [
        "comments-empty-legacy",
        "comments404",
        "comments-malformed",
        "comments-foreign",
        "comments-duplicate",
      ]) {
        readFailure = failure;
        const refusedRead = await run(["--json", "plans", "--show", plan.id]);
        expect(refusedRead.code).not.toBe(0);
        expect(JSON.parse(refusedRead.stdout)).toHaveProperty("error");
      }
      readFailure = undefined;
      const historyUrl = `${toV1BaseUrl(server.url.href)}/plans/${plan.id}/comments?plan_read_contract=1`;
      const historyResponse = await fetch(historyUrl, {
        headers: { authorization: `Bearer ${key.token}` },
      });
      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toMatchObject({
        comments: [],
        count: 0,
        history_selection: {
          schema_version: 1,
          plan_id: plan.id,
          complete: true,
        },
      });
      for (let index = 0; index < 101; index++) {
        await store.plans.addComment!({
          plan_id: plan.id,
          content: `Synthetic history ${index}`,
        });
      }
      const completeHistory = await fetch(historyUrl, {
        headers: { authorization: `Bearer ${key.token}` },
      });
      const completeHistoryBody = await completeHistory.json();
      expect(completeHistory.status).toBe(200);
      expect(completeHistoryBody.count).toBe(101);
      expect(completeHistoryBody.comments).toHaveLength(101);
      expect(completeHistoryBody.history_selection).toEqual({
        schema_version: 1,
        plan_id: plan.id,
        complete: true,
      });
      const pagedHistory = await fetch(
        historyUrl.replace("?plan_read_contract=1", ""),
        {
          headers: { authorization: `Bearer ${key.token}` },
        },
      );
      const pagedHistoryBody = await pagedHistory.json();
      expect(pagedHistoryBody.count).toBe(100);
      expect(pagedHistoryBody.has_more).toBe(true);
      expect(pagedHistoryBody).not.toHaveProperty("history_selection");
      const unsupported = await handleV1Request(
        new Request(historyUrl, {
          headers: { authorization: `Bearer ${key.token}` },
        }),
        new URL(historyUrl),
        {
          ...deps,
          getStorageAdapter: () => ({
            ...store,
            plans: { ...store.plans, getComments: undefined },
          }),
        },
      );
      expect(unsupported?.status).toBe(503);
      expect(await unsupported!.json()).not.toHaveProperty("history_selection");
      const complete = await run(["--json", "plans", "--complete", plan.id]);
      expect(complete.code, complete.stderr).toBe(0);
      expect(JSON.parse(complete.stdout).status).toBe("completed");
      const conflict = await run([
        "--json",
        "plans",
        "--artifact",
        plan.id,
        "--artifact-root",
        artifactRoot,
      ]);
      expect(
        JSON.parse(conflict.stdout).artifact.conflicts.some(
          (x: any) => x.field === "status",
        ),
      ).toBe(true);
      const refused = await run(["--json", "plans", "--delete", plan.id]);
      expect(refused.code).not.toBe(0);
      expect(await store.plans.get(plan.id)).not.toBeNull();
      const deleted = await run([
        "--json",
        "plans",
        "--delete",
        plan.id,
        "--force",
      ]);
      expect(deleted.code, deleted.stderr).toBe(0);
      expect(JSON.parse(deleted.stdout)).toMatchObject({
        deleted: true,
        detached_tasks: 202,
      });
      expect((await store.tasks.get(task.id))?.plan_id).toBeNull();
      const failedArtifact = await run([
        "--json",
        "--project",
        project.id,
        "plans",
        "--add",
        "Committed despite artifact failure",
        "--artifact-root",
        join(root, "absent"),
      ]);
      expect(failedArtifact.code).not.toBe(0);
      const receipt = JSON.parse(failedArtifact.stdout);
      expect(receipt.operation_committed).toBe(true);
      expect(await store.plans.get(receipt.plan.id)).not.toBeNull();
      const failedHuman = await run([
        "--project",
        project.id,
        "plans",
        "--add",
        "Human committed artifact failure",
        "--artifact-root",
        join(root, "absent"),
      ]);
      expect(failedHuman.code).not.toBe(0);
      expect(failedHuman.stdout).toContain("Human committed artifact failure");
      expect(failedHuman.stdout).toContain("operation_committed");
      const exportPlans = await store.plans.list();
      expect(exportPlans.length).toBeGreaterThanOrEqual(2);
      failTaskRead = exportPlans[1]!.id;
      const partial = await run([
        "plans",
        "--write-artifacts",
        "--artifact-root",
        artifactRoot,
      ]);
      expect(partial.code).not.toBe(0);
      expect(partial.stdout).toContain(exportPlans[0]!.id);
      expect(partial.stdout).toContain(exportPlans[1]!.id);
      expect(partial.stdout).toContain(artifactRoot);
      expect(partial.stdout).toContain("false");
      failTaskRead = undefined;
      expect(
        readdirSync(root, { recursive: true })
          .map(String)
          .filter((path) =>
            /\.(db|sqlite|sqlite3)(?:-wal|-shm|-journal)?$/.test(path),
          ),
      ).toEqual([]);
    } finally {
      server.stop(true);
      await client.query(`DROP TABLE IF EXISTS ${table},${table}_cursor`);
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  60000,
);
