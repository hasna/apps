import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startPolling } from "./poll";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { ENV_KEYS, DB_PATH_KEYS } from "./store/index";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../types";

const TEST_DB = join(tmpdir(), `conversations-test-poll-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("startPolling", () => {
  test("returns stop function", () => {
    const { stop } = startPolling({
      interval_ms: 1000,
      on_messages: () => {},
    });
    expect(typeof stop).toBe("function");
    stop();
  });

  test("detects new messages", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      to_agent: "bob",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    // Send after polling starts
    sendMessage({ from: "alice", to: "bob", content: "hello" });

    // Wait for poll cycle
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].content).toBe("hello");
  });

  test("filters by session_id", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      session_id: "target-session",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    sendMessage({ from: "a", to: "b", content: "match", session_id: "target-session" });
    sendMessage({ from: "a", to: "b", content: "no-match", session_id: "other" });

    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.every((m) => m.session_id === "target-session")).toBe(true);
  });

  test("filters by channel", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      channel: "general",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    sendMessage({ from: "a", to: "general", content: "sp-msg", channel: "general" });
    sendMessage({ from: "a", to: "b", content: "dm-msg" });

    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.every((m) => m.channel === "general")).toBe(true);
  });

  test("handles callback errors gracefully", async () => {
    const { stop } = startPolling({
      interval_ms: 50,
      on_messages: () => { throw new Error("callback error"); },
    });
    sendMessage({ from: "a", to: "b", content: "trigger" });
    await new Promise((r) => setTimeout(r, 200));
    stop();
    // Should not throw — error is caught internally
  });

  test("stop prevents further callbacks", async () => {
    let callCount = 0;

    const { stop } = startPolling({
      interval_ms: 30,
      on_messages: () => { callCount++; },
    });

    stop();
    sendMessage({ from: "a", to: "b", content: "after-stop" });

    await new Promise((r) => setTimeout(r, 150));
    expect(callCount).toBe(0);
  });
});

/**
 * Regression: a store failure during polling must be VISIBLE and must not end
 * the loop (todos d3c6b65e).
 *
 * The failure is induced with a REAL ApiStore aimed at a closed port, not a
 * mock: getStore() resolves the cloud transport from env, so every read is a
 * genuine fetch that genuinely rejects. That exercises the real transport the
 * fleet runs, and it cannot pass because a stub was wired up wrongly.
 *
 * These assert OBSERVABLES — that error text reaches stderr, that polling
 * continues afterwards, and that a sustained outage is labelled — never that
 * some `catch` block exists.
 */
describe("startPolling — store failure visibility (regression d3c6b65e)", () => {
  const saved: Record<string, string | undefined> = {};
  let errorLines: string[] = [];
  let restoreConsole: (() => void) | null = null;
  let absorbRejection: ((reason: unknown) => void) | null = null;

  beforeEach(() => {
    // An explicit local DB path outranks the cloud keys in getStore()'s
    // precedence table, and the suite-level beforeEach sets one — clear them
    // or this test quietly measures a healthy LocalStore instead.
    for (const key of DB_PATH_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    const urlKey = ENV_KEYS.apiUrlKeys[0];
    const keyKey = ENV_KEYS.apiKeyKeys[0];
    saved[urlKey] = process.env[urlKey];
    saved[keyKey] = process.env[keyKey];
    // Port 9 (discard) is closed here: connect fails immediately.
    process.env[urlKey] = "http://127.0.0.1:9/v1";
    process.env[keyKey] = "placeholder-not-a-credential";

    errorLines = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errorLines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
    };
    restoreConsole = () => { console.error = original; };

    // Before the fix this loop leaks an unhandled rejection, which would kill
    // the runner before it could report the real assertion. Absorb it so the
    // failure is a readable expect() diff. The CLI installs an equivalent
    // handler at src/cli/index.tsx:172, so this mirrors production rather
    // than inventing a condition.
    absorbRejection = () => {};
    process.on("unhandledRejection", absorbRejection);
  });

  afterEach(() => {
    restoreConsole?.();
    if (absorbRejection) process.off("unhandledRejection", absorbRejection);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // A failed ApiStore read takes ~760ms here, not the ~13ms a bare fetch to
  // the same closed port takes: the storage client retries internally. Reads
  // are serialised by the loop's inFlight guard, so the window has to be sized
  // from the MEASURED figure. A 600ms window expired before the very first
  // read had finished failing and made a working fix look broken.
  const OBSERVED_FAILED_READ_MS = 760;
  const WINDOW_MS = OBSERVED_FAILED_READ_MS * 5;

  test("surfaces store failures and keeps polling through them", async () => {
    const { stop } = startPolling({
      to_agent: "watcher",
      interval_ms: 30,
      on_messages: () => {},
    });
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    stop();

    // `stop()` prevents future ticks, but it cannot cancel a store read that
    // was already retrying when the timer was cleared. Keep this test's closed-
    // port environment and console sink installed until that final read has
    // drained; otherwise it can reach the global fetch mock installed by the
    // next test file and manufacture an unrelated webhook call in CI.
    await new Promise((r) => setTimeout(r, OBSERVED_FAILED_READ_MS * 2));

    // 1. A blind watcher and a quiet inbox must not look alike.
    expect(errorLines.length).toBeGreaterThan(0);

    // 2. The report carries the real error text, not a generic placeholder.
    const joined = errorLines.join("\n");
    expect(/unable to connect|ECONNREFUSED|refused|failed|fetch/i.test(joined)).toBe(true);

    // 3. More than one report proves the loop ran again after the first
    //    failure — the error neither killed it nor wedged it.
    expect(errorLines.length).toBeGreaterThan(1);

    // 4. A sustained outage is labelled, not just logged line by line.
    expect(errorLines.some((line) => line.includes("DEGRADED"))).toBe(true);
  }, WINDOW_MS + 5000);
});
