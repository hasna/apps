// The store-location fragment that `conversations status`, `conversations
// status --json` and the server's `/api/status` body all emit (todos 274ee464).
//
// Every value here is INVENTED and every env is passed as a parameter, so these
// cases are hermetic and cannot be perturbed by fleet configuration. No key
// value below is real.

import { describe, expect, test } from "bun:test";
import { storeStatusLocation } from "./status-location.js";

const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const MODE_VAR = "HASNA_CONVERSATIONS_STORAGE_MODE";
const DB_VAR = "HASNA_CONVERSATIONS_DB_PATH";

/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

const RAW =
  "https://SYNTHUSER:SYNTHPASS@conv.example.invalid:8443/SYNTHPATH?q=SYNTHQUERY#access_token=SYNTHFRAGMENT";
const MARKERS = ["SYNTHUSER", "SYNTHPASS", "SYNTHPATH", "SYNTHQUERY", "SYNTHFRAGMENT"];

describe("storeStatusLocation", () => {
  test("status payloads expose connection location without deployment-mode keys or values", () => {
    const local = storeStatusLocation({ [DB_VAR]: "/tmp/conversations-status-contract.db" });
    const hosted = storeStatusLocation({ [URL_VAR]: RAW, [KEY_VAR]: FAKE_KEY });

    for (const location of [local, hosted]) {
      expect(Object.keys(location)).not.toContain("mode");
      expect(Object.keys(location)).not.toContain("deploymentMode");
      expect(Object.keys(location)).not.toContain("deploymentModes");
      expect(JSON.stringify(location)).not.toMatch(/"(?:self_hosted|remote|hybrid)"/);
    }

    expect("db_path" in local).toBe(true);
    expect("api_url" in local).toBe(false);
    expect("api_url" in hosted).toBe(true);
    expect("db_path" in hosted).toBe(false);
  });

  // This is the exact value that reached three output surfaces before the fix:
  // `printLine` in the human status, `printJson` in `status --json`, and the
  // JSON body of the server's `/api/status` route.
  test("the hosted-store announcement carries no credential-bearing component", () => {
    // Positive control on the same predicate the assertion uses.
    expect(MARKERS.filter((m) => RAW.includes(m))).toEqual(MARKERS);

    const location = storeStatusLocation({ [URL_VAR]: RAW, [KEY_VAR]: FAKE_KEY });

    const shown = ("api_url" in location ? location.api_url : null) ?? "";
    expect(MARKERS.filter((m) => shown.includes(m))).toEqual([]);
    expect(shown).toBe("https://conv.example.invalid:8443");
  });

  // Serialising the whole fragment, not just the field, because the leak is
  // about what reaches output and the payload is what is written.
  test("nothing survives serialisation of the whole fragment", () => {
    const serialised = JSON.stringify(storeStatusLocation({ [URL_VAR]: RAW, [KEY_VAR]: FAKE_KEY }));
    expect(MARKERS.filter((m) => serialised.includes(m))).toEqual([]);
    // The control proves the assertion above can fail: the same predicate over
    // the raw value finds every marker.
    expect(MARKERS.filter((m) => JSON.stringify({ api_url: RAW }).includes(m))).toEqual(MARKERS);
  });

  // Redaction narrows the VALUE. It must not blur WHICH field is present — that
  // split is what makes a silent downgrade to the on-box SQLite store visible in
  // a status response instead of having to be inferred from a channel count.
  test("it still says which store answered", () => {
    const probeDb = "/tmp/conversations-status-location-probe.db";
    const local = storeStatusLocation({ [DB_VAR]: probeDb });
    expect("db_path" in local).toBe(true);
    expect("api_url" in local).toBe(false);
    // Asserting the injected path comes back, not merely that the field exists.
    // Until `getDbPath` took an env, this injection was inert — it reached
    // nothing, and a test that asserted only presence could not have noticed.
    expect("db_path" in local ? local.db_path : null).toBe(probeDb);

    const cloud = storeStatusLocation({ [URL_VAR]: RAW, [KEY_VAR]: FAKE_KEY });
    expect("api_url" in cloud).toBe(true);
    expect("db_path" in cloud).toBe(false);
  });

  test("a pinned local selector reports the SQLite connection even with API credentials present", () => {
    const local = storeStatusLocation({ [MODE_VAR]: "local", [URL_VAR]: RAW, [KEY_VAR]: FAKE_KEY });
    expect("db_path" in local).toBe(true);
    expect("api_url" in local).toBe(false);
    expect(MARKERS.filter((m) => JSON.stringify(local).includes(m))).toEqual([]);
  });

  // A cloud mode pinned by name, with a key and no URL, is the documented
  // default-host case: the transport supplies the host. It must read as "set but
  // unnamed" so the CLI's `(set)` fallback fires, rather than as a parse failure
  // — which is why `loggableUrl` distinguishes null from its sentinel.
  test("a hosted store on the default host announces null, not a sentinel", () => {
    const location = storeStatusLocation({ [MODE_VAR]: "cloud", [KEY_VAR]: FAKE_KEY });
    expect("api_url" in location ? location.api_url : "missing").toBeNull();
  });

  // A key with NO url and NO mode is refused rather than downgraded, and the
  // refusal is a message an operator reads. Asserted here because this is the
  // one status-adjacent path that emits text about the configuration: it must
  // name env-var KEYS and never a value.
  test("the refusal for a half-configured store names keys, never values", () => {
    expect(() => storeStatusLocation({ [KEY_VAR]: FAKE_KEY })).toThrow(/HASNA_CONVERSATIONS_API_URL/);
    try {
      storeStatusLocation({ [KEY_VAR]: FAKE_KEY });
    } catch (e) {
      expect((e as Error).message).not.toContain(FAKE_KEY);
    }
  });

  test("nothing configured at all reports the SQLite connection", () => {
    const location = storeStatusLocation({});
    expect("db_path" in location).toBe(true);
    expect("api_url" in location).toBe(false);
  });
});
