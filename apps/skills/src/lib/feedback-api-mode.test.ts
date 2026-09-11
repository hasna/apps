/**
 * `skills feedback` on a keyed station reaches the INSTANCE, not the machine.
 *
 * History: the surface had no hosted route, so a keyed station appended the
 * report to ~/.hasna/skills/feedback.jsonl (hasna/apps#1613, #1632) and a local
 * install inserted it into ~/.hasna/skills/skills.db. Both reported "saved" for
 * a report nobody who could act on it would ever read. saveFeedback() now POSTs
 * to /api/v1/feedback; the SQLite arm is reachable only under the explicit
 * local opt-in, and an unconfigured install fails closed.
 *
 * The server here is the REAL /api/v1 handler over a memory store, so the
 * assertions are about a row that was actually stored and read back — not
 * about a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { MemorySkillsStore } from "../server/store.js";
import { saveFeedback } from "./feedback.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const PRINCIPAL = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
// A fixture bearer for the in-process instance below; never a real credential.
const SEED_KEYS = [{ token: "sk_test_lib_feedback", principal: PRINCIPAL }];
const FIXTURE_BEARER = SEED_KEYS[0]!.token;

const ENV_KEYS = ["HASNA_SKILLS_DIR", "SKILLS_API_URL", "HASNA_SKILLS_API_URL", "HASNA_SKILLS_API_KEY", "HASNA_SKILLS_LOCAL"] as const;
let saved: Record<string, string | undefined> = {};
let dataDir = "";
let server: ReturnType<typeof Bun.serve> | undefined;
let requests: string[] = [];

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
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      return handler(request);
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = mkdtempSync(join(tmpdir(), "skills-feedback-api-"));
  process.env.HASNA_SKILLS_DIR = dataDir;
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
});

/** The data dir holds no client-side store for a hosted send — neither shape. */
function noLocalStoreWritten(): void {
  expect(readdirSync(dataDir).filter((name) => name.includes(".db"))).toEqual([]);
  expect(existsSync(join(dataDir, "feedback.jsonl"))).toBe(false);
  expect(existsSync(join(dataDir, "skills.db"))).toBe(false);
}

describe("saveFeedback against a configured instance", () => {
  test("POSTs /api/v1/feedback, and the instance can read the row back", async () => {
    const origin = await startInstance();
    process.env.HASNA_SKILLS_API_URL = origin;
    process.env.HASNA_SKILLS_API_KEY = FIXTURE_BEARER;

    const result = await saveFeedback({ message: "  the pull command is great  ", category: "feature", agent: "station03", version: "9.9.9" });
    expect(result).toMatchObject({ saved: true, category: "feature", target: "hosted" });
    expect(result.id?.startsWith("fbk_")).toBe(true);
    expect(result.path).toBeUndefined();
    expect(requests).toEqual(["POST /api/v1/feedback"]);
    noLocalStoreWritten();

    const stored = await new RemoteSkillsClient(FIXTURE_BEARER, origin).listFeedback();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: result.id,
      message: "the pull command is great",
      category: "feature",
      agent: "station03",
      version: "9.9.9",
    });
  });

  test("the legacy SKILLS_API_URL alias selects the same hosted send", async () => {
    const origin = await startInstance();
    process.env.SKILLS_API_URL = origin;
    process.env.HASNA_SKILLS_API_KEY = FIXTURE_BEARER;
    delete process.env.HASNA_SKILLS_API_URL;

    await saveFeedback({ message: "second" });
    await saveFeedback({ message: "third" });
    expect(requests).toEqual(["POST /api/v1/feedback", "POST /api/v1/feedback"]);
    noLocalStoreWritten();
    expect((await new RemoteSkillsClient(FIXTURE_BEARER, origin).listFeedback()).map((entry) => entry.message)).toEqual(["third", "second"]);
  });

  test("an instance that rejects the report fails loudly instead of writing this machine", async () => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ error: "nope", code: "NOT_FOUND" }, { status: 404 }),
    });
    process.env.HASNA_SKILLS_API_URL = `http://127.0.0.1:${server.port}`;
    process.env.HASNA_SKILLS_API_KEY = FIXTURE_BEARER;

    await expect(saveFeedback({ message: "an instance too old for this route" })).rejects.toThrow(/does not support \/api\/v1\/feedback/);
    noLocalStoreWritten();
  });
});

describe("saveFeedback without a configured instance", () => {
  test("no credential and no opt-in is a refusal, not a local write", async () => {
    delete process.env.HASNA_SKILLS_API_URL;
    delete process.env.HASNA_SKILLS_API_KEY;
    const home = mkdtempSync(join(tmpdir(), "skills-feedback-home-"));
    const previousHome = process.env.HASNA_HOME;
    try {
      process.env.HASNA_HOME = home;
      await expect(saveFeedback({ message: "nowhere to send this" })).rejects.toThrow(/failing closed/);
      noLocalStoreWritten();
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_HOME;
      else process.env.HASNA_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the explicit local opt-in still writes the on-machine database", async () => {
    delete process.env.HASNA_SKILLS_API_URL;
    delete process.env.HASNA_SKILLS_API_KEY;
    process.env.HASNA_SKILLS_LOCAL = "1";
    const result = await saveFeedback({ message: "on this machine, deliberately", category: "bug" });
    expect(result).toMatchObject({ saved: true, category: "bug", target: "local", path: join(dataDir, "skills.db") });
    expect(existsSync(join(dataDir, "skills.db"))).toBe(true);
  });
});
