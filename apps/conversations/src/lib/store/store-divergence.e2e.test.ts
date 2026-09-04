// The behavioural proof, not just a resolution assertion.
//
// The measured P0 (station01, 2026-07-30, @hasna/conversations 0.5.9) was that the
// two stores hold GENUINELY DIFFERENT DATA — 844 channels in cloud versus 608 in
// the on-box SQLite file — and that a half-configured cloud client served the 608
// silently, with no error and no flag. A test that only asserts "resolution throws"
// would not have caught that; it has to be shown that the fall-back answer is a
// different answer, and that the client now refuses instead of picking one.
//
// This fixture reproduces that shape at small scale: a seeded local store and a
// stub cloud API deliberately disagree about how many channels exist.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROBE = join(import.meta.dir, "store-divergence.probe.ts");

/** Deliberately different counts, mirroring the measured 608-vs-844 divergence. */
const LOCAL_CHANNELS = 6;
const CLOUD_CHANNELS = 8;

/** Not a credential: a deliberately invalid stub the local server never checks. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

let sandboxHome: string;
let server: ReturnType<typeof Bun.serve>;
let cloudUrl: string;

/**
 * Run the probe with a pristine env. `HOME` is redirected into a sandbox so the
 * local store can never resolve to the real ~/.hasna/conversations database, and
 * every store variable is explicitly cleared before the case sets its own.
 */
async function probe(mode: string, arg: string, env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", PROBE, mode, arg],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: sandboxHome,
      HASNA_CONVERSATIONS_API_URL: undefined,
      HASNA_CONVERSATIONS_API_KEY: undefined,
      HASNA_CONVERSATIONS_DB_PATH: undefined,
      CONVERSATIONS_API_URL: undefined,
      CONVERSATIONS_API_KEY: undefined,
      CONVERSATIONS_DB_PATH: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(line);
  } catch {
    /* leave empty; assertions below will surface stderr */
  }
  return { exitCode, stdout, stderr, result: parsed };
}

beforeAll(async () => {
  sandboxHome = mkdtempSync(join(tmpdir(), "conversations-divergence-"));

  // A stub cloud API that reports a DIFFERENT channel count than the local store.
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/channels") {
        return Response.json({
          channels: Array.from({ length: CLOUD_CHANNELS }, (_, i) => ({
            name: `cloud-channel-${i}`,
          })),
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  cloudUrl = `http://127.0.0.1:${server.port}`;

  const seeded = await probe("seed", String(LOCAL_CHANNELS), {
    HASNA_CONVERSATIONS_DB_PATH: join(sandboxHome, ".hasna", "conversations", "messages.db"),
  });
  expect(seeded.exitCode, `seed failed: ${seeded.stderr}`).toBe(0);
});

afterAll(() => {
  server?.stop(true);
  if (sandboxHome) rmSync(sandboxHome, { recursive: true, force: true });
});

describe("store divergence — the two stores really do hold different data", () => {
  test("the local store reports its own channel count", async () => {
    const { exitCode, result, stderr } = await probe("count", "", {
      HASNA_CONVERSATIONS_DB_PATH: join(sandboxHome, ".hasna", "conversations", "messages.db"),
    });

    expect(exitCode, stderr).toBe(0);
    expect(result.transport).toBe("local");
    expect(result.channels).toBe(LOCAL_CHANNELS);
  });

  test("the cloud store reports a different channel count", async () => {
    const { exitCode, result, stderr } = await probe("count", "", {
      HASNA_CONVERSATIONS_API_URL: cloudUrl,
      HASNA_CONVERSATIONS_API_KEY: FAKE_KEY,
    });

    expect(exitCode, stderr).toBe(0);
    expect(result.transport).toBe("cloud-http");
    expect(result.channels).toBe(CLOUD_CHANNELS);
    // The whole point: answering from the wrong store is a WRONG ANSWER, not a
    // stylistic difference.
    expect(result.channels).not.toBe(LOCAL_CHANNELS);
  });
});

describe("store divergence — a half-configured cloud client refuses instead of guessing", () => {
  // THE REGRESSION. Before the fix this exited 0 and reported the LOCAL count while
  // the operator believed they were reading cloud.
  test("API URL without an API key refuses, and reports neither store's data", async () => {
    const { exitCode, result } = await probe("count", "", {
      HASNA_CONVERSATIONS_API_URL: cloudUrl,
    });

    expect(exitCode).not.toBe(0);
    expect(result.refused).toBe(true);
    expect(result.name).toBe("ConversationsStoreConfigError");
    expect(result.message).toContain("HASNA_CONVERSATIONS_API_KEY");

    // It must not have quietly answered from either dataset.
    expect(result.transport).toBeUndefined();
    expect(result.channels).toBeUndefined();
  });

  test("an API key without an API URL likewise refuses", async () => {
    const { exitCode, result } = await probe("count", "", {
      HASNA_CONVERSATIONS_API_KEY: FAKE_KEY,
    });

    expect(exitCode).not.toBe(0);
    expect(result.refused).toBe(true);
    expect(result.message).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(result.channels).toBeUndefined();
  });

  test("no credential value ever reaches the error message", async () => {
    const { result } = await probe("count", "", { HASNA_CONVERSATIONS_API_KEY: FAKE_KEY });

    expect(String(result.message)).not.toContain(FAKE_KEY);
  });
});

describe("store divergence — legitimate local use is explicit opt-in only", () => {
  // THE 2026-09-04 FAIL-CLOSED FLIP. An unconfigured client previously fell back
  // to the local store at the default ~/.hasna path and exited 0 — a CLI run
  // without its API env presented a different, stale dataset as the fleet's with
  // no signal. It now refuses, naming the required variables, and no local
  // database is opened.
  test("an unconfigured client refuses instead of reading its local store", async () => {
    const { exitCode, result, stderr } = await probe("count", "", {});

    expect(exitCode, stderr).not.toBe(0);
    expect(result.refused).toBe(true);
    expect(result.name).toBe("ConversationsStoreConfigError");
    expect(result.message).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(result.message).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(result.channels).toBeUndefined();
  });

  test("an explicit local DB path still wins over exported cloud credentials", async () => {
    const { exitCode, result, stderr } = await probe("count", "", {
      HASNA_CONVERSATIONS_DB_PATH: join(sandboxHome, ".hasna", "conversations", "messages.db"),
      HASNA_CONVERSATIONS_API_URL: cloudUrl,
      HASNA_CONVERSATIONS_API_KEY: FAKE_KEY,
    });

    expect(exitCode, stderr).toBe(0);
    expect(result.transport).toBe("local");
    expect(result.channels).toBe(LOCAL_CHANNELS);
  });
});
