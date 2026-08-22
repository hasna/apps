import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  manifestClearFriendlyName,
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestGetFriendlyName,
  manifestInit,
  manifestRemove,
  manifestSetFriendlyName,
  manifestValidate,
} from "../src/commands/manifest.js";
import {
  LEGACY_BUN_REGISTRY_SOURCE_SHA256,
  detectCurrentMachineManifest,
  getManifestMachine,
  getManifestSourceRef,
  readManifest,
  readManifestWithSource,
  type ManifestSourceAdapter,
} from "../src/manifests.js";
import { exactBunCandidate, writeExactBunCandidate } from "./fixtures/exact-bun.js";

function expectExactCandidateRejected(mutate: (candidate: any) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "stations-exact-manifest-invalid-"));
  const path = join(dir, "stations.json");
  const candidate: any = structuredClone(exactBunCandidate());
  mutate(candidate);
  writeFileSync(path, `${JSON.stringify(candidate)}\n`);
  expect(() => readManifest(path)).toThrow();
}

describe("manifest commands", () => {
  test("initializes and adds stations", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-manifest-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");

    const path = manifestInit();
    expect(path).toContain("stations.json");
    expect(readManifest().stations).toHaveLength(0);

    const updated = manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "~/workspace",
    });

    expect(updated.stations).toHaveLength(1);
    expect(updated.stations[0]?.id).toBe("demo-node-01");
    expect(updated.stations[0]?.updatedAt).toBeDefined();
  });

  test("persists friendly names without changing stable machine ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-friendly-name-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      friendlyName: "  Studio Linux  ",
      platform: "linux",
      workspacePath: "~/workspace",
      updatedAt: "2026-06-09T10:00:00.000Z",
    });

    expect(readManifest().stations[0]).toMatchObject({
      id: "demo-node-01",
      friendlyName: "Studio Linux",
      updatedAt: "2026-06-09T10:00:00.000Z",
    });
    expect(manifestGetFriendlyName("demo-node-01")).toMatchObject({
      machine_id: "demo-node-01",
      friendly_name: "Studio Linux",
      display_name: "Studio Linux",
    });

    const set = manifestSetFriendlyName({ machineId: "demo-node-01", friendlyName: "Notes Rig" });
    expect(set).toMatchObject({
      machine_id: "demo-node-01",
      friendly_name: "Notes Rig",
      display_name: "Notes Rig",
    });
    expect(readManifest().stations[0]?.id).toBe("demo-node-01");

    const cleared = manifestClearFriendlyName({ machineId: "demo-node-01" });
    expect(cleared).toMatchObject({
      machine_id: "demo-node-01",
      friendly_name: null,
      display_name: "demo-node-01",
    });
    expect(readManifest().stations[0]?.friendlyName).toBeUndefined();
  });

  test("bootstraps and removes the current machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-bootstrap-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-controller-03";

    manifestInit();
    const bootstrapped = manifestBootstrapCurrentMachine();
    expect(bootstrapped.stations).toHaveLength(1);
    expect(bootstrapped.stations[0]?.id).toBe("demo-controller-03");

    const trimmed = manifestRemove("demo-controller-03");
    expect(trimmed.stations).toHaveLength(0);
  });

  test("detects current machine defaults and validates manifest", () => {
    const detected = detectCurrentMachineManifest();
    expect(detected.id.length).toBeGreaterThan(0);
    expect(detected.workspacePath.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "stations-validate-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    manifestInit();
    expect(manifestValidate().version).toBe(1);
  });

  test("migrates legacy top-level heartbeat aliases at the manifest read boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-legacy-heartbeat-aliases-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      stations: [{
        id: "legacy-node",
        platform: "linux",
        workspacePath: "/srv/legacy",
        heartbeatAliases: ["legacy-host"],
      }],
    }), "utf8");

    const manifest = readManifest(path);

    expect(manifest.stations[0]?.metadata).toMatchObject({ heartbeatAliases: ["legacy-host"] });
    expect((manifest.stations[0] as Record<string, unknown>).heartbeatAliases).toBeUndefined();
  });

  test("accepts canonical machine ids with legacy aliases and resolves either identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-manifest-machine-aliases-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      stations: [{
        id: "station03",
        friendlyName: "station03",
        aliases: ["apple03", "legacy-apple03"],
        platform: "linux",
        workspacePath: "/srv/station03",
      }],
    }), "utf8");

    const manifest = readManifest(path);

    expect(manifest.stations[0]?.id).toBe("station03");
    expect(manifest.stations[0]?.aliases).toEqual(["apple03", "legacy-apple03"]);
    expect(getManifestMachine("station03", path)?.id).toBe("station03");
    expect(getManifestMachine("apple03", path)?.id).toBe("station03");
    expect(getManifestMachine("legacy-apple03", path)?.id).toBe("station03");
  });

  test("rejects ids and aliases that collide across the fleet", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-manifest-machine-alias-collision-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      stations: [
        { id: "station03", aliases: ["apple03"], platform: "linux", workspacePath: "/srv/station03" },
        { id: "station04", aliases: ["apple03"], platform: "linux", workspacePath: "/srv/station04" },
      ],
    }), "utf8");

    expect(() => readManifest(path)).toThrow(/machine alias apple03|duplicate machine identity apple03/i);
  });

  test("does not broaden legacy migration to unrelated unknown machine keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-legacy-heartbeat-unknown-key-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      stations: [{
        id: "legacy-node",
        platform: "linux",
        workspacePath: "/srv/legacy",
        heartbeatAliases: ["legacy-host"],
        unrelatedLegacyKey: true,
      }],
    }), "utf8");

    expect(() => readManifest(path)).toThrow();
  });

  test("keeps private manifest refs opaque and falls back to local files without an adapter", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-private-manifest-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      stations: [{ id: "demo-node-01", platform: "linux", workspacePath: "/home/operator/workspace" }],
    }), "utf8");

    const source = getManifestSourceRef({
      path,
      privateRef: "vault://private-fleet/prod/operator-hosts",
    });
    expect(source).toMatchObject({
      kind: "private-ref",
      ref: "vault://<redacted>",
      backend: "vault",
      private: true,
      publicSafe: true,
    });
    expect(JSON.stringify(source)).not.toContain("private-fleet");
    expect(JSON.stringify(source)).not.toContain("operator-hosts");

    const loaded = readManifestWithSource({
      path,
      privateRef: "vault://private-fleet/prod/operator-hosts",
    });
    expect(loaded.manifest.stations[0]?.id).toBe("demo-node-01");
    expect(loaded.info.loadedFrom).toBe("fallback");
    expect(loaded.info.warnings).toContain("private_manifest_ref_without_adapter");
    expect(JSON.stringify(loaded.info)).not.toContain("private-fleet");
    expect(JSON.stringify(loaded.info)).not.toContain("operator-hosts");
  });

  test("loads private manifest refs through an optional backend-agnostic adapter", () => {
    const adapter: ManifestSourceAdapter = {
      id: "fixture",
      readManifest: ({ source, rawRef }) => {
        expect(source.ref).toBe("fixture:<redacted>");
        expect(rawRef).toBe("fixture:tenant/prod");
        return {
          version: 1,
          stations: [{ id: "adapter-node", platform: "linux", workspacePath: "/workspace" }],
        };
      },
    };

    const loaded = readManifestWithSource({
      privateRef: "fixture:tenant/prod",
      adapter,
    });
    expect(loaded.info.loadedFrom).toBe("private-ref");
    expect(loaded.info.warnings).toEqual([]);
    expect(loaded.manifest.stations[0]?.id).toBe("adapter-node");
    expect(JSON.stringify(loaded.info)).not.toContain("tenant/prod");
  });

  test("accepts the target-only exact Bun registry candidate", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-exact-manifest-valid-"));
    const path = join(dir, "stations.json");
    writeExactBunCandidate(path);
    const manifest = readManifest(path);
    expect(manifest.stations).toHaveLength(1);
    expect(manifest.stations[0]?.packages?.map((pkg) => [pkg.name, pkg.exactBunRegistry?.order])).toEqual([
      ["@hasnaxyz/infinity", 10],
      ["@hasnaxyz/factory", 20],
    ]);
  });

  test("rejects incompatible source, secret, Bun path, selector, policy, and fleet-wide exact delivery", () => {
    expectExactCandidateRejected((candidate) => {
      candidate.stations[0].packages[0].exactBunRegistry.source.sha256 = LEGACY_BUN_REGISTRY_SOURCE_SHA256;
    });
    expectExactCandidateRejected((candidate) => {
      candidate.stations[0].packages[0].exactBunRegistry.secretRefs = ["hasna/npm/live/publish-token"];
    });
    expectExactCandidateRejected((candidate) => {
      candidate.stations[0].bunPath = "/usr/local/bin/node";
    });
    expectExactCandidateRejected((candidate) => {
      candidate.stations[0].packages[0].version = ">=1.0.12";
    });
    expectExactCandidateRejected((candidate) => {
      candidate.stations[0].packages[0].exactBunRegistry.quarantine.exactExclusions = ["@hasnaxyz/infinity"];
    });
    expectExactCandidateRejected((candidate) => {
      candidate.packages = [candidate.stations[0].packages[0]];
      candidate.stations[0].packages = [candidate.stations[0].packages[1]];
    });
  });
});
