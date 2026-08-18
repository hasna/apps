/**
 * The helper that isolates every other suite has to be isolated itself, so this
 * file pins and restores `process.env` by hand and never calls the module under
 * test to set up its own fixtures.
 *
 * Each case is two-sided where a one-sided one could pass vacuously: a pin that
 * sets nothing and a restore that restores nothing would satisfy "the value is
 * not the ambient one" trivially, so the assertions name the EXPECTED value on a
 * key independently known to carry it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDbPath } from "../db.js";
import {
  STORE_SELECTING_KEYS,
  clearStoreEnv,
  isolatedStoreChildEnv,
  pinStoreToDb,
  restoreStoreEnv,
} from "./isolated-test-env.js";

const HIGH = "HASNA_CONVERSATIONS_DB_PATH";
const LOW = "CONVERSATIONS_DB_PATH";
const PINNED = "/tmp/conversations-isolated-test-env-pinned.db";
const AMBIENT = "/tmp/conversations-isolated-test-env-ambient.db";

/** Snapshot taken WITHOUT the module under test, so a broken save cannot hide. */
let manualSnapshot: Map<string, string | undefined>;

beforeEach(() => {
  manualSnapshot = new Map(STORE_SELECTING_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  restoreStoreEnv();
  for (const [k, v] of manualSnapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the key list", () => {
  test("covers both db-path names, and the higher-precedence one is present", () => {
    // The whole defect is that a suite pins only the lower-precedence name, so a
    // list missing the higher-precedence one would reproduce it inside the fix.
    expect(STORE_SELECTING_KEYS).toContain(HIGH);
    expect(STORE_SELECTING_KEYS).toContain(LOW);
  });

  test("is seven distinct names, derived rather than hardcoded", () => {
    expect(new Set(STORE_SELECTING_KEYS).size).toBe(STORE_SELECTING_KEYS.length);
    expect(STORE_SELECTING_KEYS.length).toBe(7);
  });
});

describe("pinStoreToDb defeats the precedence mismatch", () => {
  test("POSITIVE CONTROL: without the helper, an ambient HIGH name wins", () => {
    // This is the defect, reproduced here so the next case cannot pass vacuously.
    // If this ever stops failing to honour LOW, the fix below proves nothing.
    process.env[HIGH] = AMBIENT;
    process.env[LOW] = PINNED;
    expect(getDbPath()).toBe(AMBIENT);
  });

  test("with the helper, the pinned path wins over an ambient HIGH name", () => {
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    expect(getDbPath()).toBe(PINNED);
    expect(process.env[HIGH]).toBe(PINNED);
    expect(process.env[LOW]).toBe(PINNED);
  });

  test("clears every other store-selecting name, not just the db-path pair", () => {
    for (const key of STORE_SELECTING_KEYS) process.env[key] = "ambient-junk";
    pinStoreToDb(PINNED);
    for (const key of STORE_SELECTING_KEYS) {
      const expected = key === HIGH || key === LOW ? PINNED : undefined;
      expect({ key, value: process.env[key] }).toEqual({ key, value: expected });
    }
  });

  test("refuses an empty path rather than silently pinning nothing", () => {
    expect(() => pinStoreToDb("")).toThrow();
  });
});

describe("restoreStoreEnv puts the environment back exactly", () => {
  test("a previously SET name returns to its original value", () => {
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    expect(process.env[HIGH]).toBe(PINNED);
    restoreStoreEnv();
    expect(process.env[HIGH]).toBe(AMBIENT);
  });

  test("a previously UNSET name is DELETED, not set to the string 'undefined'", () => {
    delete process.env[HIGH];
    delete process.env[LOW];
    pinStoreToDb(PINNED);
    restoreStoreEnv();
    // `in` distinguishes absent from present-and-undefined; a plain equality
    // check against undefined passes for both and would miss the bug.
    expect(HIGH in process.env).toBe(false);
    expect(LOW in process.env).toBe(false);
  });

  test("a name the caller never mentioned is restored too", () => {
    const other = STORE_SELECTING_KEYS.find((k) => k !== HIGH && k !== LOW)!;
    process.env[other] = "ambient-junk";
    pinStoreToDb(PINNED);
    expect(process.env[other]).toBeUndefined();
    restoreStoreEnv();
    expect(process.env[other]).toBe("ambient-junk");
  });

  test("is idempotent, so an afterEach without a matching pin is harmless", () => {
    process.env[HIGH] = AMBIENT;
    restoreStoreEnv();
    restoreStoreEnv();
    expect(process.env[HIGH]).toBe(AMBIENT);
  });

  test("a re-entrant pin does not make the PINNED values the new baseline", () => {
    // Without the `saved === null` guard the second pin records PINNED as the
    // original, and restore then leaves test scaffolding in the ambient env
    // permanently — a leak introduced by the leak-fixer.
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    pinStoreToDb("/tmp/conversations-isolated-test-env-second.db");
    restoreStoreEnv();
    expect(process.env[HIGH]).toBe(AMBIENT);
  });
});

describe("clearStoreEnv, for the case that asserts on NO configuration", () => {
  test("removes both db-path names so getDbPath falls through to the default", () => {
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    clearStoreEnv();
    expect(HIGH in process.env).toBe(false);
    expect(LOW in process.env).toBe(false);
    expect(getDbPath()).toEndWith("messages.db");
  });

  test("LEAVES THE BASELINE INTACT, so the enclosing afterEach can still restore", () => {
    // The distinction from restoreStoreEnv, and the reason both exist. Using
    // restore here would discard the saved baseline and silently turn the
    // suite's own afterEach into a no-op.
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    clearStoreEnv();
    restoreStoreEnv();
    expect(process.env[HIGH]).toBe(AMBIENT);
  });
});

describe("isolatedStoreChildEnv, for the suites that spawn a CLI", () => {
  test("POSITIVE CONTROL: the spread pattern forwards the ambient HIGH name", () => {
    // What the e2e suites do today. The override sits beside a copy of the very
    // variable that beats it.
    process.env[HIGH] = AMBIENT;
    const naive: Record<string, string | undefined> = { ...process.env, [LOW]: PINNED };
    expect(naive[HIGH]).toBe(AMBIENT);
  });

  test("the helper pins both names and drops the ambient one", () => {
    process.env[HIGH] = AMBIENT;
    const env = isolatedStoreChildEnv(PINNED);
    expect(env[HIGH]).toBe(PINNED);
    expect(env[LOW]).toBe(PINNED);
  });

  test("no other store-selecting name survives into the child", () => {
    for (const key of STORE_SELECTING_KEYS) process.env[key] = "ambient-junk";
    const env = isolatedStoreChildEnv(PINNED);
    for (const key of STORE_SELECTING_KEYS) {
      const expected: string | undefined = key === HIGH || key === LOW ? PINNED : undefined;
      expect({ key, value: env[key] as string | undefined }).toEqual({ key, value: expected });
    }
  });

  test("unrelated ambient variables are still forwarded", () => {
    // A child that loses PATH cannot run. The helper filters, it does not reset.
    const env = isolatedStoreChildEnv(PINNED);
    expect(env.PATH).toBe(process.env.PATH as string);
  });

  test("extra variables are merged", () => {
    const env = isolatedStoreChildEnv(PINNED, { CONVERSATIONS_AGENT_ID: "probe" });
    expect(env.CONVERSATIONS_AGENT_ID).toBe("probe");
    expect(env[HIGH]).toBe(PINNED);
  });

  test("REFUSES an extra that would silently override the pin", () => {
    expect(() => isolatedStoreChildEnv(PINNED, { [LOW]: AMBIENT })).toThrow(/override the pin/);
    expect(() => isolatedStoreChildEnv(PINNED, { [HIGH]: AMBIENT })).toThrow(/override the pin/);
  });

  test("does not mutate the parent process env", () => {
    process.env[HIGH] = AMBIENT;
    isolatedStoreChildEnv(PINNED);
    expect(process.env[HIGH]).toBe(AMBIENT);
  });
});

describe("the async window a scoped wrapper cannot hold", () => {
  test("the pin survives an await, which is why this is a hook and not a wrapper", async () => {
    process.env[HIGH] = AMBIENT;
    pinStoreToDb(PINNED);
    await new Promise((resolve) => setTimeout(resolve, 1));
    // A `try/finally` wrapper handed an async body restores here — before this
    // line runs — and getDbPath() would read AMBIENT again.
    expect(getDbPath()).toBe(PINNED);
    restoreStoreEnv();
    expect(process.env[HIGH]).toBe(AMBIENT);
  });
});
