import { describe, expect, test } from "bun:test";
import {
  buildStorageStatus,
  normalizeLoopClientTransport,
  resolveLoopClientTransport,
  resolveLoopDataBackend,
  storageStatusLine,
} from "./mode.js";
import { normalizeStorageMode } from "./cloud/mode.js";
import { resolveCloudStorage } from "./cloud/resolve.js";
import { clientTransportEnvKeys, resolveClientTransport } from "./cloud/transport.js";

/**
 * The retired three-way deployment-mode vocabulary must never appear in any
 * status payload or status line. `local`/`cloud` as plain words survive only
 * where the installed @hasna/contracts wire contract requires them (the
 * /health envelope), which is not built here.
 */
const RETIRED_MODE_VOCABULARY = /self_hosted|self-hosted|deploymentMode|cloud_control_plane|hosted_control_plane|cloud-http/;

describe("storage backend contract", () => {
  test("defaults to sqlite backend with local sqlite authority", () => {
    const env = {
      HASNA_LOOPS_STORAGE_MODE: "",
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_DATABASE_URL: "",
    };
    const status = buildStorageStatus({ env });

    expect(status.dataBackend).toBe("sqlite");
    expect(status.clientTransport).toBe("sqlite");
    expect(status.authority).toBe("local_sqlite");
    expect(status.localStore.role).toBe("authoritative");
    expect(status.schedulerState).toMatchObject({
      authority: "local_sqlite",
      localStore: {
        backend: "sqlite",
        role: "authoritative",
        runArtifacts: "local_files",
        routeAdmissionState: "workflow_work_items",
      },
      remoteStore: {
        backend: "none",
        configured: false,
        applySupported: false,
        objectArtifacts: "none",
        mutatesAws: false,
      },
      routeAdmission: {
        stateStore: "local_sqlite",
        activeStatuses: ["admitted", "running"],
        dryRunEvaluatesLiveCounts: false,
      },
    });
    expect(status.schedulerState.routeAdmission.gates).toEqual([
      "max_dispatch",
      "max_active",
      "max_active_per_project",
      "max_active_per_project_group",
      "max_active_scope",
      "max_per_profile",
    ]);
    expect(status.runner.required).toBe(false);
    expect(status.runner.role).toBe("daemon");
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("accepts only the sqlite|http client transport spellings", () => {
    expect(normalizeLoopClientTransport("sqlite")).toBe("sqlite");
    expect(normalizeLoopClientTransport("http")).toBe("http");
    for (const rejected of ["selfhosted", "self-hosted", "remote", "hybrid", "saas", "postgres"]) {
      expect(() => normalizeLoopClientTransport(rejected)).toThrow("unsupported Loops storage mode");
    }
  });

  test("maps the retired deployment-mode values onto the backend switch", () => {
    // Deployed fleets still carry the retired vocabulary in their environment;
    // the values must keep selecting the same backend they always selected.
    expect(normalizeLoopClientTransport("local")).toBe("sqlite");
    expect(normalizeLoopClientTransport("self_hosted")).toBe("http");
    expect(normalizeLoopClientTransport("cloud")).toBe("http");
    expect(normalizeStorageMode("local")).toEqual({ mode: "sqlite" });
    expect(normalizeStorageMode("self_hosted")).toEqual({ mode: "http" });
    expect(normalizeStorageMode("cloud")).toEqual({ mode: "http" });
    expect(resolveLoopClientTransport({ HASNA_LOOPS_STORAGE_MODE: "sqlite" })).toEqual({
      transport: "sqlite",
      source: "HASNA_LOOPS_STORAGE_MODE",
    });
  });

  test("data backend is selected by the database URL alone", () => {
    expect(resolveLoopDataBackend({})).toEqual({ backend: "sqlite", source: "default" });
    expect(resolveLoopDataBackend({ HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" })).toEqual({
      backend: "postgres",
      source: "HASNA_LOOPS_DATABASE_URL",
    });
    // The client pin never selects postgres: the client is sqlite-or-http only.
    expect(resolveLoopDataBackend({ HASNA_LOOPS_STORAGE_MODE: "http" }).backend).toBe("sqlite");
  });

  test("rejects generic environment aliases for the client flip", () => {
    for (const rejected of ["selfhosted", "self-hosted", "remote", "hybrid", "saas"]) {
      expect(() => normalizeStorageMode(rejected)).toThrow("Unknown storage mode");
    }
    expect(clientTransportEnvKeys("loops").modeKeys).toEqual(["HASNA_LOOPS_STORAGE_MODE"]);
    // Generic alias env keys are ignored: without the canonical pin the
    // transport layer stays on the on-box sqlite store.
    expect(resolveClientTransport("loops", {
      LOOPS_MODE: "http",
      LOOPS_STORAGE_MODE: "http",
      HASNA_LOOPS_MODE: "http",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "ignored-without-canonical-mode",
    }).transport).toBe("sqlite");
    expect(resolveCloudStorage("loops", {
      HASNA_LOOPS_STORAGE_MODE: "http",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    }).transport).toBe("http");
    expect(() => resolveCloudStorage("loops", {
      HASNA_LOOPS_STORAGE_MODE: "selfhosted",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    })).toThrow("Unknown storage mode");
  });

  test("fails closed for every partial remote client configuration", () => {
    for (const mode of ["http", "self_hosted", "cloud"]) {
      expect(() => resolveCloudStorage("loops", {
        HASNA_LOOPS_STORAGE_MODE: mode,
      })).toThrow("requires both HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY");
      expect(() => resolveCloudStorage("loops", {
        HASNA_LOOPS_STORAGE_MODE: mode,
        HASNA_LOOPS_API_URL: "https://loops.example.test",
      })).toThrow("requires both HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY");
      expect(() => resolveCloudStorage("loops", {
        HASNA_LOOPS_STORAGE_MODE: mode,
        HASNA_LOOPS_API_KEY: "key",
      })).toThrow("requires both HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY");
    }
    expect(() => resolveCloudStorage("loops", {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
    })).toThrow("requires both HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY");
    expect(() => resolveCloudStorage("loops", {
      HASNA_LOOPS_API_KEY: "key",
    })).toThrow("requires both HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY");
  });

  test("the sqlite pin wins over API vars — the flip is always reversible", () => {
    const env = {
      HASNA_LOOPS_STORAGE_MODE: "sqlite",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    };
    expect(resolveCloudStorage("loops", env).transport).toBe("sqlite");
    const status = buildStorageStatus({ env });
    expect(status.authority).toBe("local_sqlite");
    expect(status.clientTransport).toBe("sqlite");
    expect(status.runner.required).toBe(false);
  });

  test("API configuration selects the server authority", () => {
    const status = buildStorageStatus({ env: { HASNA_LOOPS_API_URL: "http://127.0.0.1:8787" } });

    expect(status.authority).toBe("server_api");
    expect(status.localStore.role).toBe("cache_and_spool");
    expect(status.server).toMatchObject({
      configured: true,
      apiUrl: "http://127.0.0.1:8787",
    });
    expect(status.schedulerState).toMatchObject({
      authority: "server_api",
      localStore: { backend: "sqlite", role: "cache_and_spool", runArtifacts: "local_files" },
      remoteStore: {
        backend: "api_control_plane_contract",
        configured: true,
        applySupported: false,
        objectArtifacts: "object_store_contract",
        mutatesAws: false,
      },
      routeAdmission: { stateStore: "control_plane_contract" },
    });
    expect(status.runner).toMatchObject({ required: true, role: "control_plane_worker" });
    expect(status.warnings.join(" ")).toContain("HASNA_LOOPS_API_KEY");
  });

  test("a database URL selects the postgres backend without implying runner API readiness", () => {
    const status = buildStorageStatus({ env: { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" } });

    expect(status.dataBackend).toBe("postgres");
    expect(status.authority).toBe("server_api");
    expect(status.server.configured).toBe(true);
    expect(status.server.databaseUrlPresent).toBe(true);
    expect(status.schedulerState.remoteStore).toMatchObject({
      backend: "postgres_contract",
      configured: true,
      applySupported: false,
      mutatesAws: false,
    });
    expect(status.warnings.join(" ")).toContain("loops-runner still needs HASNA_LOOPS_API_URL");
    expect(JSON.stringify(status)).not.toContain("postgres://");
  });

  test("redacts credential-bearing server URLs in status output", () => {
    const status = buildStorageStatus({
      env: {
        HASNA_LOOPS_API_URL: "https://user:fake-password@loops.example.test/api?token=fake-token&ok=true#frag",
        HASNA_LOOPS_API_KEY: "present-but-not-returned",
      },
    });

    expect(status.server.apiUrl).toBe("https://loops.example.test/api");
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("fake-password");
    expect(serialized).not.toContain("fake-token");
    expect(serialized).not.toContain("present-but-not-returned");
  });

  test("fully configured http client is ready and token-safe", () => {
    const status = buildStorageStatus({
      env: {
        HASNA_LOOPS_API_URL: "https://loops.example.test",
        HASNA_LOOPS_API_KEY: "present-but-not-returned",
      },
    });

    expect(status.clientTransport).toBe("http");
    expect(status.authority).toBe("server_api");
    expect(status.server.apiUrl).toBe("https://loops.example.test");
    expect(status.server.configured).toBe(true);
    expect(status.server.apiKeyPresent).toBe(true);
    expect(status.warnings).toEqual([]);
    expect(JSON.stringify(status)).not.toContain("present-but-not-returned");
  });

  test("no retired deployment-mode vocabulary reaches any status output", () => {
    const environments: Record<string, string>[] = [
      {},
      { HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" },
      { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" },
      { HASNA_LOOPS_STORAGE_MODE: "sqlite" },
      // Retired values still select a backend, but never echo mode vocabulary.
      { HASNA_LOOPS_STORAGE_MODE: "self_hosted", HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" },
      { HASNA_LOOPS_STORAGE_MODE: "cloud", HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" },
      { HASNA_LOOPS_STORAGE_MODE: "local" },
    ];
    for (const env of environments) {
      const status = buildStorageStatus({ env });
      expect(JSON.stringify(status)).not.toMatch(RETIRED_MODE_VOCABULARY);
      expect(storageStatusLine(status)).not.toMatch(RETIRED_MODE_VOCABULARY);
      for (const warning of status.warnings) expect(warning).not.toMatch(RETIRED_MODE_VOCABULARY);
    }
  });

  test("status has no overloaded runtime mode fields", () => {
    const status = buildStorageStatus({ env: { HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_API_KEY: "k" } });
    const serialized = JSON.parse(JSON.stringify(status));

    expect(serialized.dataBackend).toBe("sqlite");
    expect(serialized.clientTransport).toBe("http");
    expect(serialized.mode).toBeUndefined();
    expect(serialized.activeMode).toBeUndefined();
    expect(serialized.deploymentMode).toBeUndefined();
    expect(serialized.activeDeploymentMode).toBeUndefined();
  });
});
