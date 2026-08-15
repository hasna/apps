/**
 * Client transport resolution after the storage-mode removal (owner directive
 * 2026-08-15): the OSS client seam has exactly TWO implementations — a local
 * SQLite file or the hosted HTTP `/v1` authority. The transport is selected by
 * the API env pair (HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY) and nothing
 * else. Any retired storage-mode variable is a hard error — never accepted,
 * never mapped, never a fallback — and an incomplete API pair refuses instead
 * of silently serving a different dataset.
 */
import { describe, expect, test } from "bun:test";
import { getTodosRemoteAuthorityConfigStatus, resolveTodosCliStorageMode } from "./cloud-router.js";
import { initializeTodosCliAuthority } from "./stage-a.js";

const HTTP_ENV = {
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

describe("client transport resolution (sqlite|http, no storage modes)", () => {
  test("neither URL nor KEY set resolves the sqlite transport", () => {
    const resolution = resolveTodosCliStorageMode({});
    expect(resolution.transport).toBe("sqlite");
    expect(resolution.selected).toBe(false);
  });

  test("URL + KEY both set selects the http transport", () => {
    const resolution = resolveTodosCliStorageMode(HTTP_ENV);
    expect(resolution.transport).toBe("http");
    expect(resolution.selected).toBe(true);
    expect(resolution.source).toBe("HASNA_TODOS_API_URL+HASNA_TODOS_API_KEY");
  });

  test("URL without KEY is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliStorageMode({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow("REMOTE_API_KEY_MISSING");
    expect(() =>
      resolveTodosCliStorageMode({ HASNA_TODOS_API_URL: "https://todos.example.test" }),
    ).toThrow(/local SQLite fallback is disabled/);
  });

  test("KEY without URL is a hard error — never sqlite fallback", () => {
    expect(() =>
      resolveTodosCliStorageMode({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow("REMOTE_API_URL_MISSING");
    expect(() =>
      resolveTodosCliStorageMode({ HASNA_TODOS_API_KEY: "fixture-key" }),
    ).toThrow(/local SQLite fallback is disabled/);
  });

  test.each([
    "HASNA_TODOS_STORAGE_MODE",
    "HASNA_TODOS_MODE",
    "TODOS_STORAGE_MODE",
    "TODOS_MODE",
  ])("any retired storage-mode variable %s throws — even with a complete API pair", (key) => {
    const withPair = { ...HTTP_ENV, [key]: "remote" };
    expect(() => resolveTodosCliStorageMode(withPair)).toThrow("REMOTE_STORAGE_MODE_REMOVED");
    expect(() => resolveTodosCliStorageMode(withPair)).toThrow(
      /Deployment modes no longer exist: delete the storage-mode variable/,
    );
    // A BLANK leftover is still a stale fragment: fires on SET, not on non-blank.
    expect(() => resolveTodosCliStorageMode({ ...HTTP_ENV, [key]: "" }))
      .toThrow("REMOTE_STORAGE_MODE_REMOVED");
    // And a retired variable is never rescued by a local DB path either.
    expect(() => resolveTodosCliStorageMode({ [key]: "local", HASNA_TODOS_DB_PATH: "/tmp/x.db" }))
      .toThrow("REMOTE_STORAGE_MODE_REMOVED");
  });

  test("legacy mode values are rejected, never mapped onto a transport", () => {
    for (const legacy of ["sqlite", "http", "local", "remote", "self_hosted", "cloud", "hybrid"]) {
      expect(() => resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: legacy }))
        .toThrow("REMOTE_STORAGE_MODE_REMOVED");
    }
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
    expect(() => initializeTodosCliAuthority(["list"], { HASNA_TODOS_STORAGE_MODE: "sqlite" }))
      .toThrow("REMOTE_STORAGE_MODE_REMOVED");
  });
});
