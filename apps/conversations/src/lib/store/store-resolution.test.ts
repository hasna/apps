// Regression tests for store resolution: an API store that cannot be built must
// FAIL LOUDLY, never silently downgrade to the on-box SQLite store.
//
// The bug these lock down (measured on station01, 2026-07-30, @hasna/conversations
// 0.5.9): with HASNA_CONVERSATIONS_API_URL set but HASNA_CONVERSATIONS_API_KEY
// absent, `getStore()` returned a LocalStore over ~/.hasna/conversations/*.db and
// served a DIFFERENT dataset — 608 channels instead of 844, newest message from
// 2026-07-18 instead of today — with no error and no flag. An agent reading that
// concludes the messages were never sent. This is the same failure that got MCPs
// banned on this fleet (see ~/.claude/rules/no-mcps.md: an `emails` MCP returning
// `{"email": null}` for a mailbox holding 170,609 messages).
//
// Client transport is the API pair alone (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq).
//
// These tests use explicit `env` objects and never read the ambient process env,
// so they are hermetic and cannot be perturbed by fleet configuration. No key
// value here is real.

import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUnambiguousStoreEnv,
  cloudApiUrl,
  ConversationsStoreConfigError,
  getStore,
  LocalStore,
  isCloudStore,
} from "./index.js";

const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const DB_VAR = "HASNA_CONVERSATIONS_DB_PATH";

const API_URL = "https://conversations.hasna.xyz";
/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

describe("store resolution — API expected but unbuildable must ERROR, not fall back", () => {
  // (a) THE P0. API URL configured, key missing. Before the fix this returned a
  // LocalStore holding a different dataset, silently.
  test("API URL set + API key missing => throws naming the missing key var", () => {
    const env = { [URL_VAR]: API_URL };

    expect(() => getStore(env)).toThrow(ConversationsStoreConfigError);
    expect(() => getStore(env)).toThrow(new RegExp(KEY_VAR));

    // The precise regression: it must NOT hand back a local store.
    let transport: string | null = null;
    try {
      transport = getStore(env).transport;
    } catch {
      /* expected */
    }
    expect(transport).not.toBe("local");
  });

  // (a') The mirror case: a cloud credential present with no URL. The operator
  // plainly intended the API. Under the shared chain this is now a COMPLETE
  // hosted configuration — a key from any tier reaches the fleet through the
  // gateway default https://api.hasna.com/conversations (owner directive
  // 2026-09-04, hasna/apps#1720) — so it resolves hosted, never to local.
  test("API key set + API URL missing => resolves hosted via the fleet gateway", () => {
    const env = { [KEY_VAR]: FAKE_KEY };

    const store = getStore(env);
    expect(store.transport).toBe("cloud-http");
    expect(cloudApiUrl(env)).toBe("https://api.hasna.com/conversations");
  });

  // (b) A cloud URL that cannot be parsed is not a reason to read local data.
  test("unparseable URL is rejected even when cloud was inferred from url+key", () => {
    const env = { [URL_VAR]: "not a url", [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
  });

  test("a non-http API URL is rejected, matching what the transport can actually use", () => {
    const env = { [URL_VAR]: "ftp://conversations.hasna.xyz", [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
    expect(() => getStore(env)).toThrow(/http/);
  });
});

describe("store resolution — retired client selectors refuse", () => {
  // Retired client selectors never construct the explicit compatibility store.
  test("an explicit local DB path refuses before storage is opened", () => {
    const env = { [DB_VAR]: "/tmp/conversations-store-resolution.db" };

    expect(() => getStore(env)).toThrow(/no longer supported/);
  });

  test("an explicit local DB path refuses even beside API credentials", () => {
    // Contradictory DB/API configuration fails before either transport is used.
    const env = {
      [DB_VAR]: "/tmp/conversations-store-resolution.db",
      [URL_VAR]: API_URL,
      [KEY_VAR]: FAKE_KEY,
    };

    expect(() => getStore(env)).toThrow(/no longer supported/);
  });

  // Missing account configuration never silently opens a local dataset.
  test("nothing configured at all => refuses, naming both required env vars", () => {
    expect(() => getStore({})).toThrow(ConversationsStoreConfigError);
    // Actionable: the error names BOTH variables the operator must set...
    expect(() => getStore({})).toThrow(new RegExp(URL_VAR));
    expect(() => getStore({})).toThrow(new RegExp(KEY_VAR));
    // Missing credentials never suggest a retired local selector.
    try { getStore({}); } catch (error) { expect((error as Error).message).not.toContain(DB_VAR); }

    // The precise regression: an empty env must not hand back a local store.
    let transport: string | null = null;
    try {
      transport = getStore({}).transport;
    } catch {
      /* expected */
    }
    expect(transport).not.toBe("local");

    // The reporting helpers refuse too: "false" (local) must not be answerable
    // from a configuration that merely forgot the API env.
    expect(() => isCloudStore({})).toThrow(ConversationsStoreConfigError);
    expect(() => cloudApiUrl({})).toThrow(ConversationsStoreConfigError);
  });

  test("nothing configured never creates the default local database", () => {
    // Fail-closed means no side effect either: the refusal happens in the
    // resolver, before any data root is resolved or mkdir'd, so a sandboxed
    // HOME must end the call with no ~/.hasna/conversations tree at all.
    const sandboxHome = join(tmpdir(), `conversations-nothing-configured-${Date.now()}`);
    try {
      const env = { HOME: sandboxHome };
      expect(() => getStore(env)).toThrow(ConversationsStoreConfigError);
      expect(existsSync(join(sandboxHome, ".hasna", "conversations"))).toBe(false);
      expect(existsSync(join(sandboxHome, ".hasna", "conversations", "messages.db"))).toBe(false);
    } finally {
      rmSync(sandboxHome, { recursive: true, force: true });
    }
  });

  // Blank and whitespace-only API values must count as UNSET, exactly as the
  // transport resolver's own `firstEnv` treats them. A guard that classified these
  // differently from the resolver it guards would become its own source of
  // wrong-store bugs. All-blank now means nothing configured, which refuses.
  for (const [label, blank] of [
    ["empty", ""],
    ["whitespace-only", "   "],
  ] as const) {
    test(`${label} API variables count as unset -> nothing configured refuses`, () => {
      const env = { [URL_VAR]: blank, [KEY_VAR]: blank, [DB_VAR]: blank };

      expect(() => getStore(env)).toThrow(ConversationsStoreConfigError);
      expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
    });

    test(`${label} API variables do not mask an explicit local DB path`, () => {
      const env = { [URL_VAR]: blank, [KEY_VAR]: blank, [DB_VAR]: "/tmp/conversations-store-resolution.db" };

      expect(() => getStore(env)).toThrow(/no longer supported/);
    });

    test(`an ${label} API key alongside a real URL is still a missing key`, () => {
      const env = { [URL_VAR]: API_URL, [KEY_VAR]: blank };

      expect(() => getStore(env)).toThrow(new RegExp(KEY_VAR));
    });
  }
});

describe("store resolution — a complete API configuration still routes to the API", () => {
  test("API URL + API key => cloud-http", () => {
    const env = { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };

    expect(getStore(env).transport).toBe("cloud-http");
    expect(isCloudStore(env)).toBe(true);
    expect(cloudApiUrl(env)).toBe(API_URL);
  });

  test("the unprefixed API url/key pair is honoured for API inference", () => {
    const env = { CONVERSATIONS_API_URL: API_URL, CONVERSATIONS_API_KEY: FAKE_KEY };

    expect(getStore(env).transport).toBe("cloud-http");
  });

  test("an unprefixed API url without any key throws rather than falling back", () => {
    expect(() => getStore({ CONVERSATIONS_API_URL: API_URL })).toThrow(
      ConversationsStoreConfigError,
    );
  });
});

describe("store resolution — errors are actionable and leak nothing", () => {
  test("the error never contains the API key value", () => {
    // A key-only environment no longer errors (the gateway default applies), so
    // the leak property is asserted on an environment that DOES fail while a
    // key value is present: an unparseable URL with the key set.
    const env = { [URL_VAR]: "not a url", [KEY_VAR]: FAKE_KEY };

    let message = "";
    try {
      getStore(env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(FAKE_KEY);
  });

  test("the error recommends shared credentials without a local escape hatch", () => {
    let message = "";
    try {
      getStore({ [URL_VAR]: API_URL });
    } catch (error) {
      message = (error as Error).message;
    }

    // Name the missing piece...
    expect(message).toContain(KEY_VAR);
    // No unsupported database selector is recommended.
    expect(message).not.toContain(DB_VAR);
    expect(message).toContain("saved account credentials");
  });

  test("the error does not claim it fell back to the local store", () => {
    let message = "";
    try {
      getStore({ [URL_VAR]: API_URL });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toMatch(/using local store/i);
  });
});

describe("store resolution — the ambiguity guard also protects the reporting helpers", () => {
  // `isCloudStore()` is what `status`/`doctor`/`analytics --json` branch on.
  // Answering "false" for an ambiguous config is exactly how an operator ends up
  // believing they are reading cloud data while reading local data.
  test("isCloudStore refuses to answer for a partial API configuration", () => {
    expect(() => isCloudStore({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });

  test("cloudApiUrl refuses to answer for a partial API configuration", () => {
    expect(() => cloudApiUrl({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });
});

// Explicit library construction is separate from ordinary client selection.
test("LocalStore remains a deliberate library handle", () => {
  expect(new LocalStore().transport).toBe("local");
  expect(() => getStore({ [DB_VAR]: "/tmp/retired-selector.db" })).toThrow(/no longer supported/);
});
