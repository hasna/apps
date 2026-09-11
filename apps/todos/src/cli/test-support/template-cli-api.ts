import {
  addDependency,
  removeDependency,
  getTaskDependencies,
  getTaskDependents,
} from "../../db/task-graph.js";
import { builtinTemplateInputs } from "../../lib/builtin-template-library.js";
import { createTemplate, listTemplates } from "../../db/templates.js";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runMigrations } from "../../db/schema.js";
import { createLocalSqliteTodosStorageAdapter } from "../../storage/local-sqlite.js";
import {
  handleV1Request,
  type V1RequestDependencies,
} from "../../server/v1.js";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
/** Explicit compatibility database belongs only to this synthetic server, never its CLI client. */
export async function runTemplateApiFixture(
  args: string[],
  dbPath: string,
  home: string,
) {
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(home, { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  runMigrations(db);
  const store = createLocalSqliteTodosStorageAdapter({ db });
  // Deliberate local fixture backing the genuine authenticated handler.
  // PostgreSQL capability semantics have their own real database regression.
  store.templates.initialize = () =>
    db.transaction(() => {
      const existing = listTemplates(db);
      const records = builtinTemplateInputs().map((input, definition_index) => {
        const matches = existing.filter((row) => row.name === input.name);
        if (matches.length)
          return {
            definition_index,
            ids: matches.map((row) => row.id).sort(),
            name: input.name,
            status: "skipped" as const,
          };
        const created = createTemplate(input, db);
        return {
          definition_index,
          ids: [created.id],
          name: input.name,
          status: "created" as const,
        };
      });
      const names = records
        .filter((row) => row.status === "created")
        .map((row) => row.name);
      return {
        schema_version: 1 as const,
        created: names.length,
        skipped: records.length - names.length,
        names,
        records,
      };
    })();
  store.dependencies = {
    add: (taskId, dependsOn) => {
      addDependency(taskId, dependsOn, db);
      return getTaskDependencies(taskId, db).find(
        (row) => row.depends_on === dependsOn,
      )!;
    },
    remove: (taskId, dependsOn) => removeDependency(taskId, dependsOn, db),
    list: (taskId) => {
      const blocks = getTaskDependents(taskId, db);
      return {
        dependencies: getTaskDependencies(taskId, db),
        blocks,
        blocked_by: blocks,
      };
    },
  };
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
    keyStatus: async (kid: string) => (kid === key.kid ? "active" : "unknown"),
  });
  const deps: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getMachineRegistryTenantId: () => "fixture-tenant",
    getVerifier: () => verifier,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) =>
      (await handleV1Request(request, new URL(request.url), deps)) ??
      new Response("not found", { status: 404 }),
  });
  try {
    const config = join(home, ".hasna/todos/config");
    mkdirSync(config, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(config, "credentials"),
      `HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=${key.token}\n`,
      { mode: 0o600 },
    );
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "src/cli/index.tsx", ...args],
      {
        cwd: join(import.meta.dir, "../../.."),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          USERPROFILE: home,
          HASNA_STATION: randomUUID(),
          TMPDIR: home,
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    server.stop(true);
    db.close();
  }
}
