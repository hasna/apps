import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { backfilledChannelIdForName } from "../lib/channel-id.js";

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];
const CHANNEL = "policy-search-compact";
const CUTOFF = "2026-08-02T12:00:00.000Z";

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...fixture.env,
      CONVERSATIONS_AGENT_ID: "search-compact-test",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("search --json compact policy-awareness envelope", () => {
  beforeAll(async () => {
    const body = (label: string) => `[POLICY] ${label} ${"bounded-preview ".repeat(400)}`;
    await fixture.seed({channel:{row:{id:backfilledChannelIdForName(CHANNEL),name:CHANNEL,created_by:"alice"},members:[]},messages:[
      ["before","2026-08-02T11:59:59.999Z"],["at-cutoff",CUTOFF],["after","2026-08-02T12:00:00.001Z"],
    ].map(([label,created_at])=>({session_id:"policy-session",from_agent:"alice",to_agent:CHANNEL,channel:CHANNEL,content:body(label),metadata:JSON.stringify({raw:"must-not-leak"}),attachments:JSON.stringify([{name:"private.txt"}]),created_at}))});
  });

  test("returns an inclusive, complete, preview-only page with in-band byte metadata", () => {
    const res = runCli([
      "search", "POLICY", "--channel", CHANNEL,
      "--since", CUTOFF, "--limit", "500", "--json",
    ]);

    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout) as {
      messages: Array<Record<string, unknown>>;
      count: number;
      has_more: boolean;
      next_cursor: number | null;
      max_bytes: number;
      byte_length: number;
      since: string;
      compact: boolean;
    };
    expect(payload.messages).toHaveLength(2);
    expect(payload.count).toBe(2);
    expect(payload.has_more).toBe(false);
    expect(payload.next_cursor).toBeNull();
    expect(payload.since).toBe(CUTOFF);
    expect(payload.compact).toBe(true);
    expect(payload.max_bytes).toBeGreaterThan(payload.byte_length);
    expect(payload.byte_length).toBe(Buffer.byteLength(JSON.stringify(payload), "utf8"));

    for (const message of payload.messages) {
      expect(message.content).toBeUndefined();
      expect(message.metadata).toBeUndefined();
      expect(message.attachments).toBeUndefined();
      expect(typeof message.preview).toBe("string");
      expect((message.preview as string).length).toBeGreaterThan(0);
      expect((message.preview as string).length).toBeLessThanOrEqual(160);
    }
    expect(payload.messages.some((message) => String(message.preview).includes("before"))).toBe(false);
  });

  test("rejects an invalid --since timestamp instead of silently comparing it", () => {
    const res = runCli(["search", "POLICY", "--channel", CHANNEL, "--since", "not-a-timestamp", "--json"]);
    expect(res.exitCode).not.toBe(0);
    expect(JSON.parse(res.stdout).error).toContain("Invalid --since timestamp");
    expect(res.stderr).toBe("");
  });
});
