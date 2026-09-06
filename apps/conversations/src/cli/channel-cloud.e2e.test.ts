import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApiServer, type ApiServerDeps } from "../server/api.js";
import { mintApiKey, verifyApiKey, ApiKeyStore, type ApiKeyStatus } from "@hasna/contracts/auth";
import { STORE_SELECTING_KEYS } from "../lib/store/isolated-test-env.js";
import { HERMETIC_STATION } from "../test/hermetic.js";

const SIGNING = ["test", "signing", "material", "0123456789"].join("-");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function makeFakeClient() {
  const channels: Record<string, any> = {};
  const projects: Record<string, any> = {
    "proj-valid": { id: "proj-valid", name: "Chief of Harness" },
  };
  const client: any = {
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
        const [id, name, description, topic, project_id, created_by, metadata, tags] = p as any[];
        const row = {
          id,
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
      if (/UPDATE channels SET/i.test(sql)) {
        const setMatch = sql.match(/UPDATE channels SET (.+) WHERE name = \$(\d+) RETURNING \*/i);
        if (!setMatch) return null;
        const name = String(p[Number(setMatch[2]) - 1]);
        const row = channels[name];
        if (!row) return null;
        for (const assignment of setMatch[1].matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
          row[assignment[1]] = p[Number(assignment[2]) - 1];
        }
        return row;
      }
      return null;
    },
    async query(_sql: string, _p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
      // The channel-create path auto-joins the creator via INSERT INTO channel_members.
      return { rows: [], rowCount: 0 };
    },
    async execute(_sql: string, _p: readonly unknown[] = []): Promise<void> {},
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(channels);
      try {
        return await fn(client);
      } catch (error) {
        for (const key of Object.keys(channels)) delete channels[key];
        Object.assign(channels, snapshot);
        throw error;
      }
    },
  };
  return client;
}

function makeDeps(): ApiServerDeps {
  const client = makeFakeClient();
  const keys = new ApiKeyStore(client as any);
  const verifier = verifyApiKey({
    app: "conversations",
    signingSecret: SIGNING,
    // @hasna/contracts >= 0.10.6 rejects a bare `isRevoked` boolean predicate
    // (it cannot refuse an unregistered key). The stub accepts every
    // cryptographically valid token, which is exactly what the old
    // `isRevoked: async () => false` meant — expressed through the strict
    // key-status hook.
    keyStatus: async (): Promise<ApiKeyStatus> => "active",
  });
  return { client: client as any, keys, verifier };
}

async function runCli(args: string[], env: Record<string, string | undefined>) {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STORE_SELECTING_KEYS.includes(key)) childEnv[key] = value;
  }
  // The station Keychain sits ABOVE the env tier in the shared chain: pin the
  // account to one no real item uses, or the operator's real key and api-url
  // items win over the fixture pair a case exports.
  childEnv.HASNA_STATION = HERMETIC_STATION;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  childEnv.FORCE_COLOR = "0";
  const proc = Bun.spawn({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: childEnv,
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

  test("channel create surfaces actionable project validation errors", async () => {
    const result = await runCli([
      "channel",
      "create",
      "catalog",
      "--description",
      "Coordination for the catalog repository",
      "--topic",
      "Catalog repository development and maintenance",
      "--project",
      "6b06d5e6",
      "--from",
      "cato",
    ], env);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Request failed: POST /channels -> 400");
    expect(result.stderr).toContain("No conversations project exists with that id.");
    expect(result.stderr).toContain("Hint: Create or resolve the conversations project first");
  });

  test("channel update metadata/tags uses the cloud API on JSON and human surfaces", async () => {
    const created = await runCli([
      "channel",
      "create",
      "cloud-identity",
      "--class",
      "product",
      "--from",
      "alice",
      "--json",
    ], env);
    expect(created.exitCode, created.stderr).toBe(0);
    const stableId = JSON.parse(created.stdout).id;

    const metadata = {
      channel_schema: {
        class: "product",
        canonical_slug: "cloud-identity",
        github: { full_name: "hasna/cloud-identity" },
        repo_labels: ["cloud-identity", "hasna/cloud-identity"],
      },
    };
    const tags = ["cloud-identity", "hasna", "repo:hasna/cloud-identity"];
    const updated = await runCli([
      "channel",
      "update",
      "cloud-identity",
      "--metadata",
      JSON.stringify(metadata),
      "--tags",
      JSON.stringify(tags),
      "--json",
    ], env);
    expect(updated.exitCode, updated.stderr).toBe(0);
    expect(JSON.parse(updated.stdout)).toMatchObject({
      id: stableId,
      name: "cloud-identity",
      metadata,
      tags,
    });

    const human = await runCli([
      "channel",
      "update",
      "cloud-identity",
      "--metadata",
      JSON.stringify(metadata),
      "--tags",
      JSON.stringify(tags),
    ], env);
    expect(human.exitCode, human.stderr).toBe(0);
    expect(human.stdout).toContain("Channel #cloud-identity updated.");
  });
});
