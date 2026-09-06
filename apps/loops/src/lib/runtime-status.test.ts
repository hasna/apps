import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRuntimeConfig } from "./runtime-config.js";
import {
  buildStorageConnectionReport,
  resolvedClientRuntimeConfig,
  schedulerStateForConnection,
  storageConnectionReportLine,
} from "./runtime-status.js";

const API_ENV = {
  HASNA_LOOPS_API_URL: "https://loops.example.test",
  HASNA_LOOPS_API_KEY: "key",
} as const;

describe("storage/connection report contract", () => {
  test("defaults to sqlite file authority", () => {
    const report = buildStorageConnectionReport(resolveRuntimeConfig({}));
    expect(report.storage).toBe("sqlite");
    expect(report.connection).toBe("file");
    expect(report.apiUrl).toBeUndefined();
    expect(report.apiKeyPresent).toBe(false);
    expect(report.databaseUrlPresent).toBe(false);
    expect(report.configured).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.packageVersion).toEqual(expect.any(String));

    const schedulerState = schedulerStateForConnection(resolveRuntimeConfig({}));
    expect(schedulerState).toMatchObject({
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
    expect(schedulerState.routeAdmission.gates).toEqual([
      "max_dispatch",
      "max_active",
      "max_active_per_project",
      "max_active_per_project_group",
      "max_active_scope",
      "max_per_profile",
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("dataDir");
    expect(serialized).not.toContain("dbPath");
  });

  test("reports an api connection as a configured control-plane http scheduler", () => {
    const config = resolveRuntimeConfig(API_ENV);
    const report = buildStorageConnectionReport(config);
    expect(report.connection).toBe("api");
    expect(report.configured).toBe(true);
    expect(report.apiUrl).toBe("https://loops.example.test");
    expect(report.apiKeyPresent).toBe(true);
    expect(report.warnings).toEqual([]);

    const schedulerState = schedulerStateForConnection(config);
    expect(schedulerState.localStore.role).toBe("spool");
    expect(schedulerState.remoteStore).toMatchObject({
      backend: "control_plane_http",
      configured: true,
      applySupported: false,
      objectArtifacts: "object_store_contract",
      mutatesAws: false,
    });
    expect(schedulerState.routeAdmission.stateStore).toBe("control_plane_contract");
  });

  test("reports database url presence as the postgres scheduler contract with a server-only warning", () => {
    const config = resolveRuntimeConfig({ HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" });
    expect(config.storage).toBe("postgresql");
    const report = buildStorageConnectionReport(config);
    expect(report.databaseUrlPresent).toBe(true);
    expect(report.storage).toBe("postgresql");
    expect(report.configured).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.join(" ")).toContain("HASNA_LOOPS_DATABASE_URL");
    expect(report.warnings.join(" ")).toContain("server-only");
    expect(JSON.stringify(report)).not.toContain("postgres://");

    const schedulerState = schedulerStateForConnection(config);
    expect(schedulerState.remoteStore).toMatchObject({
      backend: "postgres_contract",
      configured: true,
      applySupported: false,
      objectArtifacts: "object_store_contract",
      mutatesAws: false,
    });
    expect(schedulerState.routeAdmission.stateStore).toBe("control_plane_contract");
  });

  test("covers the closed matrix of valid configurations without legacy vocabulary", () => {
    for (const env of [
      {},
      { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" },
      { ...API_ENV },
      { ...API_ENV, HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" },
    ]) {
      const report = buildStorageConnectionReport(resolveRuntimeConfig(env));
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain("deploymentMode");
      expect(serialized).not.toContain("sourceOfTruth");
      expect(serialized).not.toContain("self_hosted");
      expect(serialized).not.toContain("controlPlane");
    }
  });

  test("redacts credential-bearing api urls in status output", () => {
    const report = buildStorageConnectionReport(
      resolveRuntimeConfig({
        HASNA_LOOPS_API_URL: "https://user:fake-password@loops.example.test/api?token=fake-token&ok=true#frag",
        HASNA_LOOPS_API_KEY: "present-but-not-returned",
      }),
    );
    expect(report.apiUrl).toBe("https://loops.example.test/api");
    expect(report.apiKeyPresent).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("fake-password");
    expect(serialized).not.toContain("fake-token");
    expect(serialized).not.toContain("present-but-not-returned");
  });

  test("formats the storage/connection report line", () => {
    expect(storageConnectionReportLine(buildStorageConnectionReport(resolveRuntimeConfig({})))).toBe(
      "storage=sqlite connection=file",
    );
    const api = storageConnectionReportLine(buildStorageConnectionReport(resolveRuntimeConfig(API_ENV)));
    expect(api).toBe("storage=sqlite connection=api api=https://loops.example.test");
    const warned = storageConnectionReportLine(
      buildStorageConnectionReport(resolveRuntimeConfig({ HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" })),
    );
    expect(warned).toContain("storage=postgresql connection=file");
    expect(warned).toContain("warnings=[");
  });
});

describe("resolved transport report (shared resolver is the authority)", () => {
  test("reports api when a credential resolves from the credential FILE while env is silent", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-status-disk-"));
    try {
      const file = join(root, ".hasna", "loops", "config", "credentials");
      mkdirSync(join(root, ".hasna", "loops", "config"), { recursive: true });
      writeFileSync(file, "HASNA_LOOPS_API_KEY=fixture-disk-key\n", { mode: 0o600 });

      const config = resolvedClientRuntimeConfig({ HOME: root });
      expect(config.connection).toBe("api");
      expect(config.apiKeyPresent).toBe(true);
      // The report never carries the value, and the fleet gateway default is
      // the authority for a credential that names no URL.
      const report = buildStorageConnectionReport(config);
      expect(report.apiUrl).toBe("https://api.hasna.com/loops");
      expect(JSON.stringify(report)).not.toContain("fixture-disk-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports the file opt-in as the explicit local connection even when a disk credential exists", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-status-optin-"));
    try {
      const file = join(root, ".hasna", "loops", "config", "credentials");
      mkdirSync(join(root, ".hasna", "loops", "config"), { recursive: true });
      writeFileSync(file, "HASNA_LOOPS_API_KEY=fixture-disk-key\n", { mode: 0o600 });

      const config = resolvedClientRuntimeConfig({ HOME: root, HASNA_LOOPS_CONNECTION: "file" });
      expect(config.connection).toBe("file");
      expect(config.apiKeyPresent).toBe(false);
      expect(config.apiUrlPresent).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("env URL + key resolve to the scrubbed explicit authority", () => {
    const config = resolvedClientRuntimeConfig({
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "do-not-print-this-token",
    });
    const report = buildStorageConnectionReport(config);
    expect(report.connection).toBe("api");
    expect(report.apiUrl).toBe("https://loops.example.test");
    expect(JSON.stringify(report)).not.toContain("do-not-print-this-token");
  });
});
