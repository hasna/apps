import { describe, expect, test } from "bun:test";
import { resolveSessionStore } from "./session-store.js";

// -- Client-flip env contract -------------------------------------------------
//
// The @hasna/contracts client transport selects the hosted transport from the
// API URL + API key pair alone. The deployment-mode vocabulary was removed
// (owner directive 2026-07-29): no *_MODE variable is read, and the resolver
// fails closed when exactly one of the pair is set rather than silently
// reading the wrong dataset.

describe("session store client flip", () => {
  const URL_VAR = "HASNA_SESSIONS_API_URL";
  const KEY_VAR = "HASNA_SESSIONS_API_KEY";
  const API_URL = "https://sessions.hasna.xyz";
  /** Not a credential: a deliberately invalid stub. */
  const FAKE_KEY = ["sessions", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

  test("resolves the hosted store when the API url and key pair is set", () => {
    const store = resolveSessionStore(
      { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY },
      { fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch },
    );

    expect(store).toBeDefined();
    expect(typeof store.list).toBe("function");
  });

  test("resolves the local store when nothing is configured", () => {
    expect(resolveSessionStore({}).mode).toBe("local");
  });

  test("ignores the retired mode variables — a mode-only env resolves local", () => {
    // HASNA_SESSIONS_MODE / HASNA_SESSIONS_STORAGE_MODE are retired deployment-mode
    // vocabulary (owner directive 2026-07-29). The contracts client no longer
    // reads them, so a mode-only env is a local env — no throw, no cloud flip.
    expect(resolveSessionStore({ HASNA_SESSIONS_MODE: "self_hosted" }).mode).toBe("local");
    expect(resolveSessionStore({ HASNA_SESSIONS_STORAGE_MODE: "cloud" }).mode).toBe("local");
  });

  test("fails closed on a url-without-key half-pair, local on key-only", () => {
    // A URL that cannot be authenticated is a misconfiguration: the contracts
    // client throws rather than silently reading the local dataset. A key with
    // no URL selects nothing and stays local.
    expect(() => resolveSessionStore({ [URL_VAR]: API_URL })).toThrow();
    expect(resolveSessionStore({ [KEY_VAR]: FAKE_KEY }).mode).toBe("local");
  });
});
