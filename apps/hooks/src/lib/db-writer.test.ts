/**
 * The hook-event writer gate (hasna/apps#1720 fail-closed ruling, W6
 * 2026-09-11). `writeHookEvent` used to be the one ungated path into
 * ~/.hasna/hooks/hooks.db — reached from every `hooks run`, the MCP run tools
 * and four bundled hook runtimes — and it CREATED the store on first write
 * with no route decision. The sink decision below is what closed that: the
 * store is written only under the explicit local opt-in, answered from the
 * env dictionary alone (never the Keychain), and every other route is a
 * loud, once-per-process refusal that opens nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { allowLocalStore, closeDb, refuseLocalStore } from "../db/index.js";
import { __resetHookEventSinkNotice, resolveHookEventSink, writeHookEvent, type HookEventInput } from "./db-writer.js";
import { hooksEventSinkRefusal } from "./local-opt-in.js";

const KEYS = [
  "HASNA_HOOKS_LOCAL",
  "HOOKS_LOCAL",
  "HASNA_HOOKS_API_URL",
  "HASNA_HOOKS_API_KEY",
  "HOOKS_API_URL",
  "HOOKS_API_KEY",
  "HASNA_HOOKS_API_KEY_OVERRIDE",
  "HASNA_HOOKS_API_KEY_REF",
  "HASNA_PROFILE",
];

const saved: Record<string, string | undefined> = {};
let dataDir: string;
const savedDataDir = process.env.HASNA_HOOKS_DATA_DIR;
const savedDbPath = process.env.HASNA_HOOKS_DB_PATH;

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  dataDir = mkdtempSync(join(tmpdir(), "hooks-db-writer-gate-"));
  process.env.HASNA_HOOKS_DATA_DIR = dataDir;
  process.env.HASNA_HOOKS_DB_PATH = join(dataDir, "hooks.db");
  closeDb();
  allowLocalStore();
  __resetHookEventSinkNotice();
});

afterEach(() => {
  closeDb();
  allowLocalStore();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  if (savedDataDir === undefined) delete process.env.HASNA_HOOKS_DATA_DIR;
  else process.env.HASNA_HOOKS_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.HASNA_HOOKS_DB_PATH;
  else process.env.HASNA_HOOKS_DB_PATH = savedDbPath;
  rmSync(dataDir, { recursive: true, force: true });
});

function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let out = "";
  (process.stderr as any).write = (chunk: any) => {
    out += String(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as any).write = original;
  }
  return out;
}

const EVENT: HookEventInput = {
  session_id: "s1",
  hook_name: "gate-demo",
  event_type: "PostToolUse",
  tool_name: null,
  tool_input: null,
  result: null,
  error: null,
  duration_ms: null,
  project_dir: null,
  metadata: null,
};

describe("hook-event sink decision (env dictionary only, no resolver)", () => {
  test("nothing configured → refused, naming the opt-in", () => {
    const sink = resolveHookEventSink({});
    expect(sink.kind).toBe("refused");
    expect((sink as any).reason).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect((sink as any).reason).toContain("HASNA_HOOKS_LOCAL=1");
    expect((sink as any).reason).toBe(hooksEventSinkRefusal());
  });

  test("the explicit opt-in (canonical and alias) selects the on-box store", () => {
    expect(resolveHookEventSink({ HASNA_HOOKS_LOCAL: "1" }).kind).toBe("local");
    expect(resolveHookEventSink({ HOOKS_LOCAL: "1" }).kind).toBe("local");
  });

  test("a configured authority outranks a stale opt-in", () => {
    const sink = resolveHookEventSink({ HASNA_HOOKS_LOCAL: "1", HASNA_HOOKS_API_KEY: "k" });
    expect(sink.kind).toBe("refused");
  });

  test("a process-wide store refusal (hosted route) wins over everything", () => {
    refuseLocalStore("REMOTE_COMMAND_UNSUPPORTED: hosted route test refusal");
    const sink = resolveHookEventSink({ HASNA_HOOKS_LOCAL: "1" });
    expect(sink.kind).toBe("refused");
    expect((sink as any).reason).toContain("hosted route test refusal");
  });
});

describe("writeHookEvent never silently creates hooks.db", () => {
  test("with nothing configured: one stderr line, no file, no throw", () => {
    const err = captureStderr(() => {
      writeHookEvent(EVENT);
      writeHookEvent(EVENT);
    });
    expect(err.split("\n").filter((l) => l.includes("REMOTE_COMMAND_UNSUPPORTED")).length).toBe(1);
    expect(err).toContain("HASNA_HOOKS_LOCAL=1");
    expect(existsSync(join(dataDir, "hooks.db"))).toBe(false);
  });

  test("on the hosted route (refusal installed): nothing opened", () => {
    refuseLocalStore("REMOTE_COMMAND_UNSUPPORTED: hosted route — local SQLite is opt-in only (HASNA_HOOKS_LOCAL=1)");
    const err = captureStderr(() => writeHookEvent(EVENT));
    expect(err).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(existsSync(join(dataDir, "hooks.db"))).toBe(false);
  });

  test("under the explicit opt-in the row lands in the on-box store", () => {
    process.env.HASNA_HOOKS_LOCAL = "1";
    const err = captureStderr(() => writeHookEvent(EVENT));
    expect(err).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(existsSync(join(dataDir, "hooks.db"))).toBe(true);
    const { getDb } = require("../db/index.js");
    const row = getDb().query("SELECT COUNT(*) AS n FROM hook_events WHERE hook_name = 'gate-demo'").get() as { n: number };
    expect(row.n).toBe(1);
  });
});
