import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  Config,
  ExportManifestV1,
  InstructionsDomainArchiveCounts,
  InstructionsDomainArchiveManifestV2,
  InstructionsDomainArchiveV2,
  ProfileAssetBindingSpec,
} from "../types/index.js";
import { INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA } from "../types/index.js";
import { resolveConfigStore, type ConfigStore } from "../data/config-store.js";
import {
  canonicalDomainJson,
  collectInstructionsDomain,
  computeDomainIntegrity,
  computeRestorableDomainIntegrity,
  validateInstructionsDomainArchive,
} from "./export.js";

export type ImportConflict = "skip" | "overwrite" | "version";

export interface ImportOptions {
  conflict?: ImportConflict;
  store?: ConfigStore;
}

interface MutationCounts {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportDomainCounts {
  configs: MutationCounts;
  config_snapshots: Pick<MutationCounts, "created" | "skipped">;
  profiles: MutationCounts;
  profile_config_bindings: MutationCounts;
  profile_asset_bindings: MutationCounts;
  machines: MutationCounts;
}

export interface ImportResult {
  /** Legacy config-only summary fields retained for CLI/API compatibility. */
  created: number;
  updated: number;
  skipped: number;
  counts: ImportDomainCounts;
  errors: string[];
  integrity: InstructionsDomainArchiveManifestV2["integrity"] | null;
}

interface ArchiveReader {
  members: Map<string, string>;
  read(member: string): Promise<string>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyMutationCounts(): MutationCounts {
  return { created: 0, updated: 0, skipped: 0 };
}

function emptyResult(): ImportResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    counts: {
      configs: emptyMutationCounts(),
      config_snapshots: { created: 0, skipped: 0 },
      profiles: emptyMutationCounts(),
      profile_config_bindings: emptyMutationCounts(),
      profile_asset_bindings: emptyMutationCounts(),
      machines: emptyMutationCounts(),
    },
    errors: [],
    integrity: null,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMemberName(name: string): string {
  let normalized = name;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Invalid archive member path: ${JSON.stringify(name)}`);
  }
  return normalized;
}

async function openArchive(path: string): Promise<ArchiveReader> {
  const list = Bun.spawn(["tar", "tzf", path], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    list.exited,
    new Response(list.stdout).text(),
    new Response(list.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`tar listing failed: ${stderr.trim()}`);

  const members = new Map<string, string>();
  for (const raw of stdout.split("\n").filter(Boolean)) {
    const normalized = normalizeMemberName(raw);
    if (normalized.length === 0) continue;
    if (members.has(normalized)) throw new Error(`Invalid archive: duplicate member ${normalized}`);
    members.set(normalized, raw);
  }

  return {
    members,
    async read(member: string): Promise<string> {
      const actual = members.get(member);
      if (!actual) throw new Error(`Invalid archive: missing ${member}`);
      // Stream a named member to stdout instead of extracting any untrusted path
      // onto the filesystem. This makes traversal and symlink entries inert.
      const proc = Bun.spawn(["tar", "xOzf", path, "--", actual], { stdout: "pipe", stderr: "pipe" });
      const [code, content, memberError] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`tar read failed for ${member}: ${memberError.trim()}`);
      return content;
    },
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    ((error as { name?: unknown }).name === "ConfigNotFoundError" ||
      (error as { name?: unknown }).name === "ProfileNotFoundError" ||
      (error as { status?: unknown }).status === 404),
  );
}

async function findConfig(store: ConfigStore, slug: string): Promise<Config | null> {
  try {
    return await store.getConfig(slug);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function verifyCounts(actual: InstructionsDomainArchiveCounts, expected: InstructionsDomainArchiveCounts): void {
  if (canonicalDomainJson(actual) !== canonicalDomainJson(expected)) {
    throw new Error("Archive integrity failure: manifest counts do not match the domain payload");
  }
}

async function readV2(reader: ArchiveReader, manifest: InstructionsDomainArchiveManifestV2): Promise<InstructionsDomainArchiveV2> {
  if (
    manifest.schema !== INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA ||
    manifest.version !== "2.0.0" ||
    manifest.payload?.path !== "domain.json" ||
    manifest.integrity?.algorithm !== "sha256" ||
    manifest.integrity?.canonicalization !== "hasna.instructions.logical-json/v1"
  ) {
    throw new Error("Invalid v2 archive manifest");
  }
  const payload = await reader.read("domain.json");
  if (Buffer.byteLength(payload) !== manifest.payload.size_bytes || sha256(payload) !== manifest.payload.sha256) {
    throw new Error("Archive integrity failure: domain payload hash or size does not match the manifest");
  }
  const domain = validateInstructionsDomainArchive(JSON.parse(payload));
  const actual = computeDomainIntegrity(domain);
  verifyCounts(actual.counts, manifest.integrity.counts);
  if (canonicalDomainJson(actual) !== canonicalDomainJson(manifest.integrity)) {
    throw new Error("Archive integrity failure: logical domain hashes do not match the manifest");
  }
  return domain;
}

function configInput(config: Config, content: string) {
  return {
    name: config.name,
    kind: config.kind,
    category: config.category,
    agent: config.agent,
    target_path: config.target_path,
    outputs: config.outputs,
    format: config.format,
    content,
    description: config.description ?? undefined,
    tags: config.tags,
    is_template: config.is_template,
  };
}

async function restoreNewConfig(store: ConfigStore, archived: Config, domain: InstructionsDomainArchiveV2): Promise<Config> {
  const snapshots = domain.config_snapshots
    .filter((row) => row.config_slug === archived.slug)
    .sort((left, right) => left.version - right.version || compareText(left.content, right.content) || compareText(left.id, right.id));

  // ConfigStore increments versions through updateConfig and automatically
  // snapshots those writes. Advance the config to its archived current version
  // first, then remove that synthetic history and recreate every archived
  // physical snapshot logically. This preserves sparse histories, multiple rows
  // at one version, divergent duplicate contents, and histories with no row for
  // the current config version.
  let restored = await store.createConfig(configInput(archived, archived.content));
  for (let version = 2; version <= archived.version; version++) {
    restored = await store.updateConfig(restored.id, {
      content: archived.content,
      ...(version === archived.version ? {
        name: archived.name,
        kind: archived.kind,
        category: archived.category,
        agent: archived.agent,
        target_path: archived.target_path,
        outputs: archived.outputs,
        format: archived.format,
        description: archived.description,
        tags: archived.tags,
        is_template: archived.is_template,
        synced_at: archived.synced_at,
      } : {}),
    });
  }
  await store.pruneSnapshots(restored.id, 0);
  for (const snapshot of snapshots) {
    await store.createSnapshot(restored.id, snapshot.content, snapshot.version);
  }
  const restoredSnapshots = (await store.listSnapshots(restored.id))
    .map(({ version, content: snapshotContent }) => ({ version, content: snapshotContent }))
    .sort((left, right) => left.version - right.version || compareText(left.content, right.content));
  const expectedSnapshots = snapshots
    .map(({ version, content: snapshotContent }) => ({ version, content: snapshotContent }))
    .sort((left, right) => left.version - right.version || compareText(left.content, right.content));
  if (
    restored.version !== archived.version ||
    restored.content !== archived.content ||
    canonicalDomainJson(restoredSnapshots) !== canonicalDomainJson(expectedSnapshots)
  ) {
    throw new Error(`restored config or snapshot history did not match archive for ${archived.slug}`);
  }
  return restored;
}

function rewriteAssetLocator(binding: ProfileAssetBindingSpec, archivedSourceId: string, restoredSourceId: string): ProfileAssetBindingSpec {
  const match = /^config:\/\/([^@]+)@(\d+)$/.exec(binding.source.locator);
  if (!match) return binding;
  let locatorId: string;
  try {
    locatorId = decodeURIComponent(match[1]!);
  } catch {
    return binding;
  }
  if (locatorId !== archivedSourceId) return binding;
  return {
    ...binding,
    source: {
      ...binding.source,
      locator: `config://${encodeURIComponent(restoredSourceId)}@${match[2]}`,
    },
  };
}

async function assertEmptyV2Destination(store: ConfigStore): Promise<void> {
  const [configs, profiles, machines] = await Promise.all([
    store.listConfigs(),
    store.listProfiles(),
    store.listMachines(),
  ]);
  if (configs.length > 0 || profiles.length > 0 || machines.length > 0) {
    throw new Error(
      `Instructions domain archive v2 recovery requires an empty destination ` +
      `(found configs=${configs.length}, profiles=${profiles.length}, machines=${machines.length})`,
    );
  }
}

async function importV2(
  domain: InstructionsDomainArchiveV2,
  manifest: InstructionsDomainArchiveManifestV2,
  store: ConfigStore,
  conflict: ImportConflict,
): Promise<ImportResult> {
  // V2 is a recovery archive, not a merge format. Reject conflict modes before
  // even reading destination state so the removed partial-overwrite path can
  // never mutate a live or previously attempted restore.
  if (conflict !== "skip") {
    throw new Error(`Instructions domain archive v2 does not support ${conflict}; restore into an empty destination`);
  }
  await assertEmptyV2Destination(store);

  const result = emptyResult();
  result.integrity = manifest.integrity;
  const configMap = new Map<string, Config>();

  for (const archived of domain.configs) {
    const restored = await restoreNewConfig(store, archived, domain);
    configMap.set(archived.slug, restored);
    result.counts.configs.created++;
    result.created++;
    result.counts.config_snapshots.created += domain.config_snapshots.filter(
      (row) => row.config_slug === archived.slug,
    ).length;
  }

  const profileMap = new Map<string, Awaited<ReturnType<ConfigStore["getProfile"]>>>();
  for (const archived of domain.profiles) {
    const created = await store.createProfile({
      name: archived.name,
      description: archived.description ?? undefined,
      selectors: archived.selectors,
      variables: archived.variables,
    });
    profileMap.set(archived.slug, created);
    result.counts.profiles.created++;
  }

  for (const archived of domain.profiles) {
    const restoredProfile = profileMap.get(archived.slug);
    if (!restoredProfile) throw new Error(`post-create profile mapping missing for ${archived.slug}`);
    const archivedMembership = domain.profile_config_bindings
      .filter((row) => row.profile_slug === archived.slug)
      .sort((left, right) => left.sort_order - right.sort_order || compareText(left.config_slug, right.config_slug));
    const archivedAssets = domain.profile_asset_bindings
      .filter((row) => row.profile_slug === archived.slug)
      .sort((left, right) => left.sort_order - right.sort_order || compareText(left.binding.assetKey, right.binding.assetKey));

    for (const row of archivedMembership) {
      const config = configMap.get(row.config_slug);
      if (!config) throw new Error(`missing restored config ${row.config_slug}`);
      await store.addConfigToProfile(restoredProfile.id, config.id);
      await store.setProfileConfigBinding(restoredProfile.id, config.id, row.binding);
      result.counts.profile_config_bindings.created++;
    }
    for (const row of archivedAssets) {
      const source = configMap.get(row.source_config_slug);
      const archivedSource = domain.configs.find((config) => config.slug === row.source_config_slug);
      if (!source || !archivedSource) throw new Error(`missing restored asset source ${row.source_config_slug}`);
      await store.addAssetToProfile(
        restoredProfile.id,
        source.id,
        rewriteAssetLocator(row.binding, archivedSource.id, source.id),
      );
      result.counts.profile_asset_bindings.created++;
    }
  }

  for (const archived of domain.machines) {
    const restored = await store.registerMachine(archived.hostname, archived.os ?? undefined, archived.arch ?? undefined);
    if (archived.last_applied_at !== null) await store.updateMachineApplied(restored.hostname);
    result.counts.machines.created++;
  }

  // ConfigStore deliberately does not expose setters for operational
  // timestamps. Verify every portable field, snapshot/version, relationship,
  // machine identity and applied/null state through a fresh readback. A
  // mismatch taints this attempted destination and fails the command.
  const restoredDomain = await collectInstructionsDomain({ store });
  const expected = computeRestorableDomainIntegrity(domain);
  const actual = computeRestorableDomainIntegrity(restoredDomain);
  if (canonicalDomainJson(actual) !== canonicalDomainJson(expected)) {
    throw new Error(
      `Post-restore logical integrity verification failed: expected ${expected.domain_sha256}, got ${actual.domain_sha256}`,
    );
  }

  return result;
}

async function importV1(
  reader: ArchiveReader,
  manifest: ExportManifestV1,
  store: ConfigStore,
  conflict: ImportConflict,
): Promise<ImportResult> {
  const result = emptyResult();
  if (!Array.isArray(manifest.configs)) throw new Error("Invalid v1 bundle: configs must be an array");
  for (const meta of manifest.configs) {
    const ext = meta.format === "text" ? "txt" : meta.format;
    const contentPath = `contents/${meta.slug}.${ext}`;
    const content = reader.members.has(contentPath) ? await reader.read(contentPath) : "";
    const existing = await findConfig(store, meta.slug);
    if (existing) {
      if (conflict === "skip") {
        result.skipped++;
        result.counts.configs.skipped++;
      } else {
        await store.updateConfig(existing.id, {
          name: meta.name,
          kind: meta.kind,
          category: meta.category,
          agent: meta.agent,
          target_path: meta.target_path,
          outputs: meta.outputs,
          format: meta.format,
          content,
          description: meta.description,
          tags: meta.tags,
          is_template: meta.is_template,
          synced_at: meta.synced_at,
        });
        result.updated++;
        result.counts.configs.updated++;
      }
    } else {
      await store.createConfig(configInput({ ...meta, content }, content));
      result.created++;
      result.counts.configs.created++;
    }
  }
  return result;
}

export async function importConfigs(
  bundlePath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const store = opts.store ?? resolveConfigStore();
  const conflict = opts.conflict ?? "skip";
  const reader = await openArchive(resolve(bundlePath));
  const manifestText = await reader.read("manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("Invalid bundle: manifest.json is not valid JSON");
  }
  if (!manifest || typeof manifest !== "object" || typeof (manifest as { version?: unknown }).version !== "string") {
    throw new Error("Invalid bundle: manifest version is missing");
  }
  if ((manifest as { version: string }).version === "2.0.0") {
    const v2 = manifest as InstructionsDomainArchiveManifestV2;
    const domain = await readV2(reader, v2);
    return importV2(domain, v2, store, conflict);
  }
  if ((manifest as { version: string }).version.startsWith("1.")) {
    return importV1(reader, manifest as ExportManifestV1, store, conflict);
  }
  throw new Error(`Unsupported Instructions archive version: ${(manifest as { version: string }).version}`);
}
