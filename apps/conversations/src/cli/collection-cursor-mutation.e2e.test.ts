import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
import { hermeticHomeEnv } from "../test/hermetic.js";

let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];
function runCli(args: string[], agent?: string) {
  const env: Record<string, string> = { ...hermeticHomeEnv(), ...fixture.env, FORCE_COLOR: "0" };
  if (agent) env.CONVERSATIONS_AGENT_ID = agent;
  const result = Bun.spawnSync({ cmd: [...CLI, ...args], cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function page(args: string[], key: string, agent?: string) {
  const result = runCli([...args, "--json", "--limit", "2"], agent);
  expect(result.exitCode, result.stderr).toBe(0);
  const value = JSON.parse(result.stdout) as Record<string, any>;
  expect(value.cursor).toBeNull();
  expect(value.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(value.collection_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(value[key]).toHaveLength(2);
  return value;
}

function expectMutationRefusal(args: string[], cursor: string, agent?: string) {
  const result = runCli([...args, "--json", "--limit", "2", "--cursor", cursor], agent);
  expect(result.exitCode).not.toBe(0);
  if (!result.stdout.trim()) throw new Error(`mutation refusal missing JSON stdout; stderr=${result.stderr}`);
  const error = JSON.parse(result.stdout) as { error: string };
  expect(error.error).toContain("collection changed during pagination");
}

const TIED_AT = "2026-09-19T04:00:00.000Z";

describe("opaque collection cursors fail closed across live CLI mutations", () => {
  test("agents: tied ordering, insertion, deletion and heartbeat reordering", async () => {
    await fixture.seed({ presence: ["alpha", "bravo", "charlie"].map((suffix, index) => ({
      id: `cursor-agent-id-${index}`,
      agent: `cursor-agent-${suffix}`,
      session_id: `cursor-agent-session-${suffix}`,
      role: "agent",
      project_id: null,
      status: "online",
      last_seen_at: TIED_AT,
      created_at: TIED_AT,
      online: true,
      metadata: null,
    })) });
    const first = page(["agents", "list"], "agents");
    expect(first.agents.map((row: any) => row.agent)).toEqual(["cursor-agent-alpha", "cursor-agent-bravo"]);
    expect(first.tie_breakers).toEqual(["agent asc", "id asc"]);

    expect(runCli(["agents", "register", "cursor-agent-insert", "--session", "cursor-agent-insert-session", "--json"], "cursor-agent-insert").exitCode).toBe(0);
    expectMutationRefusal(["agents", "list"], first.next_cursor);

    const beforeDelete = page(["agents", "list"], "agents");
    expect(runCli(["agents", "remove", "cursor-agent-bravo", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["agents", "list"], beforeDelete.next_cursor);

    const beforeReorder = page(["agents", "list"], "agents");
    expect(runCli(["agents", "heartbeat", "--from", "cursor-agent-charlie", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["agents", "list"], beforeReorder.next_cursor);

    const numeric = runCli(["agents", "list", "--json", "--cursor", "2"]);
    expect(numeric.exitCode).not.toBe(0);
    expect(JSON.parse(numeric.stdout).error).toContain("Invalid agents continuation cursor");
  }, 30_000);

  test("sessions: tied ordering, insertion, deletion and activity reordering", async () => {
    const channel = "cursor-session-channel";
    await fixture.seed({
      channel: { row: { id: "cursor-session-channel-id", name: channel, created_by: "cursor-session-writer", created_at: TIED_AT }, members: ["cursor-session-writer"] },
      messages: ["alpha", "bravo", "charlie"].map((suffix, index) => ({
        id: 910_000 + index,
        uuid: `11111111-1111-4111-8111-${String(910000 + index).padStart(12, "0")}`,
        session_id: `cursor-session-${suffix}`,
        from_agent: "cursor-session-writer",
        to_agent: channel,
        channel,
        content: `cursor session ${suffix}`,
        created_at: TIED_AT,
        read_at: null,
      })),
    });
    const first = page(["sessions"], "sessions");
    expect(first.sessions.map((row: any) => row.session_id)).toEqual(["cursor-session-alpha", "cursor-session-bravo"]);
    expect(first.tie_breakers).toEqual(["session_id asc"]);

    expect(runCli(["channel", "send", channel, "insert session", "--session", "cursor-session-insert", "--from", "cursor-session-writer", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["sessions"], first.next_cursor);

    const beforeDelete = page(["sessions"], "sessions");
    expect(runCli(["delete", "910001", "--from", "cursor-session-writer", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["sessions"], beforeDelete.next_cursor);

    const beforeReorder = page(["sessions"], "sessions");
    expect(runCli(["channel", "send", channel, "reorder charlie", "--session", "cursor-session-charlie", "--from", "cursor-session-writer", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["sessions"], beforeReorder.next_cursor);
  }, 30_000);

  test("members: tied ordering, insertion, deletion and leave/rejoin reordering", async () => {
    const channel = "cursor-member-channel";
    await fixture.seed({ channel: {
      row: { id: "cursor-member-channel-id", name: channel, created_by: "cursor-member-alpha", created_at: TIED_AT },
      members: ["cursor-member-alpha", "cursor-member-bravo", "cursor-member-charlie"],
    } });
    const first = page(["channel", "members", channel], "members");
    expect(first.members.map((row: any) => row.agent)).toEqual(["cursor-member-alpha", "cursor-member-bravo"]);
    expect(first.tie_breakers).toEqual(["agent asc", "channel asc"]);

    expect(runCli(["channel", "join", channel, "--from", "cursor-member-delta", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["channel", "members", channel], first.next_cursor);

    const beforeDelete = page(["channel", "members", channel], "members");
    expect(runCli(["channel", "leave", channel, "--from", "cursor-member-bravo", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["channel", "members", channel], beforeDelete.next_cursor);

    const beforeReorder = page(["channel", "members", channel], "members");
    expect(runCli(["channel", "leave", channel, "--from", "cursor-member-alpha", "--json"]).exitCode).toBe(0);
    expect(runCli(["channel", "join", channel, "--from", "cursor-member-alpha", "--json"]).exitCode).toBe(0);
    expectMutationRefusal(["channel", "members", channel], beforeReorder.next_cursor);
  }, 30_000);

  test("subscriptions: tied ordering, insertion, deletion and unsubscribe/resubscribe reordering", async () => {
    const owner = "cursor-sub-owner";
    const channels = ["alpha", "bravo", "charlie", "delta"].map((suffix) => `cursor-sub-${suffix}`);
    await fixture.seed({
      channels: channels.map((name, index) => ({ id: `cursor-sub-channel-${index}`, name, created_by: owner, created_at: TIED_AT })),
      subscriptions: channels.slice(0, 3).map((channel, index) => ({ channel, agent: owner, created_at: TIED_AT, preview_chars: 160, since_message_id: index })),
    });
    const first = page(["channel", "subscriptions"], "subscriptions", owner);
    expect(first.subscriptions.map((row: any) => row.channel)).toEqual(["cursor-sub-alpha", "cursor-sub-bravo"]);
    expect(first.tie_breakers).toEqual(["channel asc", "agent asc"]);

    expect(runCli(["channel", "subscribe", "cursor-sub-delta", "--from", owner, "--json"], owner).exitCode).toBe(0);
    expectMutationRefusal(["channel", "subscriptions"], first.next_cursor, owner);

    const beforeDelete = page(["channel", "subscriptions"], "subscriptions", owner);
    expect(runCli(["channel", "unsubscribe", "cursor-sub-bravo", "--from", owner, "--json"], owner).exitCode).toBe(0);
    expectMutationRefusal(["channel", "subscriptions"], beforeDelete.next_cursor, owner);

    const beforeReorder = page(["channel", "subscriptions"], "subscriptions", owner);
    expect(runCli(["channel", "unsubscribe", "cursor-sub-alpha", "--from", owner, "--json"], owner).exitCode).toBe(0);
    expect(runCli(["channel", "subscribe", "cursor-sub-alpha", "--from", owner, "--json"], owner).exitCode).toBe(0);
    expectMutationRefusal(["channel", "subscriptions"], beforeReorder.next_cursor, owner);
  }, 30_000);
});
