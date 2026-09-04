/**
 * Client transport resolution after the deployment-mode removal and the
 * 2026-09-04 fail-closed ruling (hasna/apps#1613): the OSS client seam has
 * exactly TWO implementations — a local SQLite file or the hosted HTTP `/v1`
 * authority. The transport is selected by the API env pair
 * (HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY) and the explicit local opt-in
 * (HASNA_TODOS_LOCAL=1 / TODOS_LOCAL=1) and nothing else: an incomplete API
 * pair refuses, and a fully absent pair WITHOUT the opt-in FAILS CLOSED
 * instead of silently serving the on-box store. Retired storage-mode
 * variables are inert — never read, never a fallback.
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
    expect(resolution.source).toBe("HASNA_TODOS_API_URL+HASNA_TODOS_API_KEY");
  });

  test("URL without KEY is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow("REMOTE_API_KEY_MISSING");
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow(/local SQLite is opt-in only/);
  });

  test("KEY without URL is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow("REMOTE_API_URL_MISSING");
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow(/local SQLite is opt-in only/);
  });

  test("a partial API pair fails closed even when the local opt-in is set", () => {
    // The pair, once partially present, is authoritative: a dangling URL or key
    // names the missing sibling rather than quietly degrading to local SQLite.
    expect(() =>
      resolveTodosCliTransport({
        HASNA_TODOS_API_URL: "https://todos.example.test",
        HASNA_TODOS_LOCAL: "1",
      }),
    ).toThrow("REMOTE_API_KEY_MISSING");
    expect(() =>
      resolveTodosCliTransport({
        HASNA_TODOS_API_KEY: "fixture-key",
        TODOS_LOCAL: "1",
      }),
    ).toThrow("REMOTE_API_URL_MISSING");
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
    const missingUrl = getTodosRemoteAuthorityConfigStatus({ HASNA_TODOS_API_KEY: "fixture-key" });
    expect(missingUrl.ok).toBe(false);
    expect(missingUrl.issues.join(" ")).toContain("REMOTE_API_URL_MISSING");
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
