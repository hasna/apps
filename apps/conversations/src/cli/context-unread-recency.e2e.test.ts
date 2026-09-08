import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression for the `conversations context --json` review finding on PR #39
// (todos 2c25973b). That PR fixed three recency-shaped read call sites but left
// two bare-`limit` `readMessages()` calls inside `context` (the agent
// session-boot summary) unenumerated and untested: `unread_dms` (limit 5,
// unread-only) and `recent_dms` (limit 3). Both inherited whatever the shared
// recency-window default happened to do, instead of stating their own intent.
//
// `unread_dms` is the serious case: it is a BACKLOG summary, not a recency
// window. With more unread DMs than the limit, "newest 5" silently hides the
// older unread backlog forever — reintroducing, at a new call site, the exact
// "caller silently receives the wrong result set with no error" defect this PR
// exists to fix. The fixture below seeds MORE unread DMs than the limit, so
// "newest 5" and "oldest 5" are genuinely different result sets and the test
// can actually fail.

const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];
const AGENT = "bob";
const SENDER = "alice";
// Ten seconds apart so all messages fall inside deterministic, distinct
// timestamps regardless of run date.
const STEP_MS = 10_000;
const BASE = Date.now() - 20 * STEP_MS;

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: { ...fixture.env,
      CONVERSATIONS_AGENT_ID: AGENT,
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

function stamp(n: number): string {
  return new Date(BASE + n * STEP_MS).toISOString();
}

function body(n: number): string {
  return `DM-${n}`;
}

describe("conversations context --json: unread_dms and recent_dms recency", () => {
  beforeAll(async () => {
    await fixture.seed({messages:Array.from({length:8},(_,i)=>({session_id:"context-recency-session",from_agent:SENDER,to_agent:AGENT,content:body(i+1),created_at:stamp(i+1),read_at:i<2?new Date().toISOString():null}))});
  });

  test("the fixture actually has more unread DMs than the unread_dms limit", () => {
    // 6 unread (DM-3..DM-8) > the command's limit of 5, or this test cannot
    // distinguish "oldest 5" from "newest 5" and proves nothing.
    const result=runCli(["read","--unread-only","--limit","100","--json"]);
    expect(result.exitCode).toBe(0);
    const unreadCount=JSON.parse(result.stdout).messages.length;
    expect(unreadCount).toBe(6);
    expect(unreadCount).toBeGreaterThan(5);
  });

  test("unread_dms surfaces the OLDEST unread backlog, not the newest slice", () => {
    const res = runCli(["context", "--json"]);
    expect(res.exitCode).toBe(0);
    const context = JSON.parse(res.stdout) as { unread_dms: Array<{ content: string }> };
    const contents = context.unread_dms.map((m) => m.content);

    // The backlog reading: the OLDEST 5 of the 6 unread DMs (DM-3..DM-7).
    // "Newest 5" (DM-4..DM-8) would silently hide DM-3 — the oldest unread
    // message — forever, exactly the failure mode this PR exists to fix.
    expect(contents).toEqual([body(3), body(4), body(5), body(6), body(7)]);
    expect(contents).toContain(body(3));
    expect(contents).not.toContain(body(8));
  });

  test("recent_dms explicitly surfaces the newest N, chronologically", () => {
    const res = runCli(["context", "--json"]);
    expect(res.exitCode).toBe(0);
    const context = JSON.parse(res.stdout) as { recent_dms: Array<{ content: string }> };
    const contents = context.recent_dms.map((m) => m.content);

    // recent_dms has no unread filter, so it draws from all 8 DMs (read and
    // unread alike): the newest 3 are DM-6, DM-7, DM-8, returned oldest-first
    // so the array still reads as a chronological transcript.
    expect(contents).toEqual([body(6), body(7), body(8)]);
  });
});
