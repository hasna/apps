// The store-location fragment that `conversations status`, `conversations
// status --json` and the server's `/api/status` body all emit (todos 274ee464).
//
// Every value here is INVENTED and every env is passed as a parameter, so these
// cases are hermetic and cannot be perturbed by fleet configuration. No key
// value below is real.
//
// URL POLICING MOVED UPSTREAM (2026-09-04 adoption, hasna/apps#1720). The
// shared @hasna/contracts resolver REFUSES an API URL that carries credentials,
// a query string, or a fragment — a credential-bearing URL is never used, so
// the status surface's redaction of such a URL is no longer the boundary: the
// refusal is. The cases that used to assert redaction of a marker-bearing URL
// now assert the refusal, which is the stronger property (nothing reaches
// output at all), while scheme/host/port redaction still applies to the URLs
// the resolver accepts.

import { describe, expect, test } from "bun:test";
import { storeStatusLocation } from "./status-location.js";

const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const DB_VAR = "HASNA_CONVERSATIONS_DB_PATH";

/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

/** A self-hosted origin the resolver ACCEPTS (no userinfo, query, or fragment). */
const SELF_HOSTED =
  "https://conv.example.invalid:8443";

/** A URL the resolver REFUSES: userinfo, a path, a query, and a fragment. */
const MARKER_BEARING_URL =
  "https://SYNTHUSER:SYNTHPASS@conv.example.invalid:8443/SYNTHPATH?q=SYNTHQUERY#access_token=SYNTHFRAGMENT";
const MARKERS = ["SYNTHUSER", "SYNTHPASS", "SYNTHPATH", "SYNTHQUERY", "SYNTHFRAGMENT"];

describe("storeStatusLocation", () => {
  test("status payloads expose exactly the connection-location field, never both", () => {
    const local = storeStatusLocation({ [DB_VAR]: "/tmp/conversations-status-contract.db" });
    const hosted = storeStatusLocation({ [URL_VAR]: SELF_HOSTED, [KEY_VAR]: FAKE_KEY });

    // The exact key sets ARE the contract: one connection field, never both,
    // and no other selector fields can ride along in the payload.
    expect(Object.keys(local).sort()).toEqual(["db_path"]);
    expect(Object.keys(hosted).sort()).toEqual(["api_url"]);
  });

  // This is the exact value that reached three output surfaces before the fix:
  // `printLine` in the human status, `printJson` in `status --json`, and the
  // JSON body of the server's `/api/status` route.
  test("a credential-bearing URL is REFUSED at the resolver, so no marker reaches output", () => {
    // Positive control on the same predicate the assertion uses.
    expect(MARKERS.filter((m) => MARKER_BEARING_URL.includes(m))).toEqual(MARKERS);

    // The shared resolver refuses a URL carrying userinfo, a query, or a
    // fragment, and the refusal is a loud throw — the marker-bearing value
    // never reaches any status payload (there is no payload to leak into).
    expect(() => storeStatusLocation({ [URL_VAR]: MARKER_BEARING_URL, [KEY_VAR]: FAKE_KEY })).toThrow();

    // The refusal message names the offending KEY, never the value.
    try {
      storeStatusLocation({ [URL_VAR]: MARKER_BEARING_URL, [KEY_VAR]: FAKE_KEY });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(URL_VAR);
      expect(MARKERS.filter((m) => message.includes(m))).toEqual([]);
      expect(message).not.toContain(FAKE_KEY);
    }
  });

  // Serialising the whole fragment, not just the field, because the leak is
  // about what reaches output and the payload is what is written.
  test("nothing survives serialisation of the whole fragment", () => {
    // The resolver refusal fires before any payload is built: there is nothing
    // to serialise. The control proves the marker-bearing value really would
    // leak if it were ever serialised.
    expect(MARKERS.filter((m) => JSON.stringify({ api_url: MARKER_BEARING_URL }).includes(m))).toEqual(MARKERS);

    // The refused call throws; what carries on to an output surface is refused
    // in its entirety, never redacted-in-place.
    let threw = false;
    try {
      JSON.stringify(storeStatusLocation({ [URL_VAR]: MARKER_BEARING_URL, [KEY_VAR]: FAKE_KEY }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
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

    const cloud = storeStatusLocation({ [URL_VAR]: SELF_HOSTED, [KEY_VAR]: FAKE_KEY });
    expect("api_url" in cloud).toBe(true);
    expect("db_path" in cloud).toBe(false);
  });

  test("an explicit local DB path reports the SQLite connection even with API credentials present", () => {
    const local = storeStatusLocation({ [DB_VAR]: "/tmp/conversations-status-location-probe.db", [URL_VAR]: MARKER_BEARING_URL, [KEY_VAR]: FAKE_KEY });
    expect("db_path" in local).toBe(true);
    expect("api_url" in local).toBe(false);
    expect(MARKERS.filter((m) => JSON.stringify(local).includes(m))).toEqual([]);
  });

  // A URL with NO resolvable credential is refused rather than downgraded, and
  // the refusal is a message an operator reads. Asserted here because this is
  // the one status-adjacent path that emits text about the configuration: it
  // must name env-var KEYS and never a value.
  test("the refusal for a URL without a credential names keys, never values", () => {
    expect(() => storeStatusLocation({ [URL_VAR]: SELF_HOSTED })).toThrow(/HASNA_CONVERSATIONS_API_KEY/);
    try {
      storeStatusLocation({ [URL_VAR]: SELF_HOSTED });
    } catch (e) {
      expect((e as Error).message).not.toContain(FAKE_KEY);
    }
  });

  test("nothing configured at all refuses instead of reporting a SQLite connection", () => {
    // Fail-closed (2026-09-04): an env without the API pair and without an
    // explicit store path must not announce the on-box SQLite file — a status
    // that reported `db_path` here would read as "local connection" for a CLI
    // that merely forgot its API env.
    expect(() => storeStatusLocation({})).toThrow(/HASNA_CONVERSATIONS_API_URL/);
    expect(() => storeStatusLocation({})).toThrow(/HASNA_CONVERSATIONS_API_KEY/);
  });

  // The gateway form `https://api.hasna.com/conversations` announces the app
  // (and the /v1 root it resolves to), whereas every other URL is redacted to
  // scheme/host/port (issue #1588).
  test("the api.hasna.com gateway form is shown as its resolved /v1 root", () => {
    const location = storeStatusLocation({
      [URL_VAR]: "https://api.hasna.com/conversations",
      [KEY_VAR]: FAKE_KEY,
    });
    expect("api_url" in location ? location.api_url : null).toBe("https://api.hasna.com/conversations/v1");

    const resolved = storeStatusLocation({
      [URL_VAR]: "https://api.hasna.com/conversations/v1",
      [KEY_VAR]: FAKE_KEY,
    });
    expect("api_url" in resolved ? resolved.api_url : null).toBe("https://api.hasna.com/conversations/v1");
  });

  test("gateway URLs carrying credentials, a query, or a fragment are refused, never shown", () => {
    for (const raw of [
      "https://user:pass@api.hasna.com/conversations",
      "https://api.hasna.com/conversations?token=SYNTHQUERY",
      "https://api.hasna.com/conversations#access_token=SYNTHFRAGMENT",
    ]) {
      // Refusal is the property now: the shared resolver will not build a
      // client for such an authority, and the status surface reports the
      // refusal instead of displaying a sanitised version of a credential-
      // bearing value.
      expect(() => storeStatusLocation({ [URL_VAR]: raw, [KEY_VAR]: FAKE_KEY })).toThrow();
      try {
        storeStatusLocation({ [URL_VAR]: raw, [KEY_VAR]: FAKE_KEY });
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain("SYNTHQUERY");
        expect(message).not.toContain("SYNTHFRAGMENT");
        expect(message).not.toContain("user:pass");
      }
    }
  });

  test("legacy and self-hosted origins keep the scheme/host/port redaction", () => {
    const legacy = storeStatusLocation({ [URL_VAR]: "https://conversations.hasna.xyz", [KEY_VAR]: FAKE_KEY });
    expect("api_url" in legacy ? legacy.api_url : null).toBe("https://conversations.hasna.xyz");

    const selfHosted = storeStatusLocation({ [URL_VAR]: SELF_HOSTED, [KEY_VAR]: FAKE_KEY });
    expect("api_url" in selfHosted ? selfHosted.api_url : null).toBe("https://conv.example.invalid:8443");
  });
});