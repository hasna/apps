/**
 * `skills feedback` end to end against a real instance.
 *
 * The CLI is spawned as a subprocess with a hosted credential and pointed at
 * the REAL /api/v1 handler running in this process, so what is asserted is the
 * whole path: the command reaches POST /api/v1/feedback, the instance stores a
 * row, the row reads back through GET /api/v1/feedback, and the child's home
 * gains no database. Before this port the same command wrote
 * ~/.hasna/skills/feedback.jsonl on exactly this environment.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { MemorySkillsStore } from "../server/store.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const CLI_PATH = join(import.meta.dir, "index.tsx");
const PRINCIPAL = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
// A fixture bearer for the in-process instance below; never a real credential.
const SEED_KEYS = [{ token: "sk_test_cli_feedback", principal: PRINCIPAL }];
const FIXTURE_BEARER = SEED_KEYS[0]!.token;

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function instance(): Promise<{ origin: string; requests: string[] }> {
  const handler = await createSkillsFetchHandler({
    store: new MemorySkillsStore(SEED_KEYS),
    governanceStore: new MemoryGovernanceStore(),
    config: { inlineWorker: false, allowEphemeralStore: true },
  });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return handler(request);
    },
  });
  cleanup.push(() => server.stop(true));
  return { origin: `http://127.0.0.1:${server.port}`, requests };
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "skills-cli-feedback-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function runFeedback(root: string, args: string[], env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI_PATH, "feedback", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: join(root, "home"),
      HASNA_HOME: join(root, "home", "fleet"),
      HASNA_SKILLS_DIR: join(root, "data"),
      // Blind the Keychain tier: on a real station the ladder would otherwise
      // find this machine's own skills credential and the refusal case below
      // would pass for the wrong reason.
      HASNA_STATION: "skills-suite-no-such-keychain-account",
      SKILLS_TEST_MODE: "1",
      NO_COLOR: "1",
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** No client-side store of any shape, anywhere under the child's home. */
function noLocalStore(root: string): void {
  const dataDir = join(root, "data");
  const names = existsSync(dataDir) ? readdirSync(dataDir) : [];
  expect(names.filter((name) => name.includes(".db"))).toEqual([]);
  expect(names).not.toContain("feedback.jsonl");
}

test("skills feedback sends to the instance and the instance reads the report back", async () => {
  const { origin, requests } = await instance();
  const root = scratch();

  const result = await runFeedback(root, ["the pull command is great", "--category", "feature", "--agent", "station03", "--json"], {
    HASNA_SKILLS_API_URL: origin,
    HASNA_SKILLS_API_KEY: FIXTURE_BEARER,
  });
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload).toMatchObject({ saved: true, category: "feature", target: "hosted" });
  expect(String(payload.id).startsWith("fbk_")).toBe(true);
  expect(requests).toEqual(["POST /api/v1/feedback"]);
  noLocalStore(root);

  const stored = await new RemoteSkillsClient(FIXTURE_BEARER, origin).listFeedback();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: payload.id, message: "the pull command is great", category: "feature", agent: "station03" });
});

test("human output names the hosted report; a second send is a second row", async () => {
  const { origin } = await instance();
  const root = scratch();
  const first = await runFeedback(root, ["docs could be clearer"], { HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY: FIXTURE_BEARER });
  expect(first.exitCode).toBe(0);
  expect(first.stdout).toContain("Feedback sent");
  const second = await runFeedback(root, ["docs could be clearer"], { HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY: FIXTURE_BEARER });
  expect(second.exitCode).toBe(0);
  noLocalStore(root);
  expect(await new RemoteSkillsClient(FIXTURE_BEARER, origin).listFeedback()).toHaveLength(2);
});

test("no credential and no opt-in: the command fails closed and writes nothing", async () => {
  const { requests } = await instance();
  const root = scratch();
  const result = await runFeedback(root, ["nowhere to send this", "--json"], {});
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ saved: false });
  expect(JSON.parse(result.stdout).error).toContain("failing closed");
  expect(requests).toEqual([]);
  noLocalStore(root);
});

test("an authority with no credential never falls back to a local write", async () => {
  const { origin, requests } = await instance();
  const root = scratch();
  const result = await runFeedback(root, ["half configured", "--json"], { HASNA_SKILLS_API_URL: origin });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout).error).toContain("no API key resolved");
  expect(requests).toEqual([]);
  noLocalStore(root);
});
