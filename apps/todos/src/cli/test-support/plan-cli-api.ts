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
export async function runPlanApiFixture(
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
