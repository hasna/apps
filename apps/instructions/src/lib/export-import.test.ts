import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocalConfigStore, type ConfigStore } from "../data/config-store";
import { getDatabase, resetDatabase } from "../db/database";
import { configAssetDigest, configAssetLocator } from "./asset-plan";
import { computeDomainIntegrity, computeRestorableDomainIntegrity, exportConfigs } from "./export";
import { importConfigs } from "./import";
import { tempRootPath } from "./test-temp-root";
import {
  PROFILE_ASSET_BINDING_SCHEMA,
  PROFILE_CONFIG_BINDING_SCHEMA,
  type InstructionsDomainArchiveManifestV2,
  type InstructionsDomainArchiveV2,
  type ProfileAssetBindingSpec,
  type ProfileConfigBindingSpec,
} from "../types/index";

let tmpDir: string;
let db: Database;
let store: LocalConfigStore;

beforeEach(() => {
  resetDatabase();
  process.env["HASNA_INSTRUCTIONS_DB_PATH"] = ":memory:";
  tmpDir = tempRootPath(`instructions-domain-archive-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  db = getDatabase(":memory:");
  store = new LocalConfigStore(db);
});

afterEach(() => {
  resetDatabase();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["HASNA_INSTRUCTIONS_DB_PATH"];
});

async function tarStdout(archive: string, member: string): Promise<string> {
  for (const candidate of [member, `./${member}`]) {
    const proc = Bun.spawn(["tar", "xOzf", archive, candidate], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (exitCode === 0) return stdout;
  }
  throw new Error(`Archive member not found: ${member}`);
}

async function readV2Archive(path: string): Promise<{
  manifest: InstructionsDomainArchiveManifestV2;
  domain: InstructionsDomainArchiveV2;
}> {
  return {
    manifest: JSON.parse(await tarStdout(path, "manifest.json")),
    domain: JSON.parse(await tarStdout(path, "domain.json")),
  };
}

async function makeV1Archive(path: string): Promise<void> {
  const root = join(tmpDir, "v1");
  mkdirSync(join(root, "contents"), { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    version: "1.0.0",
    exported_at: "2026-09-16T00:00:00.000Z",
    configs: [{
      id: "legacy-id",
      name: "Legacy rule",
      slug: "legacy-rule",
      kind: "file",
      category: "rules",
      agent: "global",
      target_path: null,
      outputs: [],
      format: "markdown",
      description: "from v1",
      tags: ["legacy"],
      is_template: false,
      version: 1,
      created_at: "2026-09-16T00:00:00.000Z",
      updated_at: "2026-09-16T00:00:00.000Z",
      synced_at: null,
    }],
  }));
  writeFileSync(join(root, "contents", "legacy-rule.markdown"), "# Legacy\n");
  const proc = Bun.spawn(["tar", "czf", path, "-C", root, "."], { stderr: "pipe" });
  expect(await proc.exited).toBe(0);
}

function configBinding(glob: string): ProfileConfigBindingSpec {
  return {
    schema: PROFILE_CONFIG_BINDING_SCHEMA,
    activation: { mode: "glob", globs: [glob], directory_scope: "src" },
    required: true,
    fallback: "fail",
    providers: [{ provider: "codex", version_range: ">=1" }],
    depends_on: [],
    replaces: [],
    conflicts_with: [],
  };
}

function assetBinding(configId: string, version: number, content: string): ProfileAssetBindingSpec {
  return {
    schema: PROFILE_ASSET_BINDING_SCHEMA,
    assetKey: "review-skill",
    kind: "skill",
    enabled: true,
    required: true,
    selector: { provider: "codex", versionRange: ">=1", surface: "cli", scope: "session" },
    source: {
      kind: "skill",
      locator: configAssetLocator(configId, version),
      digest: configAssetDigest(content),
      immutable: true,
      allowed: true,
    },
    destination: { strategy: "emit-file", root: "target-home", relativePath: "skills/review/SKILL.md" },
    uninstall: "remove-managed",
    rollback: "snapshot",
  };
}

async function seedCompleteDomain(target: LocalConfigStore): Promise<void> {
  const rule = await target.createConfig({
    name: "Core rule",
    category: "rules",
    agent: "codex",
    format: "markdown",
    content: "# Rule v1\n",
    description: "canonical rule",
    tags: ["core", "safe"],
  });
  await target.updateConfig(rule.id, { content: "# Rule v2\n" });
  const asset = await target.createConfig({
    name: "Review skill source",
    category: "tools",
    agent: "codex",
    format: "markdown",
    content: "# Review skill\n",
  });
  const profile = await target.createProfile({
    name: "Developer",
    description: "developer profile",
    selectors: { os: ["Darwin"], hostnames: ["station06"] },
    variables: { WORKSPACE: "/workspace" },
  });

  // Deliberately add the asset source first so membership order is observable.
  await target.addConfigToProfile(profile.id, asset.id);
  await target.setProfileConfigBinding(profile.id, asset.id, configBinding("skills/**"));
  await target.addConfigToProfile(profile.id, rule.id);
  await target.setProfileConfigBinding(profile.id, rule.id, configBinding("src/**"));
  await target.addAssetToProfile(profile.id, asset.id, assetBinding(asset.id, asset.version, asset.content));
  await target.registerMachine("station06", "Darwin", "arm64");
  await target.updateMachineApplied("station06");
}

describe("Instructions domain archive v2", () => {
  test("exports the complete configuration domain with deterministic, content-safe integrity metadata", async () => {
    await seedCompleteDomain(store);
    const firstPath = join(tmpDir, "domain-first.tar.gz");
    const secondPath = join(tmpDir, "domain-second.tar.gz");

    const first = await exportConfigs(firstPath, { store });
    const second = await exportConfigs(secondPath, { store });
    const a = await readV2Archive(firstPath);
    const b = await readV2Archive(secondPath);

    expect(first.count).toBe(2);
    expect(first.counts).toEqual({
      configs: 2,
      config_snapshots: 3,
      profiles: 1,
      profile_config_bindings: 2,
      profile_asset_bindings: 1,
      machines: 1,
    });
    expect(a.manifest.version).toBe("2.0.0");
    expect(a.manifest.payload.path).toBe("domain.json");
    expect(a.manifest.payload.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.manifest.integrity.domain_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.manifest.integrity).toEqual(b.manifest.integrity);
    expect(a.manifest.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "api_keys", classification: "security_state" }),
      expect.objectContaining({ entity: "idempotency_receipts", classification: "transport_state" }),
      expect.objectContaining({ entity: "feedback", classification: "out_of_domain" }),
    ]));

    expect(a.domain.configs.map((config) => config.content)).toEqual(expect.arrayContaining(["# Rule v2\n", "# Review skill\n"]));
    expect(a.domain.config_snapshots.map((snapshot) => [snapshot.config_slug, snapshot.version, snapshot.content])).toEqual(expect.arrayContaining([
      ["core-rule", 1, "# Rule v1\n"],
      ["core-rule", 2, "# Rule v2\n"],
    ]));
    expect(a.domain.profiles).toHaveLength(1);
    expect(a.domain.profile_config_bindings.map((binding) => [binding.profile_slug, binding.config_slug, binding.sort_order])).toEqual([
      ["developer", "review-skill-source", 0],
      ["developer", "core-rule", 1],
    ]);
    expect(a.domain.profile_asset_bindings[0]).toMatchObject({
      profile_slug: "developer",
      source_config_slug: "review-skill-source",
      sort_order: 0,
      binding: { assetKey: "review-skill" },
    });
    expect(a.domain.machines[0]).toMatchObject({ hostname: "station06", os: "Darwin", arch: "arm64" });

    // The deployment-facing manifest contains only counts and hashes, never domain content.
    const manifestText = await tarStdout(firstPath, "manifest.json");
    expect(manifestText).not.toContain("# Rule v2");
    expect(manifestText).not.toContain("/workspace");
    expect(readFileSync(firstPath).includes(Buffer.from("# Rule v2"))).toBe(false); // gzip payload is not log-readable plaintext
    expect(second.counts).toEqual(first.counts);
  });

  test("rejects an internally inconsistent concurrent snapshot before writing an archive", async () => {
    const config = await store.createConfig({
      name: "Concurrent rule",
      category: "rules",
      content: "# Version 1\n",
    });
    const outputPath = join(tmpDir, "inconsistent.tar.gz");
    let mutated = false;
    const concurrentlyUpdated = new Proxy(store as ConfigStore, {
      get(target, property, receiver) {
        if (property === "listSnapshots") {
          return async (configId: string) => {
            if (!mutated) {
              mutated = true;
              await target.updateConfig(config.id, { content: "# Version 2\n" });
            }
            return target.listSnapshots(configId);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(exportConfigs(outputPath, { store: concurrentlyUpdated })).rejects.toThrow(
      /invalid snapshot version|contiguous suffix ending at version/i,
    );
    expect(mutated).toBe(true);
    expect(existsSync(outputPath)).toBe(false);
  });

  test("restores configs, every snapshot, profiles, ordered bindings, assets, and machines using logical mappings", async () => {
    await seedCompleteDomain(store);
    const sourcePath = join(tmpDir, "complete.tar.gz");
    const sourceExport = await exportConfigs(sourcePath, { store });

    resetDatabase();
    const destinationDb = getDatabase(":memory:");
    const destination = new LocalConfigStore(destinationDb);
    const restored = await importConfigs(sourcePath, { store: destination });

    expect(restored.errors).toEqual([]);
    expect(restored.created).toBe(2);
    expect(restored.counts).toEqual({
      configs: { created: 2, updated: 0, skipped: 0 },
      config_snapshots: { created: 3, skipped: 0 },
      profiles: { created: 1, updated: 0, skipped: 0 },
      profile_config_bindings: { created: 2, updated: 0, skipped: 0 },
      profile_asset_bindings: { created: 1, updated: 0, skipped: 0 },
      machines: { created: 1, updated: 0, skipped: 0 },
    });

    const restoredRule = await destination.getConfig("core-rule");
    expect(restoredRule).toMatchObject({ content: "# Rule v2\n", version: 2, description: "canonical rule", tags: ["core", "safe"] });
    expect((await destination.listSnapshots(restoredRule.id)).map(({ version, content }) => ({ version, content }))).toEqual([
      { version: 2, content: "# Rule v2\n" },
      { version: 1, content: "# Rule v1\n" },
    ]);

    const restoredProfile = await destination.getProfile("developer");
    expect(restoredProfile).toMatchObject({ variables: { WORKSPACE: "/workspace" }, selectors: { os: ["Darwin"], hostnames: ["station06"] } });
    const membership = await destination.getProfileConfigBindings(restoredProfile.id);
    expect(membership.map((binding) => [binding.sort_order, binding.binding.activation])).toEqual([
      [0, { mode: "glob", globs: ["skills/**"], directory_scope: "src" }],
      [1, { mode: "glob", globs: ["src/**"], directory_scope: "src" }],
    ]);
    const restoredAssetSource = await destination.getConfig("review-skill-source");
    const assets = await destination.getProfileAssetBindings(restoredProfile.id);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.source_config_id).toBe(restoredAssetSource.id);
    expect(assets[0]!.binding.source.locator).toBe(configAssetLocator(restoredAssetSource.id, restoredAssetSource.version));
    expect(await destination.listMachines()).toEqual([
      expect.objectContaining({ hostname: "station06", os: "Darwin", arch: "arm64", last_applied_at: expect.any(String) }),
    ]);

    const restoredPath = join(tmpDir, "restored.tar.gz");
    const postExport = await exportConfigs(restoredPath, { store: destination });
    const sourceArchive = await readV2Archive(sourcePath);
    const restoredArchive = await readV2Archive(restoredPath);
    expect(postExport.counts).toEqual(sourceExport.counts);
    expect(computeRestorableDomainIntegrity(restoredArchive.domain)).toEqual(
      computeRestorableDomainIntegrity(sourceArchive.domain),
    );
    // ConfigStore does not expose setters for creation/update/snapshot/machine
    // timestamps, so exact operational timestamp integrity is archive evidence,
    // not a promise that a restore can reproduce those timestamps.
    expect(restoredArchive.manifest.integrity).not.toEqual(sourceArchive.manifest.integrity);
  });

  test("includes every archived operational timestamp in exact deployment integrity", async () => {
    await seedCompleteDomain(store);
    const archivePath = join(tmpDir, "timestamps.tar.gz");
    await exportConfigs(archivePath, { store });
    const { domain } = await readV2Archive(archivePath);
    const baseline = computeDomainIntegrity(domain).domain_sha256;
    const timestampMutations: Array<(copy: InstructionsDomainArchiveV2) => void> = [
      (copy) => { copy.configs[0]!.created_at = "2001-01-01T00:00:00.000Z"; },
      (copy) => { copy.configs[0]!.updated_at = "2001-01-02T00:00:00.000Z"; },
      (copy) => { copy.configs[0]!.synced_at = "2001-01-03T00:00:00.000Z"; },
      (copy) => { copy.config_snapshots[0]!.created_at = "2001-01-04T00:00:00.000Z"; },
      (copy) => { copy.profiles[0]!.created_at = "2001-01-05T00:00:00.000Z"; },
      (copy) => { copy.profiles[0]!.updated_at = "2001-01-06T00:00:00.000Z"; },
      (copy) => { copy.machines[0]!.created_at = "2001-01-07T00:00:00.000Z"; },
      (copy) => { copy.machines[0]!.last_applied_at = "2001-01-08T00:00:00.000Z"; },
    ];
    for (const mutate of timestampMutations) {
      const copy = structuredClone(domain);
      mutate(copy);
      expect(computeDomainIntegrity(copy).domain_sha256).not.toBe(baseline);
    }
  });

  test("rejects v2 restore into a non-empty destination and rejects overwrite before mutation", async () => {
    await seedCompleteDomain(store);
    const archivePath = join(tmpDir, "recovery.tar.gz");
    await exportConfigs(archivePath, { store });

    resetDatabase();
    const destination = new LocalConfigStore(getDatabase(":memory:"));
    const existing = await destination.createConfig({ name: "Protected", category: "rules", content: "destination bytes" });
    const before = await destination.listConfigs();

    await expect(importConfigs(archivePath, { store: destination })).rejects.toThrow(/empty destination/i);
    await expect(importConfigs(archivePath, { store: destination, conflict: "overwrite" })).rejects.toThrow(/overwrite.*v2|v2.*overwrite/i);
    expect(await destination.listConfigs()).toEqual(before);
    expect((await destination.getConfig(existing.id)).content).toBe("destination bytes");
    expect(await destination.listProfiles()).toEqual([]);
    expect(await destination.listMachines()).toEqual([]);
  });

  test("CLI exits nonzero instead of reporting success for a rejected v2 recovery", async () => {
    await seedCompleteDomain(store);
    const archivePath = join(tmpDir, "cli-recovery.tar.gz");
    await exportConfigs(archivePath, { store });
    const env = { ...process.env };
    for (const key of [
      "HASNA_INSTRUCTIONS_API_URL",
      "HASNA_INSTRUCTIONS_API_KEY",
      "INSTRUCTIONS_API_URL",
      "INSTRUCTIONS_API_KEY",
      "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE",
      "HASNA_INSTRUCTIONS_API_KEY_REF",
      "HASNA_PROFILE",
    ]) delete env[key];
    env["HASNA_INSTRUCTIONS_LOCAL"] = "1";
    env["HASNA_INSTRUCTIONS_DB_PATH"] = join(tmpDir, "cli-destination.db");
    const proc = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "..", "cli", "index.tsx"),
      "import",
      archivePath,
      "--overwrite",
    ], { env, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain("Import complete");
    expect(stderr).toMatch(/v2 does not support overwrite/i);
  });

  test("throws instead of returning a successful result when a restore mutation fails", async () => {
    await seedCompleteDomain(store);
    const archivePath = join(tmpDir, "mutation-failure.tar.gz");
    await exportConfigs(archivePath, { store });

    resetDatabase();
    const destination = new LocalConfigStore(getDatabase(":memory:"));
    const failing = new Proxy(destination as ConfigStore, {
      get(target, property, receiver) {
        if (property === "createProfile") {
          return async () => { throw new Error("injected profile failure"); };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(importConfigs(archivePath, { store: failing })).rejects.toThrow(/injected profile failure/);
  });

  test("fails closed when post-restore ConfigStore readback differs from the archive", async () => {
    await seedCompleteDomain(store);
    const archivePath = join(tmpDir, "readback-failure.tar.gz");
    await exportConfigs(archivePath, { store });

    resetDatabase();
    const destination = new LocalConfigStore(getDatabase(":memory:"));
    let listCalls = 0;
    const corrupting = new Proxy(destination as ConfigStore, {
      get(target, property, receiver) {
        if (property === "listConfigs") {
          return async (...args: Parameters<ConfigStore["listConfigs"]>) => {
            const configs = await target.listConfigs(...args);
            listCalls++;
            return listCalls > 1 && configs[0]
              ? [{ ...configs[0], content: "corrupted after restore" }, ...configs.slice(1)]
              : configs;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(importConfigs(archivePath, { store: corrupting })).rejects.toThrow(/post-restore.*integrity/i);
  });

  test("rejects a tampered v2 payload before mutating the destination", async () => {
    await store.createConfig({ name: "Protected", category: "rules", content: "trusted" });
    const archivePath = join(tmpDir, "valid.tar.gz");
    await exportConfigs(archivePath, { store });

    const unpacked = join(tmpDir, "tampered");
    mkdirSync(unpacked);
    let proc = Bun.spawn(["tar", "xzf", archivePath, "-C", unpacked], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    const domainPath = join(unpacked, "domain.json");
    writeFileSync(domainPath, readFileSync(domainPath, "utf8").replace("trusted", "tampered"));
    const tamperedPath = join(tmpDir, "tampered.tar.gz");
    proc = Bun.spawn(["tar", "czf", tamperedPath, "-C", unpacked, "."], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);

    resetDatabase();
    const destination = new LocalConfigStore(getDatabase(":memory:"));
    await expect(importConfigs(tamperedPath, { store: destination })).rejects.toThrow(/integrity/i);
    expect(await destination.listConfigs()).toEqual([]);
  });

  test("preserves v1 config-only import compatibility", async () => {
    const archivePath = join(tmpDir, "legacy-v1.tar.gz");
    await makeV1Archive(archivePath);

    const result = await importConfigs(archivePath, { store });
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0, errors: [] });
    expect(await store.getConfig("legacy-rule")).toMatchObject({ content: "# Legacy\n", description: "from v1", tags: ["legacy"] });

    await store.updateConfig("legacy-rule", { content: "destination bytes" });
    const skipped = await importConfigs(archivePath, { store });
    expect(skipped).toMatchObject({ created: 0, updated: 0, skipped: 1, errors: [] });
    expect((await store.getConfig("legacy-rule")).content).toBe("destination bytes");

    const overwritten = await importConfigs(archivePath, { store, conflict: "overwrite" });
    expect(overwritten).toMatchObject({ created: 0, updated: 1, skipped: 0, errors: [] });
    expect((await store.getConfig("legacy-rule")).content).toBe("# Legacy\n");
  });
});
