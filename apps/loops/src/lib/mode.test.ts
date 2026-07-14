import { describe, expect, test } from "bun:test";
import { buildDeploymentStatus, normalizeLoopDeploymentMode, resolveLoopDeploymentMode } from "./mode.js";

describe("deployment mode contract", () => {
  test("defaults to local SQLite authority", () => {
    const status = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "",
        HASNA_LOOPS_API_URL: "",
        HASNA_LOOPS_CLOUD_API_URL: "",
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

  test("normalizes explicit self-hosted spelling", () => {
    expect(normalizeLoopDeploymentMode("self-hosted")).toBe("self_hosted");
    expect(resolveLoopDeploymentMode({ HASNA_LOOPS_STORAGE_MODE: "self_hosted" })).toEqual({
      deploymentMode: "self_hosted",
      source: "HASNA_LOOPS_STORAGE_MODE",
    });
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
    const status = buildDeploymentStatus({ env: { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" } });

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
        HASNA_LOOPS_CLOUD_API_URL: "https://loops.example.test",
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
        HASNA_LOOPS_CLOUD_API_URL: "https://loops.example.test",
      },
    });
    expect(urlOnly.controlPlane.configured).toBe(false);
    expect(urlOnly.warnings.join(" ")).toContain("HASNA_LOOPS_API_KEY");

    const genericApiUrl = buildDeploymentStatus({
      env: {
        HASNA_LOOPS_STORAGE_MODE: "cloud",
        HASNA_LOOPS_API_URL: "https://self-hosted.example.test",
        HASNA_LOOPS_API_KEY: "self-hosted-token",
      },
    });
    expect(genericApiUrl.controlPlane.configured).toBe(false);
    expect(genericApiUrl.controlPlane.apiUrl).toBeUndefined();
    expect(genericApiUrl.warnings.join(" ")).toContain("cloud mode uses HASNA_LOOPS_CLOUD_API_URL");
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
