/**
 * Client transport resolution after the deployment-mode removal: the OSS
 * client seam has exactly TWO implementations — a local SQLite file or the
 * hosted HTTP `/v1` authority. The transport is selected by the API env pair
 * (HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY) and nothing else. Retired
 * storage-mode variables are inert — never read, never a fallback — and an
 * incomplete API pair refuses instead of silently serving a different dataset.
 */
import { describe, expect, test } from "bun:test";
import { getTodosRemoteAuthorityConfigStatus, resolveTodosCliTransport } from "./cloud-router.js";
import { initializeTodosCliAuthority } from "./stage-a.js";

const HTTP_ENV = {
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

describe("client transport resolution (sqlite|http, no storage modes)", () => {
  test("neither URL nor KEY set resolves the sqlite transport", () => {
    const resolution = resolveTodosCliTransport({});
    expect(resolution.transport).toBe("sqlite");
    expect(resolution.selected).toBe(false);
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
    ).toThrow(/local SQLite fallback is disabled/);
  });

  test("KEY without URL is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow("REMOTE_API_URL_MISSING");
    expect(() =>
      resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow(/local SQLite fallback is disabled/);
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
    // Alone, a stale variable selects nothing; the default sqlite arm applies.
    expect(resolveTodosCliTransport({ [key]: "local", HASNA_TODOS_DB_PATH: "/tmp/x.db" }).transport)
      .toBe("sqlite");
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

  test("stage-a routes the http transport from the API pair", () => {
    const init = initializeTodosCliAuthority(["list"], { ...HTTP_ENV });
    expect(init.route).toBe("remote-http");
    expect(initializeTodosCliAuthority(["list"], {}).route).toBe("local");
    // A retired storage-mode variable is inert: with no API pair the route stays local.
    expect(initializeTodosCliAuthority(["list"], { HASNA_TODOS_STORAGE_MODE: "sqlite" }).route)
      .toBe("local");
  });
});
