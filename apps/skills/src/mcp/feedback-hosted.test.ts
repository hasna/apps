/**
 * The MCP `send_feedback` tool against a real instance, in-process.
 *
 * The tool shares `saveFeedback()` with `skills feedback`, so it inherited the
 * same defect: on a keyed station it appended the report to
 * ~/.hasna/skills/feedback.jsonl and answered "saved". It now POSTs
 * /api/v1/feedback, and these assertions read the report back off the instance.
 *
 * `buildServer()` is the composition root the `skills mcp` subcommand, the HTTP
 * transport and any in-process embed all use, so exercising it here covers the
 * tool on every transport.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { MemorySkillsStore } from "../server/store.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { buildServer } from "./server.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const PRINCIPAL = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
// A fixture bearer for the in-process instance below; never a real credential.
const SEED_KEYS = [{ token: "sk_test_mcp_feedback", principal: PRINCIPAL }];
const FIXTURE_BEARER = SEED_KEYS[0]!.token;
const ENV_KEYS = ["HASNA_SKILLS_API_URL", "HASNA_SKILLS_API_KEY", "HASNA_SKILLS_DIR", "HASNA_HOME", "HASNA_SKILLS_LOCAL"] as const;

let saved: Record<string, string | undefined> = {};
let dataDir = "";
let hasnaHome = "";
let server: ReturnType<typeof Bun.serve> | undefined;
let requests: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = mkdtempSync(join(tmpdir(), "skills-mcp-feedback-data-"));
  hasnaHome = mkdtempSync(join(tmpdir(), "skills-mcp-feedback-home-"));
  process.env.HASNA_SKILLS_DIR = dataDir;
  process.env.HASNA_HOME = hasnaHome;
  requests = [];
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(hasnaHome, { recursive: true, force: true });
});

async function startInstance(): Promise<string> {
  const handler = await createSkillsFetchHandler({
    store: new MemorySkillsStore(SEED_KEYS),
    governanceStore: new MemoryGovernanceStore(),
    config: { inlineWorker: false, allowEphemeralStore: true },
  });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return handler(request);
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

async function callSendFeedback(args: Record<string, unknown>): Promise<{ isError: boolean; payload: Record<string, unknown> }> {
  const mcp = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "feedback-hosted-test", version: "0" });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = (await client.callTool({ name: "send_feedback", arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    const text = result.content.find((entry) => entry.type === "text")?.text ?? "";
    return { isError: Boolean(result.isError), payload: JSON.parse(text) as Record<string, unknown> };
  } finally {
    await client.close();
    await mcp.close();
  }
}

function noLocalStore(): void {
  expect(readdirSync(dataDir).filter((name) => name.includes(".db"))).toEqual([]);
  expect(existsSync(join(dataDir, "feedback.jsonl"))).toBe(false);
}

test("send_feedback posts to the instance and the report reads back", async () => {
  const origin = await startInstance();
  process.env.HASNA_SKILLS_API_URL = origin;
  process.env.HASNA_SKILLS_API_KEY = FIXTURE_BEARER;

  const { isError, payload } = await callSendFeedback({ message: "the MCP tools are clear", category: "general", email: "a@example.com" });
  expect(isError).toBe(false);
  expect(payload).toMatchObject({ saved: true, category: "general", target: "hosted" });
  expect(String(payload.id).startsWith("fbk_")).toBe(true);
  expect(requests).toEqual(["POST /api/v1/feedback"]);
  noLocalStore();

  const stored = await new RemoteSkillsClient(FIXTURE_BEARER, origin).listFeedback();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: payload.id, message: "the MCP tools are clear", email: "a@example.com" });
});

test("send_feedback with no credential and no opt-in reports the refusal and writes nothing", async () => {
  await startInstance();
  delete process.env.HASNA_SKILLS_API_URL;
  delete process.env.HASNA_SKILLS_API_KEY;

  const { isError, payload } = await callSendFeedback({ message: "nowhere to send this" });
  expect(isError).toBe(true);
  expect(payload.code).toBe("FEEDBACK_SEND_FAILED");
  expect(String(payload.message)).toContain("failing closed");
  expect(requests).toEqual([]);
  noLocalStore();
});
