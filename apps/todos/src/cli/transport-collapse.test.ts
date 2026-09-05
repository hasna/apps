/**
 * Client transport resolution after the deployment-mode removal, the 2026-09-04
 * fail-closed ruling (hasna/apps#1613) and the @hasna/contracts credential
 * adoption (hasna/apps#1720): the OSS client seam has exactly TWO
 * implementations — a local SQLite file or the hosted HTTP `/v1` authority.
 *
 * These cases hand the resolver a CALLER-BUILT env dictionary, which is the
 * hermetic seam: the Keychain tier is ambient (it runs only for the live
 * `process.env`, or when a runner is injected) and the disk tier is anchored on
 * `HOME`, which these dictionaries do not set. So what is under test here is
 * exactly the env-tier behaviour plus the fleet-gateway default; the Keychain
 * and credentials-file tiers have their own suite in
 * `credential-resolution.test.ts`.
 *
 * Retired storage-mode variables are inert — never read, never a fallback.
 */
import { describe, expect, test } from "bun:test";
import { getTodosRemoteAuthorityConfigStatus, resolveTodosCliTransport } from "./cloud-router.js";
import { initializeTodosCliAuthority } from "./stage-a.js";

const HTTP_ENV = {
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

describe("client transport resolution (sqlite|http, no storage modes)", () => {
  test("neither URL nor KEY set FAILS CLOSED — never a silent sqlite default", () => {
    expect(() => resolveTodosCliTransport({})).toThrow("REMOTE_API_CONFIG_MISSING");
    expect(() => resolveTodosCliTransport({})).toThrow(/HASNA_TODOS_API_URL/);
    expect(() => resolveTodosCliTransport({})).toThrow(/HASNA_TODOS_API_KEY/);
    expect(() => resolveTodosCliTransport({})).toThrow(/HASNA_TODOS_LOCAL=1/);
  });

  test.each([
    "HASNA_TODOS_LOCAL",
    "TODOS_LOCAL",
  ])("the explicit local opt-in %s resolves the sqlite transport", (key) => {
    const resolution = resolveTodosCliTransport({ [key]: "1" });
    expect(resolution.transport).toBe("sqlite");
    expect(resolution.selected).toBe(false);
    expect(resolution.source).toBe("local-opt-in");
    // A BLANK opt-in is not an opt-in: the client still fails closed.
    expect(() => resolveTodosCliTransport({ [key]: "" })).toThrow("REMOTE_API_CONFIG_MISSING");
    // An alias left over in the env cannot rescue a blanked canonical opt-in…
    expect(() =>
      resolveTodosCliTransport({
        HASNA_TODOS_LOCAL: "",
        TODOS_LOCAL: "",
      }),
    ).toThrow("REMOTE_API_CONFIG_MISSING");
    // …but either spelling is honoured on its own.
    expect(
      resolveTodosCliTransport({
        HASNA_TODOS_LOCAL: "",
        TODOS_LOCAL: "1",
      }).transport,
    ).toBe("sqlite");
    expect(
      resolveTodosCliTransport({
        HASNA_TODOS_LOCAL: "1",
        TODOS_LOCAL: "",
      }).transport,
    ).toBe("sqlite");
  });

  test("URL + KEY both set selects the http transport", () => {
    const resolution = resolveTodosCliTransport(HTTP_ENV);
    expect(resolution.transport).toBe("http");
    expect(resolution.selected).toBe(true);
    // `source` now reports what the contracts resolver actually used — the
    // credential source then the authority source — so an operator reading a
    // status line can tell an env key from a Keychain item from a file path.
    expect(resolution.source).toBe("HASNA_TODOS_API_KEY+HASNA_TODOS_API_URL");
    expect(resolution.authority).toMatchObject({
      baseUrl: "https://todos.example.test/v1",
      apiKeyTier: "env",
      apiKeySource: "HASNA_TODOS_API_KEY",
      apiUrlSource: "HASNA_TODOS_API_URL",
    });
  });

  test("URL without KEY is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow("REMOTE_API_KEY_MISSING");
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow(/local SQLite is opt-in only/);
    // The diagnostic names every tier that was consulted, not just the env one,
    // so an operator is told WHERE to put the key rather than only that it is
    // missing.
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow(/hasna\.credentials\.todos\.api-key/);
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow(/~\/\.hasna\/todos\/config\/credentials/);
  });

  test("a KEY with no URL resolves the fleet gateway — a URL is no longer required", () => {
    // The 2026-09-04 ruling gave every hosted app a DEFAULT authority: a
    // credential is sufficient, and https://api.hasna.com/todos applies. The
    // old REMOTE_API_URL_MISSING arm for this shape is gone deliberately —
    // requiring the URL is what made every station carry a second variable
    // whose only correct value was the one the client could compose itself.
    const resolution = resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" });
    expect(resolution.transport).toBe("http");
    expect(resolution.authority).toMatchObject({
      baseUrl: "https://api.hasna.com/todos/v1",
      apiUrlSource: "default",
    });
  });

  test("a configured environment outranks the local opt-in, and a partial one still refuses", () => {
    // The opt-in answers "the environment configured nothing, and I want the
    // on-box store". It does not mean "ignore the authority I just configured":
    // a dangling URL names the missing credential rather than quietly degrading
    // to local SQLite, and a complete configuration routes to the authority.
    expect(() =>
      resolveTodosCliTransport({
        HASNA_TODOS_API_URL: "https://todos.example.test",
        HASNA_TODOS_LOCAL: "1",
      }),
    ).toThrow("REMOTE_API_KEY_MISSING");
    expect(
      resolveTodosCliTransport({ ...HTTP_ENV, TODOS_LOCAL: "1" }).transport,
    ).toBe("http");
    // A key alone is a complete configuration now, so it too outranks the opt-in.
    expect(
      resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key", TODOS_LOCAL: "1" }).transport,
    ).toBe("http");
  });

  test.each([
    "HASNA_TODOS_STORAGE_MODE",
    "HASNA_TODOS_MODE",
    "TODOS_STORAGE_MODE",
    "TODOS_MODE",
  ])("retired storage-mode variable %s is inert — the API pair still selects http", (key) => {
    const withPair = { ...HTTP_ENV, [key]: "remote" };
    const resolution = resolveTodosCliTransport(withPair);
    expect(resolution.transport).toBe("http");
    expect(resolution.selected).toBe(true);
    // A BLANK leftover is inert too — the resolver never reads it.
    expect(resolveTodosCliTransport({ ...HTTP_ENV, [key]: "" }).transport).toBe("http");
    // Alone, a stale variable selects nothing: no opt-in means fail closed…
    expect(() =>
      resolveTodosCliTransport({ [key]: "local", HASNA_TODOS_DB_PATH: "/tmp/x.db" }),
    ).toThrow("REMOTE_API_CONFIG_MISSING");
    // …and even with the opt-in it does not resurrect the retired selector.
    expect(
      resolveTodosCliTransport({
        [key]: "local",
        HASNA_TODOS_LOCAL: "1",
        HASNA_TODOS_DB_PATH: "/tmp/x.db",
      }).transport,
    ).toBe("sqlite");
  });

  test("authority status resolves from the API pair alone", () => {
    const status = getTodosRemoteAuthorityConfigStatus(HTTP_ENV);
    expect(status.selected).toBe(true);
    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://todos.example.test/v1");
    expect(status.local_fallback).toBe(false);
  });

  test("authority status reports the partial-pair refusal with the missing variable named", () => {
    const missingKey = getTodosRemoteAuthorityConfigStatus({ HASNA_TODOS_API_URL: "https://todos.example.test" });
    expect(missingKey.ok).toBe(false);
    expect(missingKey.issues.join(" ")).toContain("REMOTE_API_KEY_MISSING");
    // A key with no URL is NOT a refusal any more: the fleet gateway is the
    // default authority, and the status says which source decided.
    const gatewayDefault = getTodosRemoteAuthorityConfigStatus({ HASNA_TODOS_API_KEY: "fixture-key" });
    expect(gatewayDefault.ok).toBe(true);
    expect(gatewayDefault.v1_base_url).toBe("https://api.hasna.com/todos/v1");
    expect(gatewayDefault.api_url_source).toBe("default");
    expect(gatewayDefault.api_url_configured).toBe(false);
    expect(gatewayDefault.api_key_source).toBe("HASNA_TODOS_API_KEY");
    expect(gatewayDefault.api_key_tier).toBe("env");
  });

  test("authority status names the fail-closed refusal when the pair is absent without the opt-in", () => {
    const absent = getTodosRemoteAuthorityConfigStatus({});
    expect(absent.selected).toBe(true);
    expect(absent.ok).toBe(false);
    expect(absent.issues.join(" ")).toContain("REMOTE_API_CONFIG_MISSING");
    expect(absent.issues.join(" ")).toContain("HASNA_TODOS_LOCAL=1");
    const optedIn = getTodosRemoteAuthorityConfigStatus({ HASNA_TODOS_LOCAL: "1" });
    expect(optedIn.selected).toBe(false);
    expect(optedIn.ok).toBe(true);
  });

  test("stage-a routes the http transport from the API pair", () => {
    const init = initializeTodosCliAuthority(["list"], { ...HTTP_ENV });
    expect(init.route).toBe("remote-http");
    // A retired storage-mode variable is inert: with no API pair and no opt-in
    // the CLI fails closed (the throw propagates for a real command).
    expect(() => initializeTodosCliAuthority(["list"], {})).toThrow("REMOTE_API_CONFIG_MISSING");
    expect(() =>
      initializeTodosCliAuthority(["list"], { HASNA_TODOS_STORAGE_MODE: "sqlite" }),
    ).toThrow("REMOTE_API_CONFIG_MISSING");
    // The explicit opt-in is the only route to the local sqlite mode.
    expect(initializeTodosCliAuthority(["list"], { HASNA_TODOS_LOCAL: "1" }).route).toBe("local");
    expect(initializeTodosCliAuthority(["list"], { TODOS_LOCAL: "1" }).route).toBe("local");
  });
});
