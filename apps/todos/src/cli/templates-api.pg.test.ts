import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createTodosCloudQueryClient } from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
const pgTest = process.env.TODOS_TEST_PG_URL ? test : test.skip;
pgTest(
  "template CLI uses shared history, initialization and preserved partial receipts without SQLite",
  async () => {
    const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, {
      max: 4,
    });
    const table = `templates_cli_${randomUUID().replaceAll("-", "")}`;
    const store = createPostgresTodosStorageAdapter({
      client,
      service: "templates-cli-fixture",
      tableName: table,
      cursorTableName: `${table}_cursor`,
    });
    const root = mkdtempSync(join(tmpdir(), "todos-templates-cli-"));
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
    let requests = 0;
    let rejectTaskAt = 0;
    let taskWrites = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        requests++;
        const url = new URL(req.url);
        if (
          req.method === "POST" &&
          url.pathname === "/v1/tasks" &&
          ++taskWrites === rejectTaskAt
        )
          return Response.json(
            { error: "Synthetic response uncertainty" },
            { status: 503 },
          );
        return (
          (await handleV1Request(req, url, deps)) ??
          new Response("Not found", { status: 404 })
        );
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
      const added = await run([
        "--json",
        "templates",
        "--add",
        "Reusable",
        "--title",
        "Work {name}",
      ]);
      expect(added.code, added.stderr).toBe(0);
      const template = JSON.parse(added.stdout);
      const updated = await run([
        "--json",
        "templates",
        "--update",
        template.id.slice(0, 8),
        "--title",
        "Updated {name}",
      ]);
      expect(updated.code, updated.stderr).toBe(0);
      expect(JSON.parse(updated.stdout).version).toBe(2);
      const history = await run(["--json", "template-history", template.id]);
      expect(history.code, history.stderr).toBe(0);
      expect(JSON.parse(history.stdout).versions).toHaveLength(1);
      expect(
        JSON.parse(JSON.parse(history.stdout).versions[0].snapshot)
          .title_pattern,
      ).toBe("Work {name}");
      const initialized = await Promise.all([
        store.templates.initialize!(),
        store.templates.initialize!(),
      ]);
      expect(initialized[0]!.created + initialized[1]!.created).toBe(13);
      expect(initialized.filter((row) => row.created === 0)).toHaveLength(1);
      const skipReceipt = initialized.find((row) => row.created === 0)!;
      expect(skipReceipt.skipped).toBe(13);
      expect(
        skipReceipt.records
          .filter((row) => row.name === "release")
          .every((row) => row.ids.length === 2),
      ).toBe(true);
      expect((await store.templates.list()).length).toBe(14);
      const initCli = await run(["--json", "templates-init"]);
      expect(initCli.code, initCli.stderr).toBe(0);
      expect(JSON.parse(initCli.stdout).created).toBe(0);
      const exported = await run(["template-export", template.id]);
      expect(exported.code, exported.stderr).toBe(0);
      const file = join(root, "template.json");
      writeFileSync(file, exported.stdout);
      const imported = await run(["--json", "templates-import", file]);
      expect(imported.code, imported.stderr).toBe(0);
      expect(JSON.parse(imported.stdout).id).not.toBe(template.id);
      const preview = await run([
        "--json",
        "templates-preview",
        template.id,
        "--var",
        "name=fixture",
      ]);
      expect(preview.code, preview.stderr).toBe(0);
      expect(JSON.parse(preview.stdout).tasks[0].title).toBe("Updated fixture");
      const applied = await run([
        "--json",
        "templates",
        "--use",
        template.id,
        "--var",
        "name=fixture",
      ]);
      expect(applied.code, applied.stderr).toBe(0);
      const task = JSON.parse(applied.stdout)[0];
      expect((await store.tasks.get(task.id))?.title).toBe("Updated fixture");
      const checklist = await store.templates.create({
        name: "Partial",
        title_pattern: "Steps",
        tasks: [{ title_pattern: "First" }, { title_pattern: "Second" }],
      });
      rejectTaskAt = taskWrites + 2;
      const partial = await run(["--json", "templates", "--use", checklist.id]);
      expect(partial.code).not.toBe(0);
      expect(JSON.parse(partial.stdout)).toMatchObject({
        status: "ambiguous",
        do_not_retry: true,
        pending_operation: "task-create",
      });
      expect(JSON.parse(partial.stdout).created_task_ids).toHaveLength(1);
      expect(
        await store.tasks.get(JSON.parse(partial.stdout).created_task_ids[0]),
      ).not.toBeNull();
      const dependencyTemplate = await store.templates.create({
        name: "Dependency application",
        title_pattern: "Steps",
        tasks: [
          { title_pattern: "Dependency first" },
          { title_pattern: "Dependency second", depends_on: [0] },
        ],
      });
      const dependencyApplied = await run([
        "--json",
        "templates",
        "--use",
        dependencyTemplate.id,
      ]);
      expect(
        dependencyApplied.code,
        dependencyApplied.stderr + dependencyApplied.stdout,
      ).toBe(0);
      const dependencyTasks = JSON.parse(dependencyApplied.stdout);
      expect(
        (await store.dependencies!.list(dependencyTasks[1].id)).dependencies,
      ).toContainEqual(
        expect.objectContaining({
          task_id: dependencyTasks[1].id,
          depends_on: dependencyTasks[0].id,
        }),
      );
      const historyBefore = await store.templates.history!(template.id);
      const trigger = `${table}_reject`;
      await client.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='templates' AND NEW.payload->>'title_pattern'='Rollback fixture' THEN RAISE EXCEPTION 'synthetic statement refusal'; END IF; RETURN NEW; END $$`,
      );
      await client.query(
        `CREATE TRIGGER reject_template BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
      try {
        await expect(
          store.templates.update(template.id, {
            title_pattern: "Rollback fixture",
            expected_version: 2,
          }),
        ).rejects.toThrow("synthetic statement refusal");
        expect((await store.templates.get(template.id))?.version).toBe(2);
        expect(await store.templates.history!(template.id)).toEqual(
          historyBefore,
        );
      } finally {
        await client.query(`DROP TRIGGER reject_template ON ${table}`);
        await client.query(`DROP FUNCTION ${trigger}()`);
      }
      const foreign = mintApiKey({
        app: "todos",
        scopes: ["todos:read", "todos:write"],
        signingSecret,
        tid: "other-tenant",
        agent: "fixture",
      });
      const foreignVerifier = verifyApiKey({
        app: "todos",
        signingSecret,
        keyStatus: async () => "active",
      });
      for (const [path, method] of [
        [`/v1/templates/${template.id}/history`, "GET"],
        ["/v1/templates/initialize", "POST"],
      ] as const) {
        const url = new URL(path, server.url);
        const req = new Request(url, {
          method,
          headers: {
            authorization: `Bearer ${foreign.token}`,
            "content-type": "application/json",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        const response = await handleV1Request(req, url, {
          ...deps,
          getVerifier: () => foreignVerifier,
        });
        expect(response?.status).toBe(403);
      }
      const before = await store.templates.get(template.id);
      const results = await Promise.allSettled([
        store.templates.update(template.id, {
          title_pattern: "Concurrent A",
          expected_version: before!.version,
        }),
        store.templates.update(template.id, {
          title_pattern: "Concurrent B",
          expected_version: before!.version,
        }),
      ]);
      expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(results.filter((row) => row.status === "rejected")).toHaveLength(
        1,
      );
      const old = await store.templates.create({
        name: "Old no history",
        title_pattern: "Old",
      });
      await client.query(
        `UPDATE ${table} SET payload=jsonb_set(payload,'{version}','3'::jsonb) WHERE object_type='templates' AND object_id=$1`,
        [old.id],
      );
      const incomplete = await store.templates.history!(old.id);
      expect(incomplete!.selection).toMatchObject({
        complete: false,
        missing_versions: [1, 2],
      });
      const unsupportedUrl = new URL(
        `/v1/templates/${checklist.id}`,
        server.url,
      );
      const unsupported = await handleV1Request(
        new Request(unsupportedUrl, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${key.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title_pattern: "Must not commit",
            expected_version: 1,
          }),
        }),
        unsupportedUrl,
        {
          ...deps,
          getStorageAdapter: () => ({
            ...store,
            templates: { ...store.templates, updateWithHistory: undefined },
          }),
        },
      );
      expect(unsupported?.status).toBe(501);
      expect((await store.templates.get(checklist.id))?.title_pattern).toBe(
        "Steps",
      );
      const futureClock = await store.templates.create({
        name: "Imported future clock",
        title_pattern: "Preserve before edit",
      });
      await client.query(
        `UPDATE ${table} SET updated_at='2099-01-01T00:00:00Z'::timestamptz WHERE object_type='templates' AND object_id=$1`,
        [futureClock.id],
      );
      const futureUpdated = await store.templates.update(futureClock.id, {
        title_pattern: "Committed edit",
        expected_version: 1,
      });
      expect(futureUpdated?.version).toBe(2);
      expect(
        (await store.templates.history!(futureClock.id))?.versions,
      ).toHaveLength(1);
      const futureClockProof = await client.query<{ advanced: boolean }>(
        `SELECT updated_at > '2099-01-01T00:00:00Z'::timestamptz AS advanced FROM ${table} WHERE object_type='templates' AND object_id=$1`,
        [futureClock.id],
      );
      expect(futureClockProof.rows[0]?.advanced).toBe(true);
      const clockMismatch = await store.templates.create({
        name: "Rejected CAS",
        title_pattern: "Must retain",
      });
      await client.query(
        `UPDATE ${table} SET version=2 WHERE object_type='templates' AND object_id=$1`,
        [clockMismatch.id],
      );
      await expect(
        store.templates.update(clockMismatch.id, {
          title_pattern: "Must not commit",
          expected_version: 1,
        }),
      ).rejects.toThrow("Template revision write was refused");
      expect((await store.templates.get(clockMismatch.id))?.title_pattern).toBe(
        "Must retain",
      );
      expect(
        (await store.templates.history!(clockMismatch.id))?.versions,
      ).toHaveLength(0);
      const deleted = await run([
        "--json",
        "templates",
        "--delete",
        template.id,
      ]);
      expect(deleted.code, deleted.stderr).toBe(0);
      expect(await store.templates.get(template.id)).toBeNull();
      expect(await store.tasks.get(task.id)).not.toBeNull();
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
