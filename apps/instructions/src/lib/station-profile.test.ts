import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname as osHostname, platform as osPlatform } from "node:os";
import { join } from "node:path";
import { makeTempRoot } from "./test-temp-root";
import {
  buildStationProfileBlock,
  findLocalManifestMachine,
  getBunGlobalModulesDir,
  getMachinesManifestPath,
  getStationProfileCachePath,
  readMachinesManifest,
  readStationProfile,
  refreshStationProfile,
  resolveStationProfilePackages,
  STATION_PROFILE_LAYER,
  STATION_PROFILE_MAX_BYTES,
  STATION_PROFILE_MAX_HASNA_NAMES,
  STATION_PROFILE_SOURCE_ID,
  stationProfileSource,
  type StationProfileMachine,
  type StationProfilePackages,
} from "./station-profile";

function fixtureMachine(overrides: Partial<StationProfileMachine> = {}): StationProfileMachine {
  return {
    id: "station01",
    hostname: "station01",
    tailscaleName: "station01",
    platform: "linux",
    arch: "arm64",
    user: "hasna",
    homeDir: "/home/hasna",
    workspacePath: "/home/hasna/workspace",
    status: { state: "online", lastSeenAt: "2026-08-24T09:10:46.782Z" },
    ...overrides,
  };
}

function fixturePackages(overrides: Partial<StationProfilePackages> = {}): StationProfilePackages {
  return {
    scopes: [
{ scope: "@hasna", names: ["access", "accounts", "actions", "agency", "alumia", "analytics", "announce", "assistants", "attachments", "automations", "banking"] },
      { scope: "@hasna-internal", names: ["business-engines", "payroll", "social", "subscriptions", "takumi"] },
      { scope: "@hasnaxyz", names: ["agent-claude", "agent-codex", "agent-gemini", "agent-opencode", "agent-pi", "backup", "deployment", "factory", "iapp-accounting", "iappcodex", "iappcodex-linux-arm64", "infinity"] },
      { scope: "@hasnastudio", names: ["alumia"] },
      { scope: "@hasnatools", names: ["socializer"] },
    ],
    ...overrides,
  };
}

describe("station profile block", () => {
  test("renders every required field and stays under the 600-byte budget", () => {
    const block = buildStationProfileBlock({ machine: fixtureMachine(), packages: fixturePackages() });
    const bytes = Buffer.byteLength(block, "utf8");
    expect(bytes).toBeLessThanOrEqual(STATION_PROFILE_MAX_BYTES);
    expect(block.startsWith("Station: station01")).toBe(true);
    expect(block).toContain("Station: station01");
    expect(block).toContain("hostname: station01");
    expect(block).toContain("OS: linux/arm64");
    expect(block).toContain("user: hasna");
    expect(block).toContain("home: /home/hasna");
    expect(block).toContain("Workspace: /home/hasna/workspace");
    expect(block).toContain("Status: online");
    expect(block).toContain("@hasna/* 11");
    expect(block).toContain("@hasna-internal/* 5 (business-engines, payroll, social, subscriptions, takumi)");
    // Small non-primary scopes show their names; large ones degrade to counts.
    expect(block).toContain("@hasnastudio/* 1 (alumia)");
    expect(block).toContain("@hasnaxyz/* 12");
  });

  test("truncates huge @hasna/* lists to count + top-N + ellipsis", () => {
    const many = Array.from({ length: 126 }, (_, i) => `pkg-${String(i).padStart(3, "0")}`);
    const block = buildStationProfileBlock({ machine: fixtureMachine(), packages: fixturePackages({ scopes: [{ scope: "@hasna", names: many }] }) });
    expect(block).toContain(`@hasna/* 126 (${many.slice(0, STATION_PROFILE_MAX_HASNA_NAMES).join(", ")}, …)`);
    expect(block).not.toContain("pkg-012");
  });

  test("shows the full list when it fits", () => {
    const block = buildStationProfileBlock({ machine: fixtureMachine(), packages: fixturePackages({ scopes: [{ scope: "@hasna", names: ["access", "accounts"] }] }) });
    expect(block).toContain("@hasna/* 2 (access, accounts)");
  });

  test("omits the packages line when no hasna scopes are installed", () => {
    const block = buildStationProfileBlock({ machine: fixtureMachine(), packages: { scopes: [] } });
    expect(block).not.toContain("Hasna packages");
  });

  test("omits the status line when no status is known", () => {
    const block = buildStationProfileBlock({ machine: fixtureMachine({ status: null }), packages: fixturePackages() });
    expect(block).not.toContain("Status:");
  });

  test("omits tailscale when it duplicates the id", () => {
    const block = buildStationProfileBlock({ machine: fixtureMachine({ tailscaleName: null }), packages: fixturePackages() });
    expect(block).not.toContain("tailscale:");
  });

  test("is byte-identical for identical inputs (idempotent, no timestamps)", () => {
    const a = buildStationProfileBlock({ machine: fixtureMachine(), packages: fixturePackages() });
    const b = buildStationProfileBlock({ machine: fixtureMachine(), packages: fixturePackages() });
    expect(a).toBe(b);
  });
});

describe("machines manifest resolution", () => {
  test("reads the manifest and matches by id, hostname, or tailscale name", () => {
    const root = makeTempRoot("station-profile-manifest-");
    try {
      const manifestPath = join(root, "machines.json");
      writeFileSync(manifestPath, JSON.stringify({
        version: 1,
        machines: [
          { id: "station01", hostname: "station01", tailscaleName: "station01", platform: "linux", workspacePath: "/home/hasna/workspace", metadata: { user: "hasna" } },
          { id: "station02", hostname: "station02", tailscaleName: "station02", platform: "linux" },
        ],
      }));
      const machines = readMachinesManifest(manifestPath);
      expect(machines).toHaveLength(2);
      expect(findLocalManifestMachine(machines, "station01")?.["id"]).toBe("station01");
      expect(findLocalManifestMachine(machines, "station02")?.["id"]).toBe("station02");
      expect(findLocalManifestMachine(machines, "not-a-station")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("broken or missing manifest returns null instead of throwing", () => {
    const root = makeTempRoot("station-profile-broken-");
    try {
      const broken = join(root, "broken.json");
      writeFileSync(broken, "{ not json");
      expect(readMachinesManifest(broken)).toBeNull();
      expect(readMachinesManifest(join(root, "missing.json"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refresh falls back to local OS facts without a manifest", () => {
    const root = makeTempRoot("station-profile-fallback-");
    try {
      const result = refreshStationProfile({
        env: { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: join(root, "no-manifest.json"), BUN_INSTALL: root },
        probe: false,
      });
      expect(result.machine.id).toBe(osHostname());
      expect(result.machine.platform).toBe(osPlatform());
      expect(result.machine.workspacePath).toBe(join(root, "workspace"));
      expect(result.statusProbe).toBe("skipped");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refresh uses the manifest record when the local machine is listed", () => {
    const root = makeTempRoot("station-profile-manifest-use-");
    try {
      const manifestPath = join(root, "machines.json");
      writeFileSync(manifestPath, JSON.stringify({
        version: 1,
        machines: [{ id: "station99", hostname: osHostname(), tailscaleName: "station99", platform: "darwin", workspacePath: "/Users/hasna/workspace", metadata: { user: "hasna" } }],
      }));
      const result = refreshStationProfile({
        env: { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: manifestPath, BUN_INSTALL: root },
        probe: false,
      });
      expect(result.machine.id).toBe("station99");
      expect(result.machine.platform).toBe("darwin");
      expect(result.machine.workspacePath).toBe("/Users/hasna/workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("package listing", () => {
  test("lists hasna-named scopes with their package names and filters the rest", () => {
    const root = makeTempRoot("station-profile-pkgs-");
    try {
      const modules = join(root, "install", "global", "node_modules");
      for (const scope of ["@hasna", "@hasna-internal", "@hasnaxyz", "@other"]) mkdirSync(join(modules, scope), { recursive: true });
      for (const name of ["accounts", "actions", "access"]) mkdirSync(join(modules, "@hasna", name));
      for (const name of ["payroll", "takumi"]) mkdirSync(join(modules, "@hasna-internal", name));
      for (let i = 0; i < 12; i++) mkdirSync(join(modules, "@hasnaxyz", `pkg-${i}`));
      mkdirSync(join(modules, "@other", "thing"));
      const packages = resolveStationProfilePackages({ BUN_INSTALL: root });
      expect(packages).not.toBeNull();
      expect(packages!.scopes).toEqual([
        { scope: "@hasna", names: ["access", "accounts", "actions"] },
        { scope: "@hasna-internal", names: ["payroll", "takumi"] },
        { scope: "@hasnaxyz", names: ["pkg-0", "pkg-1", "pkg-10", "pkg-11", "pkg-2", "pkg-3", "pkg-4", "pkg-5", "pkg-6", "pkg-7", "pkg-8", "pkg-9"] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null when no bun global module directory exists", () => {
    const root = makeTempRoot("station-profile-nopkgs-");
    try {
      expect(resolveStationProfilePackages({ BUN_INSTALL: root })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns an empty scope list when the dir exists but has no hasna scopes", () => {
    const root = makeTempRoot("station-profile-nohasna-");
    try {
      const modules = join(root, "install", "global", "node_modules");
      mkdirSync(join(modules, "@other"), { recursive: true });
      mkdirSync(join(modules, "@other", "thing"));
      const packages = resolveStationProfilePackages({ BUN_INSTALL: root });
      expect(packages).not.toBeNull();
      expect(packages!.scopes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cache file", () => {
  test("cache path derives from the instructions data root", () => {
    const root = makeTempRoot("station-profile-cache-");
    try {
      expect(getStationProfileCachePath({ HOME: root, HASNA_CONFIGS_HOME: join(root, "custom-root") }))
        .toBe(join(root, "custom-root", "station-profile.md"));
      expect(getStationProfileCachePath({ HOME: root }))
        .toBe(join(root, ".hasna", "instructions", "station-profile.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refresh writes the cache; identical inputs do not rewrite it", () => {
    const root = makeTempRoot("station-profile-write-");
    try {
      const env = { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: join(root, "no.json"), BUN_INSTALL: root };
      const first = refreshStationProfile({ env, probe: false });
      const cachePath = getStationProfileCachePath(env);
      expect(existsSync(cachePath)).toBe(true);
      expect(readFileSync(cachePath, "utf8")).toBe(first.content);
      const mtime = statSync(cachePath).mtimeMs;
      refreshStationProfile({ env, probe: false });
      expect(statSync(cachePath).mtimeMs).toBe(mtime);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dry-run never writes", () => {
    const root = makeTempRoot("station-profile-dryrun-");
    try {
      const env = { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: join(root, "no.json"), BUN_INSTALL: root };
      refreshStationProfile({ env, probe: false, dryRun: true });
      expect(existsSync(getStationProfileCachePath(env))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refresh rejects a block over the byte budget", () => {
    const root = makeTempRoot("station-profile-budget-");
    try {
      const longPath = `/home/${"x".repeat(400)}/workspace`;
      const env = { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: join(root, "no.json"), BUN_INSTALL: root };
      // The manifest entry must match THIS machine's hostname (the manifest
      // record is what carries the oversized workspace path); otherwise the
      // block falls back to local OS facts and stays under the budget.
      writeFileSync(join(root, "no.json"), JSON.stringify({
        version: 1,
        machines: [{ id: "station01", hostname: osHostname(), platform: "linux", workspacePath: longPath }],
      }));
      expect(() => refreshStationProfile({ env, probe: false })).toThrow(/byte budget/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stationProfileSource returns null without a cache and a machine-layer source with one", () => {
    const root = makeTempRoot("station-profile-source-");
    try {
      const env = { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"), HASNA_MACHINES_MANIFEST_PATH: join(root, "no.json"), BUN_INSTALL: root };
      expect(stationProfileSource(env)).toBeNull();
      refreshStationProfile({ env, probe: false });
      const source = stationProfileSource(env);
      expect(source).not.toBeNull();
      expect(source!.id).toBe(STATION_PROFILE_SOURCE_ID);
      expect(source!.layer).toBe(STATION_PROFILE_LAYER);
      expect(source!.content.length).toBeGreaterThan(0);
      expect(source!.path).toBe(getStationProfileCachePath(env));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("path helpers", () => {
  test("manifest and bun dir honour their env overrides", () => {
    const root = makeTempRoot("station-profile-paths-");
    try {
      expect(getMachinesManifestPath({ HOME: root, HASNA_MACHINES_MANIFEST_PATH: "/custom/machines.json" })).toBe("/custom/machines.json");
      expect(getMachinesManifestPath({ HOME: root })).toBe(join(root, ".hasna", "machines", "machines.json"));
      expect(getBunGlobalModulesDir({ HOME: root, BUN_INSTALL: "/custom/bun" })).toBe(join("/custom/bun", "install", "global", "node_modules"));
      expect(getBunGlobalModulesDir({ HOME: root })).toBe(join(root, ".bun", "install", "global", "node_modules"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
