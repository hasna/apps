/**
 * Client transport collapse conformance (owner directive 2026-07-29, knowledge
 * k_ms3e6v41_zbe7m8): the OSS client seam has exactly TWO implementations —
 * a local SQLite file or the hosted HTTP `/v1` authority. The client NEVER opens
 * Postgres directly. The five-token deployment-mode union
 * (local|remote|self_hosted|cloud|hybrid) collapses to that binary transport:
 * legacy tokens keep routing (the fleet sets `remote`), deprecated
 * deployment-mode tokens normalize to `http`, and no mode vocabulary survives in
 * refusal text.
 */
import { describe, expect, test } from "bun:test";
import { getTodosRemoteAuthorityConfigStatus, resolveTodosCliStorageMode } from "./cloud-router.js";
import { initializeTodosCliAuthority } from "./stage-a.js";

const HTTP_ENV = {
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

describe("client transport collapse (sqlite|http)", () => {
  test("unset selector resolves the sqlite transport", () => {
    const resolution = resolveTodosCliStorageMode({});
    expect(resolution.transport).toBe("sqlite");
    expect(resolution.selected).toBe(false);
  });

  test("canonical transport tokens are accepted", () => {
    expect(resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "sqlite" }).transport).toBe("sqlite");
    const http = resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "http" });
    expect(http.transport).toBe("http");
    expect(http.selected).toBe(true);
  });

  test("legacy placement tokens keep routing onto the two transports", () => {
    expect(resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "local" }).transport).toBe("sqlite");
    const remote = resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "remote" });
    expect(remote.transport).toBe("http");
    expect(remote.selected).toBe(true);
  });

  test("deprecated deployment-mode tokens normalize to http — never a third arm", () => {
    for (const legacy of ["self_hosted", "cloud", "hybrid"]) {
      const resolution = resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: legacy });
      expect(resolution.transport).toBe("http");
      expect(resolution.selected).toBe(true);
    }
  });

  test("an invalid selector refusal does not advertise deployment-mode vocabulary", () => {
    let message = "";
    try {
      resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "bogus" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("sqlite");
    expect(message).toContain("http");
    expect(message).not.toMatch(/self_hosted|self-hosted|hybrid/);
  });

  test("canonical/fallback disagreement is still rejected across the collapsed transports", () => {
    expect(() =>
      resolveTodosCliStorageMode({
        HASNA_TODOS_STORAGE_MODE: "sqlite",
        TODOS_STORAGE_MODE: "remote",
      }),
    ).toThrow(/REMOTE_STORAGE_MODE_CONFLICT/);
    // Same transport spelled with different tokens is NOT a conflict.
    const agreeing = resolveTodosCliStorageMode({
      HASNA_TODOS_STORAGE_MODE: "http",
      TODOS_STORAGE_MODE: "remote",
    });
    expect(agreeing.transport).toBe("http");
  });

  test("authority status reports the collapsed transport for every http token", () => {
    for (const token of ["remote", "http", "self_hosted", "cloud", "hybrid"]) {
      const status = getTodosRemoteAuthorityConfigStatus({
        ...HTTP_ENV,
        HASNA_TODOS_STORAGE_MODE: token,
      });
      expect(status.selected).toBe(true);
      expect(status.ok).toBe(true);
      expect(status.v1_base_url).toBe("https://todos.example.test/v1");
    }
  });

  test("stage-a routes the http transport for canonical and legacy tokens alike", () => {
    for (const token of ["remote", "http"]) {
      const init = initializeTodosCliAuthority(["list"], {
        ...HTTP_ENV,
        HASNA_TODOS_STORAGE_MODE: token,
      });
      expect(init.route).toBe("remote-http");
    }
    expect(initializeTodosCliAuthority(["list"], { HASNA_TODOS_STORAGE_MODE: "sqlite" }).route).toBe("local");
  });
});
