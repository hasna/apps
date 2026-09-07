import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { STORE_SELECTING_KEYS } from "../lib/store/isolated-test-env.js";
import { HERMETIC_STATION } from "../test/hermetic.js";

const CLI = ["bun", "run", "./src/cli/index.tsx"];
const PARENT = {
  id: 695033,
  uuid: "5307e936-efb7-4eeb-b7e2-0fe354b7ac35",
  session_id: "channel:git-publishing",
  from_agent: "alice",
  to_agent: "git-publishing",
  channel: "git-publishing",
  content: "synthetic parent",
  priority: "normal",
  blocking: false,
  reply_to: null,
  created_at: "2026-08-10T10:00:00.000Z",
};
const COLLIDING_NUMERIC_ROW = {
  ...PARENT,
  uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  session_id: "channel:mementos",
  from_agent: "other",
  to_agent: "mementos",
  channel: "mementos",
  content: "synthetic collision",
};

function cloudChildEnv(url: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STORE_SELECTING_KEYS.includes(key)) env[key] = value;
  }
  // The station Keychain sits ABOVE the env tier in the shared chain: pin the
  // account to one no real item uses, or the operator's real key and api-url
  // items win over the fixture pair below.
  env.HASNA_STATION = HERMETIC_STATION;
  env.HASNA_CONVERSATIONS_API_URL = url;
  env.HASNA_CONVERSATIONS_API_KEY = ["fixture", "not", "a", "credential"].join("-");
  env.CONVERSATIONS_AGENT_ID = "bob";
  env.FORCE_COLOR = "0";
  return env;
}

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("cloud reply reference compatibility (e2e)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let env: Record<string, string>;
  const writes: Array<Record<string, unknown>> = [];
  const reads: string[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/v1/, "");
        reads.push(`${request.method} ${path}${url.search}`);

        if (request.method === "GET" && path === `/messages/${PARENT.id}`) {
          // This is the observed numeric misresolution. Old CLI code trusted
          // this row and rejected the reply as a channel mismatch.
          return Response.json({ message: COLLIDING_NUMERIC_ROW });
        }
        if (request.method === "GET" && path === `/messages/by-uuid/${PARENT.uuid}`) {
          // Older deployed servers do not have this route; their generic 404
          // is indistinguishable from a genuine UUID miss by status alone.
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        if (request.method === "GET" && path === "/messages") {
          const uuid = url.searchParams.get("uuid");
          const channel = url.searchParams.get("channel");
          const sinceId = url.searchParams.get("since_id");
          if (uuid === PARENT.uuid) {
            return Response.json({ messages: [PARENT] });
          }
          if (
            channel === PARENT.channel &&
            sinceId === String(PARENT.id - 1)
          ) {
            return Response.json({ messages: [PARENT] });
          }
          return Response.json({ messages: [] });
        }
        if (request.method === "POST" && path === "/messages") {
          const body = await request.json() as Record<string, unknown>;
          writes.push(body);
          return Response.json({
            message: {
              ...body,
              id: 695034 + writes.length,
              uuid: body.uuid,
              session_id: PARENT.session_id,
              from_agent: body.from,
              to_agent: PARENT.channel,
              channel: PARENT.channel,
              reply_to: PARENT.id,
              created_at: "2026-08-10T10:01:00.000Z",
            },
          }, { status: 201 });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    env = cloudChildEnv(`http://127.0.0.1:${server.port}`);
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("numeric reply resolution stays inside the supplied channel instead of trusting a colliding direct lookup", async () => {
    const result = await runCli([
      "send",
      "--channel",
      PARENT.channel,
      "--reply-to",
      String(PARENT.id),
      "--from",
      "bob",
      "--json",
      "synthetic numeric reply",
    ], env);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      channel: PARENT.channel,
      reply_to: PARENT.id,
    });
    expect(writes[0]).toMatchObject({
      channel: PARENT.channel,
      reply_to: PARENT.id,
      reply_to_uuid: PARENT.uuid,
    });
    expect(reads.some((entry) => entry.startsWith(`GET /messages/${PARENT.id}`))).toBe(false);
    expect(reads.some((entry) =>
      entry.startsWith("GET /messages?") &&
      entry.includes(`channel=${PARENT.channel}`) &&
      entry.includes(`since_id=${PARENT.id - 1}`)
    )).toBe(true);
  });

  test("the UUID returned by send resolves through the older collection filter when the dedicated route is absent", async () => {
    const result = await runCli([
      "send",
      "--channel",
      PARENT.channel,
      "--reply-to",
      PARENT.uuid,
      "--from",
      "bob",
      "--json",
      "synthetic UUID reply",
    ], env);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      channel: PARENT.channel,
      reply_to: PARENT.id,
    });
    expect(writes[1]).toMatchObject({
      channel: PARENT.channel,
      reply_to: PARENT.id,
      reply_to_uuid: PARENT.uuid,
    });
    expect(reads.some((entry) => entry === `GET /messages/by-uuid/${PARENT.uuid}`)).toBe(true);
    expect(reads.some((entry) =>
      entry.startsWith("GET /messages?") &&
      entry.includes(`uuid=${PARENT.uuid}`)
    )).toBe(true);
  });
});
