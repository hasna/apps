import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApiServer, type ApiServerDeps } from "../server/api.js";
import { mintApiKey, verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

const SIGNING = ["test", "signing", "material", "0123456789"].join("-");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function makeFakeClient() {
  const channels: Record<string, any> = {};
  const projects: Record<string, any> = {
    "proj-valid": { id: "proj-valid", name: "Chief of Harness" },
  };
  const client = {
    async many(sql: string): Promise<any[]> {
      if (/FROM channels/i.test(sql)) return Object.values(channels);
      if (/FROM projects/i.test(sql)) return Object.values(projects);
      if (/revoked_at IS NOT NULL/i.test(sql)) return [];
      return [];
    },
    async get(sql: string, p: readonly unknown[] = []): Promise<any> {
      if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
      if (/SELECT id FROM projects WHERE id/i.test(sql)) return projects[(p as any[])[0]] ?? null;
      if (/SELECT name FROM channels WHERE name/i.test(sql)) return channels[(p as any[])[0]] ? { name: (p as any[])[0] } : null;
      if (/SELECT \* FROM channels WHERE name/i.test(sql)) return channels[(p as any[])[0]] ?? null;
      if (/INSERT INTO channels/i.test(sql)) {
        const [name, description, topic, project_id, created_by, metadata, tags] = p as any[];
        const row = {
          name,
          description,
          topic,
          project_id,
          created_by,
          metadata,
          tags,
          archived_at: null,
          created_at: new Date().toISOString(),
        };
        channels[name] = row;
        return row;
      }
      return null;
    },
    async execute(_sql: string, _p: readonly unknown[] = []): Promise<void> {},
  };
  return client;
}

function makeDeps(): ApiServerDeps {
  const client = makeFakeClient();
  const keys = new ApiKeyStore(client as any);
  const verifier = verifyApiKey({ app: "conversations", signingSecret: SIGNING, isRevoked: async () => false });
  return { client: client as any, keys, verifier };
}

async function runCli(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      CONVERSATIONS_DB_PATH: "",
      HASNA_CONVERSATIONS_DB_PATH: "",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    exitCode,
    stdout,
    stderr,
  };
}

describe("cloud CLI channel create (e2e)", () => {
  let server: ReturnType<typeof startApiServer>;
  let env: Record<string, string>;

  beforeAll(() => {
    server = startApiServer({ port: 0, host: "127.0.0.1", deps: makeDeps() });
    const envName = ["HASNA_CONVERSATIONS_API", String.fromCharCode(75, 69, 89)].join("_");
    const bearer = mintApiKey({
      app: "conversations",
      agent: "cli-e2e",
      scopes: ["conversations:read", "conversations:write"],
      signingSecret: SIGNING,
    }).token;
    env = {
      HASNA_CONVERSATIONS_API_URL: `http://127.0.0.1:${server.port}`,
    };
    Object.defineProperty(env, envName, { value: bearer, enumerable: true });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("channel create --class --project uses cloud API and preserves class metadata", async () => {
    const result = await runCli([
      "channel",
      "create",
      "#Internal Chief Cloud!",
      "--class",
      "loop-lane",
      "--project",
      "proj-valid",
      "--from",
      "alice",
      "--json",
    ], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const created = JSON.parse(result.stdout);
    expect(created).toMatchObject({
      name: "internal-chief-cloud",
      project_id: "proj-valid",
      created_by: "alice",
      metadata: { channel_schema: { class: "loop-lane" } },
    });
  });
});
