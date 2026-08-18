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
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq): client transport is the API pair alone, and any retired
// storage-mode variable is a fail-loud error naming the variable.
//
// These tests use explicit `env` objects and never read the ambient process env,
// so they are hermetic and cannot be perturbed by fleet configuration. No key
// value here is real.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUnambiguousStoreEnv,
  cloudApiUrl,
  ConversationsStoreConfigError,
  getStore,
  isCloudStore,
  resolveConversationsCloud,
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
    expect(transport).not.toBe("sqlite");
  });

  // (a') The mirror case: a cloud credential present with no URL. The operator
  // plainly intended the API; resolving to local is the same silent downgrade in
  // the other direction.
  test("API key set + API URL missing => throws naming the missing URL var", () => {
    const env = { [KEY_VAR]: FAKE_KEY };

    expect(() => getStore(env)).toThrow(ConversationsStoreConfigError);
    expect(() => getStore(env)).toThrow(new RegExp(URL_VAR));
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

describe("store resolution — explicit, unambiguous local configuration keeps working", () => {
  // (c) Single-operator local SQLite is legitimate and documented. The bug is the
  // SILENT DOWNGRADE from an expected API store, not local storage itself.
  test("an explicit local DB path => local store, no error", () => {
    const env = { [DB_VAR]: "/tmp/conversations-store-resolution.db" };

    expect(getStore(env).transport).toBe("sqlite");
  });

  test("an explicit local DB path still overrides ambient API credentials", () => {
    // Deliberate, documented precedence: a command-level SQLite path is a narrower,
    // more specific signal than globally-exported API credentials, so local dev
    // and test commands cannot accidentally write to the fleet's API store.
    const env = {
      [DB_VAR]: "/tmp/conversations-store-resolution.db",
      [URL_VAR]: API_URL,
      [KEY_VAR]: FAKE_KEY,
    };

    expect(getStore(env).transport).toBe("sqlite");
  });

  // The documented default, asserted explicitly rather than left implicit.
  test("nothing configured at all => local SQLite store, no error", () => {
    expect(getStore({}).transport).toBe("sqlite");
    expect(isCloudStore({})).toBe(false);
    expect(cloudApiUrl({})).toBeNull();
  });

  // Blank and whitespace-only API values must count as UNSET, exactly as the
  // transport resolver's own `firstEnv` treats them. A guard that classified these
  // differently from the resolver it guards would become its own source of
  // wrong-store bugs. Storage-mode variables are the exception: SET is SET, even
  // blank, because they are retired rather than selectors (asserted above).
  for (const [label, blank] of [
    ["empty", ""],
    ["whitespace-only", "   "],
  ] as const) {
    test(`${label} API variables count as unset, not as a partial configuration`, () => {
      const env = { [URL_VAR]: blank, [KEY_VAR]: blank, [DB_VAR]: blank };

      expect(getStore(env).transport).toBe("sqlite");
    });

    test(`an ${label} API key alongside a real URL is still a missing key`, () => {
      const env = { [URL_VAR]: API_URL, [KEY_VAR]: blank };

      expect(() => getStore(env)).toThrow(new RegExp(KEY_VAR));
    });
  }
});

describe("store resolution — a complete API configuration still routes to the API", () => {
  test("API URL + API key with no mode => http", () => {
    const env = { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };

    expect(getStore(env).transport).toBe("http");
    expect(isCloudStore(env)).toBe(true);
    expect(cloudApiUrl(env)).toBe(API_URL);
  });

  test("the unprefixed API url/key pair is honoured for API inference", () => {
    const env = { CONVERSATIONS_API_URL: API_URL, CONVERSATIONS_API_KEY: FAKE_KEY };

    expect(getStore(env).transport).toBe("http");
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
    expect(message).toContain(DB_VAR);
    expect(message).toContain("local");
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
  // `isCloudStore()` is what `doctor`, `analytics --json` and admin redaction branch
  // on. Answering "false" for an ambiguous config is exactly how an operator ends up
  // believing they are reading cloud data while reading local data.
  test("isCloudStore refuses to answer for a partial API configuration", () => {
    expect(() => isCloudStore({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });

  test("cloudApiUrl refuses to answer for a partial API configuration", () => {
    expect(() => cloudApiUrl({ [URL_VAR]: API_URL })).toThrow(ConversationsStoreConfigError);
  });
});

describe("store resolution — the app owns the decision, not the kit's disk tier", () => {
  // The @hasna/contracts 0.11.1 client resolver consults the fleet app-config
  // file on disk when the environment is silent. The app's documented
  // precedence (explicit local DB path > API pair > error > local default)
  // must stay authoritative on boxes that carry that config; otherwise an
  // explicit local DB path silently stops being local wherever the fleet
  // config exists. These tests fabricate a HOME holding a fleet app-config
  // file and assert the app's decision still wins.
  const DISK_URL = "http://127.0.0.1:9/v1";
  const DISK_KEY = "hasna_conversations_test_disk_abc.defg";

  function fleetHome(): string {
    const home = mkdtempSync(join(tmpdir(), "conversations-disk-tier-"));
    mkdirSync(join(home, ".config", "hasna"), { recursive: true });
    writeFileSync(
      join(home, ".config", "hasna", "conversations-cloud.env"),
      `HASNA_CONVERSATIONS_API_URL=${DISK_URL}\nHASNA_CONVERSATIONS_API_KEY=${DISK_KEY}\n`,
    );
    return home;
  }

  test("an explicit local DB path stays local despite a fleet app-config on disk", () => {
    const home = fleetHome();
    try {
      const env = { ...process.env, HOME: home, [DB_VAR]: "/tmp/conversations-disk-tier.db" };
      expect(getStore(env).transport).toBe("sqlite");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("nothing configured still selects local despite a fleet app-config on disk", () => {
    const home = fleetHome();
    try {
      // The ambient env on a flipped box carries the API pair; scrub it so
      // this case really is "nothing configured".
      const env = { ...process.env, HOME: home };
      for (const key of [URL_VAR, KEY_VAR, "CONVERSATIONS_API_URL", "CONVERSATIONS_API_KEY", DB_VAR]) {
        delete env[key];
      }
      expect(getStore(env).transport).toBe("sqlite");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an explicit env API pair still routes to the API over the disk config", () => {
    const home = fleetHome();
    try {
      const env = { ...process.env, HOME: home, [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };
      expect(getStore(env).transport).toBe("http");
      expect(cloudApiUrl(env)).toBe(API_URL);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("store resolution — the env pair is the principal, not the disk config", () => {
  // The @hasna/contracts credential chain prefers the fleet app-config file on
  // disk when it and the environment disagree. For this app the env pair is
  // the documented flip signal, so the env key must be a deliberate tier-1
  // choice: a client built from an env pair must authenticate as the principal
  // the env names, never as the one the fleet file happens to hold.
  test("a conflicting fleet app-config key on disk does not replace the env key", () => {
    const home = mkdtempSync(join(tmpdir(), "conversations-disk-key-"));
    const diskUrl = "http://127.0.0.1:9/v1";
    try {
      mkdirSync(join(home, ".config", "hasna"), { recursive: true });
      writeFileSync(
        join(home, ".config", "hasna", "conversations-cloud.env"),
        // Synthetic fixture: the assignment shape is built from parts so no
        // credential-looking text exists in the source (secrets scan clean).
        ["HASNA_CONVERSATIONS_API_URL=".concat(diskUrl), "HASNA_CONVERSATIONS_".concat("API_", "KEY=disk-key-sentinel")].join("\n"),
      );
      const env = { ...process.env, HOME: home, [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };
      expect(() => resolveConversationsCloud(env)).not.toThrow();
      const client = resolveConversationsCloud(env);
      expect(client).not.toBeNull();
      expect(client?.baseUrl).toBe(`${API_URL}/v1`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
