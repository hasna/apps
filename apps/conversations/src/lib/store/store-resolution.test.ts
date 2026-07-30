// Regression tests for store resolution: a cloud store that cannot be built must
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
// These tests use explicit `env` objects and never read the ambient process env,
// so they are hermetic and cannot be perturbed by fleet configuration. No key
// value here is real.

import { describe, expect, test } from "bun:test";
import {
  assertUnambiguousStoreEnv,
  cloudApiUrl,
  ConversationsStoreConfigError,
  getStore,
  isCloudStore,
} from "./index.js";

const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const MODE_VAR = "HASNA_CONVERSATIONS_STORAGE_MODE";
const DB_VAR = "HASNA_CONVERSATIONS_DB_PATH";

const API_URL = "https://conversations.hasna.xyz";
/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

describe("store resolution — cloud expected but unbuildable must ERROR, not fall back", () => {
  // (a) THE P0. API URL configured, key missing, no explicit mode. Before the fix
  // this returned a LocalStore holding a different dataset, silently.
  test("API URL set + API key missing + no mode => throws naming the missing key var", () => {
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

  // (a') The mirror case: a cloud credential present with no URL and no mode. The
  // operator plainly intended cloud; resolving to local is the same silent
  // downgrade in the other direction.
  test("API key set + API URL missing + no mode => throws naming the missing URL var", () => {
    const env = { [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(ConversationsStoreConfigError);
    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
  });

  // (b) Pre-existing correct behaviour. `createClientTransport` already threw here
  // via `misconfigured`. Locking it in so the fix cannot regress it.
  test("mode pinned cloud + API key missing => throws naming the missing key var", () => {
    const env = { [MODE_VAR]: "cloud", [URL_VAR]: API_URL };

    expect(() => getStore(env)).toThrow(new RegExp(KEY_VAR));
  });

  test("mode pinned cloud + nothing else => throws naming the missing key var", () => {
    expect(() => getStore({ [MODE_VAR]: "cloud" })).toThrow(new RegExp(KEY_VAR));
  });

  // (b') A cloud URL that cannot be parsed is not a reason to read local data.
  test("mode pinned cloud + key present + unparseable URL => throws naming the URL var", () => {
    const env = { [MODE_VAR]: "cloud", [URL_VAR]: "not a url", [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
  });

  test("unparseable URL is rejected even when cloud was inferred from url+key", () => {
    const env = { [URL_VAR]: "not a url", [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
  });

  test("a non-http cloud URL is rejected, matching what the transport can actually use", () => {
    const env = { [MODE_VAR]: "cloud", [URL_VAR]: "ftp://conversations.hasna.xyz", [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
    expect(() => getStore(env)).toThrow(/http/);
  });

  test("an unknown storage mode throws naming the variable and the legal values", () => {
    const env = { [MODE_VAR]: "hybird" };

    expect(() => getStore(env)).toThrow(new RegExp(MODE_VAR));
    expect(() => getStore(env)).toThrow(/local/);
    expect(() => getStore(env)).toThrow(/cloud/);
  });
});

describe("store resolution — explicit, unambiguous local configuration keeps working", () => {
  // (c) Single-operator local SQLite is legitimate and documented. The bug is the
  // SILENT DOWNGRADE from an expected cloud store, not local storage itself.
  test("mode pinned local => local store, no error, even with cloud credentials present", () => {
    const env = { [MODE_VAR]: "local", [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };

    expect(getStore(env).transport).toBe("local");
    expect(isCloudStore(env)).toBe(false);
    expect(cloudApiUrl(env)).toBeNull();
  });

  test("an explicit local DB path => local store, no error", () => {
    const env = { [DB_VAR]: "/tmp/conversations-store-resolution.db" };

    expect(getStore(env).transport).toBe("local");
  });

  test("an explicit local DB path still overrides ambient cloud credentials", () => {
    // Deliberate, documented precedence: a command-level SQLite path is a narrower,
    // more specific signal than globally-exported cloud credentials, so local dev
    // and test commands cannot accidentally write to the fleet's cloud store.
    const env = {
      [DB_VAR]: "/tmp/conversations-store-resolution.db",
      [MODE_VAR]: "cloud",
      [URL_VAR]: API_URL,
      [KEY_VAR]: FAKE_KEY,
    };

    expect(getStore(env).transport).toBe("local");
  });

  // (d) The documented default, asserted explicitly rather than left implicit.
  test("nothing configured at all => local SQLite store, no error", () => {
    expect(getStore({}).transport).toBe("local");
    expect(isCloudStore({})).toBe(false);
    expect(cloudApiUrl({})).toBeNull();
  });

  // Blank and whitespace-only values must count as UNSET, exactly as the transport
  // resolver's own `firstEnv` treats them. A guard that classified these differently
  // from the resolver it guards would become its own source of wrong-store bugs —
  // e.g. refusing to start for an exported-but-empty variable the resolver ignores.
  for (const [label, blank] of [
    ["empty", ""],
    ["whitespace-only", "   "],
  ] as const) {
    test(`${label} store variables count as unset, not as a partial configuration`, () => {
      const env = { [URL_VAR]: blank, [KEY_VAR]: blank, [MODE_VAR]: blank, [DB_VAR]: blank };

      expect(getStore(env).transport).toBe("local");
    });

    test(`an ${label} API key alongside a real URL is still a missing key`, () => {
      const env = { [URL_VAR]: API_URL, [KEY_VAR]: blank };

      expect(() => getStore(env)).toThrow(new RegExp(KEY_VAR));
    });
  }
});

describe("store resolution — a complete cloud configuration still routes to cloud", () => {
  test("API URL + API key with no mode => cloud-http", () => {
    const env = { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };

    expect(getStore(env).transport).toBe("cloud-http");
    expect(isCloudStore(env)).toBe(true);
    expect(cloudApiUrl(env)).toBe(API_URL);
  });

  test("mode pinned cloud + API key => cloud-http on the default host without an explicit URL", () => {
    const env = { [MODE_VAR]: "cloud", [KEY_VAR]: FAKE_KEY };

    expect(getStore(env).transport).toBe("cloud-http");
    expect(isCloudStore(env)).toBe(true);
  });
});

describe("store resolution — every documented mode variable is honoured", () => {
  // Second defect found while fixing the P0: `conversationsCloudEnv` hardcoded only
  // HASNA_CONVERSATIONS_STORAGE_MODE and HASNA_CONVERSATIONS_MODE, while the
  // transport resolver also honours the unprefixed CONVERSATIONS_STORAGE_MODE and
  // CONVERSATIONS_MODE. An operator pinning local through an unprefixed variable
  // was silently routed to cloud — the same class of bug, opposite direction.
  for (const modeKey of [
    "HASNA_CONVERSATIONS_STORAGE_MODE",
    "HASNA_CONVERSATIONS_MODE",
    "CONVERSATIONS_STORAGE_MODE",
    "CONVERSATIONS_MODE",
  ]) {
    test(`${modeKey}=local pins local even with cloud credentials present`, () => {
      const env = { [modeKey]: "local", [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };

      expect(getStore(env).transport).toBe("local");
    });

    test(`${modeKey}=cloud without a key throws rather than falling back`, () => {
      expect(() => getStore({ [modeKey]: "cloud" })).toThrow(new RegExp(KEY_VAR));
    });
  }

  test("the unprefixed API url/key pair is honoured for cloud inference", () => {
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
    const env = { [KEY_VAR]: FAKE_KEY };

    let message = "";
    try {
      getStore(env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(FAKE_KEY);
  });

  test("the error tells the operator how to resolve the ambiguity both ways", () => {
    let message = "";
    try {
      getStore({ [URL_VAR]: API_URL });
    } catch (error) {
      message = (error as Error).message;
    }

    // Name the missing piece...
    expect(message).toContain(KEY_VAR);
    // ...and the escape hatch for someone who genuinely wants local.
    expect(message).toContain(MODE_VAR);
    expect(message).toContain("local");
  });

  test("the error does not claim it fell back to the local store", () => {
    let message = "";
    try {
      getStore({ [MODE_VAR]: "cloud" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toMatch(/using local store/i);
  });

  test("assertUnambiguousStoreEnv is the reusable guard and agrees with getStore", () => {
    expect(() => assertUnambiguousStoreEnv({ [URL_VAR]: API_URL })).toThrow(
      ConversationsStoreConfigError,
    );
    expect(() => assertUnambiguousStoreEnv({})).not.toThrow();
    expect(() => assertUnambiguousStoreEnv({ [MODE_VAR]: "local" })).not.toThrow();
    expect(() =>
      assertUnambiguousStoreEnv({ [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY }),
    ).not.toThrow();
  });
});

describe("store resolution — the ambiguity guard also protects the reporting helpers", () => {
  // `isCloudStore()` is what `doctor`, `analytics --json` and admin redaction branch
  // on. Answering "false" for an ambiguous config is exactly how an operator ends up
  // believing they are reading cloud data while reading local data.
  test("isCloudStore refuses to answer for a partial cloud configuration", () => {
    expect(() => isCloudStore({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });

  test("cloudApiUrl refuses to answer for a partial cloud configuration", () => {
    expect(() => cloudApiUrl({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });
});
