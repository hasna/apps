import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startPolling } from "./poll";
import { sendMessage } from "./messages";
import { createChannel } from "./channels";
import { closeDb } from "./db";
import { ENV_KEYS, getStore, type ConversationsStore } from "./store/index";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../types";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-poll-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
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
    // sendMessage refuses a channel with no row rather than writing an orphan
    // that `channel list` cannot see (todos 4cc80a4d).
    createChannel("general", "fixture");

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

  test("SEED_DOWN keeps readiness pending and never replays PREARM from since_id=0", async () => {
    const message = (id: number, content: string): Message => ({
      id,
      uuid: `message-${id}`,
      session_id: "seed-race",
      from_agent: "alice",
      to_agent: "watcher",
      channel: null,
      project_id: null,
      content,
      priority: "normal",
      working_dir: null,
      repository: null,
      branch: null,
      metadata: null,
      created_at: new Date(id * 1000).toISOString(),
      read_at: null,
      edited_at: null,
      pinned_at: null,
      blocking: false,
      attachments: null,
      reply_to: null,
    });
    const prearm = message(1, "PREARM");
    const live = message(2, "LIVE");
    const reads: Array<{ since_id?: number }> = [];
    const errors: string[] = [];
    const delivered: Message[] = [];
    let seedCalls = 0;
    let liveAvailable = false;
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const store = {
      readMessages: async (args: { since_id?: number }) => {
        reads.push({ since_id: args.since_id });
        if (args.since_id === undefined) {
          seedCalls++;
          if (seedCalls === 1) throw new Error("SEED_DOWN");
          await recoveryGate;
          return [prearm];
        }
        if (args.since_id === 0) return [prearm];
        if (args.since_id === prearm.id && liveAvailable) return [live];
        return [];
      },
    } as unknown as ConversationsStore;

    const poll = startPolling({
      store,
      to_agent: "watcher",
      interval_ms: 5,
      on_messages: (messages) => delivered.push(...messages),
      on_poll_error: (line) => errors.push(line),
    });

    while (seedCalls < 2) await Bun.sleep(1);

    const readiness = await Promise.race([
      poll.ready.then(() => "ready"),
      Bun.sleep(25).then(() => "pending"),
    ]);
    expect(readiness).toBe("pending");
    expect(reads.filter((read) => read.since_id !== undefined)).toEqual([]);
    expect(delivered).toEqual([]);

    releaseRecovery();
    await poll.ready;
    liveAvailable = true;
    while (delivered.length === 0) await Bun.sleep(1);
    await poll.stop();

    expect(errors.join("\n")).toContain("SEED_DOWN");
    expect(reads.filter((read) => read.since_id !== undefined).every(
      (read) => read.since_id !== 0,
    )).toBe(true);
    expect(delivered.map((item) => item.content)).toEqual(["LIVE"]);
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
  let failingStore: ConversationsStore;
  let errorLines: string[] = [];
  let restoreConsole: (() => void) | null = null;
  let absorbRejection: ((reason: unknown) => void) | null = null;

  beforeEach(() => {
    // A store built from a PRIVATE env object, never from process.env.
    //
    // The earlier version of this fixture deleted the DB-path keys and set the
    // cloud keys on process.env for the duration of the test. That is a
    // process-wide flip, and getStore(env = process.env) re-reads the
    // environment on every call without caching — so every other live poll
    // loop in the bun test process silently re-pointed at this closed port
    // too, including the channel bridges buildServer() starts and never
    // disposes (todos 890b269e). Their retrying reads then outlived this file
    // and landed in a later file's global fetch stub. Building the store here
    // and handing it to this ONE loop keeps the fixture's real transport and
    // real fetch while touching nothing global (todos 19c79404).
    //
    // Port 9 (discard) is closed here: connect fails immediately.
    failingStore = getStore({
      [ENV_KEYS.apiUrlKeys[0]]: "http://127.0.0.1:9/v1",
      [ENV_KEYS.apiKeyKeys[0]]: "placeholder-not-a-credential",
    });

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
      store: failingStore,
      to_agent: "watcher",
      interval_ms: 30,
      on_messages: () => {},
    });
    await new Promise((r) => setTimeout(r, WINDOW_MS));

    // Awaited, not fired and forgotten. `stop()` resolves only once the read
    // that was already retrying when the timer was cleared has drained; until
    // then it can still reach the global fetch stub installed by a later test
    // file and manufacture an unrelated webhook call (todos 19c79404). This
    // replaces a fixed sleep, which raced the transport's own retry schedule.
    await stop();

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

  /**
   * The test above is only safe because `stop()` drains. This asserts that
   * property directly, so it cannot regress silently (todos 19c79404).
   *
   * Measured on 0d51745, where `stop()` did not drain: a counting stub
   * installed AFTER stop() recorded
   *   `callCount_after_50ms=0 callCount_after_2050ms=1`
   * — one real fetch arriving late, from a loop the caller believed had
   * stopped. That is the call that incremented webhooks.test.ts's counter and
   * turned CI red. This test fails on that revision and passes on this one.
   */
  test("stop() drains — a stopped loop never reaches a later fetch stub", async () => {
    // A DISTINCT loopback authority, so this assertion counts THIS loop's traffic
    // and nothing else. Counting every fetch in the process instead makes the
    // test a global canary: it then fails on any unrelated leak elsewhere in
    // the suite, which is a true statement about the suite but not about the
    // property under test. `localhost:9` is closed exactly like 127.0.0.1:9,
    // and it is one of the exact loopback authorities the shared
    // @hasna/contracts resolver accepts for http (127.0.0.9 is deliberately
    // NOT in that set). Its own closed loopback host, and its own private
    // store, so the count below is THIS loop's traffic and nothing else. Two
    // separate hazards are being avoided: counting every fetch in the process
    // would make this a global canary that fails on any unrelated leak, and
    // setting the URL on process.env would hand this host to every other live
    // loop as well.
    const PROBE_HOST = "localhost";
    const probeStore = getStore({
      [ENV_KEYS.apiUrlKeys[0]]: `http://${PROBE_HOST}:9/v1`,
      [ENV_KEYS.apiKeyKeys[0]]: "placeholder-not-a-credential",
    });

    const { stop } = startPolling({
      store: probeStore,
      to_agent: "watcher",
      interval_ms: 30,
      on_messages: () => {},
    });
    // Long enough that a read is genuinely mid-retry when stop() is called;
    // stopping before the first read starts would make this vacuous.
    await new Promise((r) => setTimeout(r, OBSERVED_FAILED_READ_MS));
    await stop();

    // Take ownership of the global exactly as a later test file would, but
    // discriminate on the URL and pass everything else through — the pattern
    // src/server/serve.test.ts already uses.
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input).includes(PROBE_HOST)) {
        callCount++;
        return new Response("ok");
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      await new Promise((r) => setTimeout(r, OBSERVED_FAILED_READ_MS * 4));
      expect(callCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, WINDOW_MS + 10000);
});
