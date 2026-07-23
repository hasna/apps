import { describe, expect, test } from "bun:test";
import { buildDeploymentStatus, normalizeLoopDeploymentMode, resolveLoopDeploymentMode } from "./mode.js";
import { normalizeStorageMode } from "./cloud/mode.js";
import { resolveCloudStorage } from "./cloud/resolve.js";
import { clientTransportEnvKeys, resolveClientTransport } from "./cloud/transport.js";

describe("deployment mode contract", () => {
  test("defaults to local SQLite authority", () => {
    const status = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "",
        HASNA_LOOPS_API_URL: "",
        HASNA_LOOPS_DATABASE_URL: "",
      },
    });

    expect(status.deploymentMode).toBe("local");
    expect(status.sourceOfTruth).toBe("local_sqlite");
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
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("accepts only canonical deployment mode spellings", () => {
    expect(normalizeLoopDeploymentMode("self_hosted")).toBe("self_hosted");
    for (const legacy of ["self-hosted", "selfhosted", "remote", "hybrid", "saas"]) {
      expect(() => normalizeLoopDeploymentMode(legacy)).toThrow("unsupported Loops deployment mode");
    }
    expect(resolveLoopDeploymentMode({ HASNA_LOOPS_STORAGE_MODE: "self_hosted" })).toEqual({
      deploymentMode: "self_hosted",
      source: "HASNA_LOOPS_STORAGE_MODE",
    });
  });

  test("removes compatibility storage modes and generic environment aliases", () => {
    expect(normalizeStorageMode("local")).toEqual({ mode: "local" });
    expect(normalizeStorageMode("self_hosted")).toEqual({ mode: "self_hosted" });
    expect(normalizeStorageMode("cloud")).toEqual({ mode: "cloud" });
    for (const legacy of ["selfhosted", "self-hosted", "remote", "hybrid", "saas"]) {
      expect(() => normalizeStorageMode(legacy)).toThrow("Unknown storage mode");
    }
    expect(clientTransportEnvKeys("loops").modeKeys).toEqual(["HASNA_LOOPS_STORAGE_MODE"]);
    expect(resolveClientTransport("loops", {
      LOOPS_MODE: "cloud",
      LOOPS_STORAGE_MODE: "cloud",
      HASNA_LOOPS_MODE: "cloud",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "ignored-without-canonical-mode",
    }).transport).toBe("local");
    expect(resolveCloudStorage("loops", {
      HASNA_LOOPS_STORAGE_MODE: "self_hosted",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    }).transport).toBe("cloud-http");
    expect(() => resolveCloudStorage("loops", {
      HASNA_LOOPS_STORAGE_MODE: "selfhosted",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    })).toThrow("Unknown deployment mode");
  });

  test("fails closed for every partial remote client configuration", () => {
    for (const mode of ["self_hosted", "cloud"]) {
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

  test("detects self-hosted control plane from API configuration", () => {
    const status = buildDeploymentStatus({ env: { HASNA_LOOPS_API_URL: "http://127.0.0.1:8787" } });

    expect(status.deploymentMode).toBe("self_hosted");
    expect(status.sourceOfTruth).toBe("self_hosted_control_plane");
    expect(status.localStore.role).toBe("cache_and_spool");
    expect(status.controlPlane).toMatchObject({
      kind: "self_hosted",
      configured: true,
      apiUrl: "http://127.0.0.1:8787",
    });
    expect(status.schedulerState).toMatchObject({
      authority: "self_hosted_control_plane",
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
  });

  test("detects self-hosted Postgres scheduler contract without implying runner API readiness", () => {
    const status = buildDeploymentStatus({ env: { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/loops" } });

    expect(status.deploymentMode).toBe("self_hosted");
    expect(status.controlPlane.configured).toBe(true);
    expect(status.controlPlane.databaseUrlPresent).toBe(true);
    expect(status.schedulerState.remoteStore).toMatchObject({
      backend: "postgres_contract",
      configured: true,
      applySupported: false,
      mutatesAws: false,
    });
    expect(status.warnings.join(" ")).toContain("loops-runner still needs HASNA_LOOPS_API_URL");
    expect(JSON.stringify(status)).not.toContain("postgres://");
  });

  test("redacts credential-bearing control-plane URLs in status output", () => {
    const status = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_API_URL: "https://user:fake-password@loops.example.test/api?token=fake-token&ok=true#frag",
        HASNA_LOOPS_API_KEY: "present-but-not-returned",
      },
    });

    expect(status.controlPlane.apiUrl).toBe("https://loops.example.test/api");
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("fake-password");
    expect(serialized).not.toContain("fake-token");
    expect(serialized).not.toContain("present-but-not-returned");
  });

  test("keeps cloud explicit and token-safe", () => {
    const status = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "cloud",
        HASNA_LOOPS_API_URL: "https://loops.example.test",
        HASNA_LOOPS_API_KEY: "present-but-not-returned",
      },
    });

    expect(status.deploymentMode).toBe("cloud");
    expect(status.sourceOfTruth).toBe("cloud_control_plane");
    expect(status.controlPlane.apiUrl).toBe("https://loops.example.test");
    expect(status.controlPlane.configured).toBe(true);
    expect(status.controlPlane.apiKeyPresent).toBe(true);
    expect(status.schedulerState.remoteStore).toMatchObject({
      backend: "hosted_control_plane_contract",
      configured: true,
      applySupported: false,
      objectArtifacts: "object_store_contract",
      mutatesAws: false,
    });
    expect(status.schedulerState.routeAdmission.stateStore).toBe("control_plane_contract");
    expect(JSON.stringify(status)).not.toContain("present-but-not-returned");
  });

  test("keeps cloud contract-only until cloud URL and cloud token are configured", () => {
    const urlOnly = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "cloud",
        HASNA_LOOPS_API_URL: "https://loops.example.test",
      },
    });
    expect(urlOnly.controlPlane.configured).toBe(false);
    expect(urlOnly.warnings.join(" ")).toContain("HASNA_LOOPS_API_KEY");

    const configured = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "cloud",
        HASNA_LOOPS_API_URL: "https://loops.example.test",
        HASNA_LOOPS_API_KEY: "cloud-token",
      },
    });
    expect(configured.controlPlane.configured).toBe(true);
    expect(configured.controlPlane.apiUrl).toBe("https://loops.example.test");
  });

  test("uses deploymentMode vocabulary to avoid overloaded runtime mode fields", () => {
    const status = buildDeploymentStatus({ env: { HASNA_LOOPS_STORAGE_MODE: "cloud" } });
    const serialized = JSON.parse(JSON.stringify(status));

    expect(serialized.deploymentMode).toBe("cloud");
    expect(serialized.activeDeploymentMode).toBe("cloud");
    expect(serialized.mode).toBeUndefined();
    expect(serialized.activeMode).toBeUndefined();
    expect(serialized.modeSource).toBeUndefined();
  });
});
