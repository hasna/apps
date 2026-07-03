import { describe, expect, test } from "bun:test";
import { buildDeploymentStatus, normalizeLoopDeploymentMode, resolveLoopDeploymentMode } from "./mode.js";

describe("deployment mode contract", () => {
  test("defaults to local SQLite authority", () => {
    const status = buildDeploymentStatus({
      env: {
        LOOPS_MODE: "",
        HASNA_LOOPS_MODE: "",
        LOOPS_API_URL: "",
        HASNA_LOOPS_API_URL: "",
        LOOPS_CLOUD_API_URL: "",
        HASNA_LOOPS_CLOUD_API_URL: "",
        LOOPS_DATABASE_URL: "",
        HASNA_LOOPS_DATABASE_URL: "",
      },
    });

    expect(status.deploymentMode).toBe("local");
    expect(status.sourceOfTruth).toBe("local_sqlite");
    expect(status.localStore.role).toBe("authoritative");
    expect(status.runner.required).toBe(false);
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("normalizes explicit self-hosted spelling", () => {
    expect(normalizeLoopDeploymentMode("self-hosted")).toBe("self_hosted");
    expect(resolveLoopDeploymentMode({ LOOPS_MODE: "self_hosted" })).toEqual({
      deploymentMode: "self_hosted",
      source: "LOOPS_MODE",
    });
  });

  test("detects self-hosted control plane from API configuration", () => {
    const status = buildDeploymentStatus({ env: { LOOPS_API_URL: "http://127.0.0.1:8787" } });

    expect(status.deploymentMode).toBe("self_hosted");
    expect(status.sourceOfTruth).toBe("self_hosted_control_plane");
    expect(status.localStore.role).toBe("cache_and_spool");
    expect(status.controlPlane).toMatchObject({
      kind: "self_hosted",
      configured: true,
      apiUrl: "http://127.0.0.1:8787",
    });
    expect(status.runner).toMatchObject({ required: true, role: "control_plane_worker" });
  });

  test("keeps cloud explicit and token-safe", () => {
    const status = buildDeploymentStatus({
      env: {
        LOOPS_MODE: "cloud",
        LOOPS_CLOUD_API_URL: "https://loops.example.test",
        LOOPS_CLOUD_TOKEN: "present-but-not-returned",
      },
    });

    expect(status.deploymentMode).toBe("cloud");
    expect(status.sourceOfTruth).toBe("cloud_control_plane");
    expect(status.controlPlane.apiUrl).toBe("https://loops.example.test");
    expect(status.controlPlane.authTokenPresent).toBe(true);
    expect(JSON.stringify(status)).not.toContain("present-but-not-returned");
  });

  test("uses deploymentMode vocabulary to avoid overloaded runtime mode fields", () => {
    const status = buildDeploymentStatus({ env: { LOOPS_MODE: "cloud" } });
    const serialized = JSON.parse(JSON.stringify(status));

    expect(serialized.deploymentMode).toBe("cloud");
    expect(serialized.activeDeploymentMode).toBe("cloud");
    expect(serialized.mode).toBeUndefined();
    expect(serialized.activeMode).toBeUndefined();
    expect(serialized.modeSource).toBeUndefined();
  });
});
