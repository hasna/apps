import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type {
  Config,
  ConfigFilter,
  InstructionsDomainArchiveCounts,
  InstructionsDomainArchiveIntegrity,
  InstructionsDomainArchiveManifestV2,
  InstructionsDomainArchiveV2,
} from "../types/index.js";
import { INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA } from "../types/index.js";
import { resolveConfigStore, type ConfigStore } from "../data/config-store.js";

export interface ExportOptions {
  filter?: ConfigFilter;
  profileId?: string;
  store?: ConfigStore;
}

export interface ExportResult {
  path: string;
  count: number;
  counts: InstructionsDomainArchiveCounts;
  integrity: InstructionsDomainArchiveIntegrity;
}

const ARCHIVE_EXCLUSIONS: InstructionsDomainArchiveManifestV2["exclusions"] = [
  {
    entity: "api_keys",
    classification: "security_state",
    reason: "API credentials are security state and must be provisioned independently, never copied in a domain archive.",
  },
  {
    entity: "idempotency_receipts",
    classification: "transport_state",
    reason: "Request replay receipts are transport state and are not portable business-domain data.",
  },
  {
    entity: "feedback",
    classification: "out_of_domain",
    reason: "Feedback is product telemetry, not part of the Instructions configuration domain.",
  },
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalDomainJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function logicalAssetLocator(locator: string, idToSlug: Map<string, string>): string {
  const match = /^config:\/\/([^@]+)@(\d+)$/.exec(locator);
  if (!match) return locator;
  let configId: string;
  try {
    configId = decodeURIComponent(match[1]!);
  } catch {
    return locator;
  }
  const slug = idToSlug.get(configId);
  return slug ? `config-slug://${encodeURIComponent(slug)}@${match[2]}` : locator;
}

function logicalCollections(
  domain: InstructionsDomainArchiveV2,
  options: { includeOperationalTimestamps: boolean },
): Record<keyof InstructionsDomainArchiveCounts, unknown[]> {
  const configs = [...domain.configs].sort((left, right) => compareText(left.slug, right.slug));
  // Snapshot IDs are physical row identities. A restore intentionally assigns
  // fresh IDs, so the logical hash must order duplicate-version rows by the
  // fields that survive a restore. This keeps multiplicity and every divergent
  // content value in the integrity calculation without making the result
  // depend on newly generated IDs.
  const snapshots = domain.config_snapshots.map((snapshot) => ({
    config_slug: snapshot.config_slug,
    version: snapshot.version,
    content: snapshot.content,
    ...(options.includeOperationalTimestamps ? { created_at: snapshot.created_at } : {}),
  })).sort((left, right) =>
    compareText(left.config_slug, right.config_slug) ||
    left.version - right.version ||
    compareText(left.content, right.content) ||
    compareText("created_at" in left ? left.created_at ?? "" : "", "created_at" in right ? right.created_at ?? "" : ""));
  const profiles = [...domain.profiles].sort((left, right) => compareText(left.slug, right.slug));
  const configBindings = [...domain.profile_config_bindings].sort((left, right) =>
    compareText(left.profile_slug, right.profile_slug) || left.sort_order - right.sort_order || compareText(left.config_slug, right.config_slug));
  const assetBindings = [...domain.profile_asset_bindings].sort((left, right) =>
    compareText(left.profile_slug, right.profile_slug) || left.sort_order - right.sort_order || compareText(left.binding.assetKey, right.binding.assetKey));
  const machines = [...domain.machines].sort((left, right) => compareText(left.hostname, right.hostname));
  const idToSlug = new Map(configs.map((config) => [config.id, config.slug]));
  const configOrder = new Map<string, number>();
  const assetOrder = new Map<string, number>();
  return {
    configs: configs.map((config) => ({
      slug: config.slug,
      name: config.name,
      kind: config.kind,
      category: config.category,
      agent: config.agent,
      target_path: config.target_path,
      outputs: config.outputs,
      format: config.format,
      content: config.content,
      description: config.description,
      tags: [...config.tags].sort(compareText),
      is_template: config.is_template,
      version: config.version,
      ...(options.includeOperationalTimestamps ? {
        created_at: config.created_at,
        updated_at: config.updated_at,
        synced_at: config.synced_at,
      } : {}),
    })),
    config_snapshots: snapshots,
    profiles: profiles.map((profile) => ({
      slug: profile.slug,
      name: profile.name,
      description: profile.description,
      selectors: profile.selectors,
      variables: profile.variables,
      ...(options.includeOperationalTimestamps ? {
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      } : {}),
    })),
    profile_config_bindings: configBindings.map((row) => {
      const order = configOrder.get(row.profile_slug) ?? 0;
      configOrder.set(row.profile_slug, order + 1);
      return {
        profile_slug: row.profile_slug,
        config_slug: row.config_slug,
        order,
        binding: row.binding,
      };
    }),
    profile_asset_bindings: assetBindings.map((row) => {
      const order = assetOrder.get(row.profile_slug) ?? 0;
      assetOrder.set(row.profile_slug, order + 1);
      return {
        profile_slug: row.profile_slug,
        source_config_slug: row.source_config_slug,
        order,
        binding: {
          ...row.binding,
          source: {
            ...row.binding.source,
            locator: logicalAssetLocator(row.binding.source.locator, idToSlug),
          },
        },
      };
    }),
    machines: machines.map((machine) => ({
      hostname: machine.hostname,
      os: machine.os,
      arch: machine.arch,
      ...(options.includeOperationalTimestamps ? {
        created_at: machine.created_at,
        last_applied_at: machine.last_applied_at,
      } : {
        applied: machine.last_applied_at !== null,
      }),
    })),
  };
}

function computeIntegrity(
  domain: InstructionsDomainArchiveV2,
  options: { includeOperationalTimestamps: boolean; canonicalization: InstructionsDomainArchiveIntegrity["canonicalization"] },
): InstructionsDomainArchiveIntegrity {
  const collections = logicalCollections(domain, options);
  const counts: InstructionsDomainArchiveCounts = {
    configs: collections.configs.length,
    config_snapshots: collections.config_snapshots.length,
    profiles: collections.profiles.length,
    profile_config_bindings: collections.profile_config_bindings.length,
    profile_asset_bindings: collections.profile_asset_bindings.length,
    machines: collections.machines.length,
  };
  const hashes = {
    configs: sha256(canonicalDomainJson(collections.configs)),
    config_snapshots: sha256(canonicalDomainJson(collections.config_snapshots)),
    profiles: sha256(canonicalDomainJson(collections.profiles)),
    profile_config_bindings: sha256(canonicalDomainJson(collections.profile_config_bindings)),
    profile_asset_bindings: sha256(canonicalDomainJson(collections.profile_asset_bindings)),
    machines: sha256(canonicalDomainJson(collections.machines)),
  };
  return {
    algorithm: "sha256",
    canonicalization: options.canonicalization,
    counts,
    hashes,
    domain_sha256: sha256(canonicalDomainJson({ counts, hashes })),
  };
}

/**
 * Exact archive/deployment evidence. Every archived operational timestamp is
 * intentionally part of these hashes so an in-place migration cannot erase or
 * rewrite temporal state while retaining the same logical IDs and content.
 */
export function computeDomainIntegrity(domain: InstructionsDomainArchiveV2): InstructionsDomainArchiveIntegrity {
  return computeIntegrity(domain, {
    includeOperationalTimestamps: true,
    canonicalization: "hasna.instructions.logical-json/v1",
  });
}

/**
 * The strongest post-restore comparison exposed by ConfigStore. ConfigStore
 * can recreate domain content, versions, relationships and the applied/null
 * machine state, but it has no API for assigning archived creation/update,
 * snapshot, or exact machine-application timestamps.
 */
export function computeRestorableDomainIntegrity(domain: InstructionsDomainArchiveV2): InstructionsDomainArchiveIntegrity {
  return computeIntegrity(domain, {
    includeOperationalTimestamps: false,
    canonicalization: "hasna.instructions.restorable-logical-json/v1",
  });
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid v2 archive: ${label} must be an array`);
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) throw new Error(`Invalid v2 archive: duplicate or empty ${label} ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function assertTimestamp(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid v2 archive: ${label} must be ${nullable ? "null or " : ""}an ISO timestamp`);
  }
}

export function validateInstructionsDomainArchive(value: unknown): InstructionsDomainArchiveV2 {
  if (!value || typeof value !== "object") throw new Error("Invalid v2 archive: domain payload must be an object");
  const domain = value as Partial<InstructionsDomainArchiveV2>;
  if (domain.schema !== INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA) throw new Error("Invalid v2 archive: unsupported domain schema");
  assertArray(domain.configs, "configs");
  assertArray(domain.config_snapshots, "config_snapshots");
  assertArray(domain.profiles, "profiles");
  assertArray(domain.profile_config_bindings, "profile_config_bindings");
  assertArray(domain.profile_asset_bindings, "profile_asset_bindings");
  assertArray(domain.machines, "machines");

  const typed = domain as InstructionsDomainArchiveV2;
  assertUnique(typed.configs.map((row) => row.slug), "config slug");
  assertUnique(typed.profiles.map((row) => row.slug), "profile slug");
  assertUnique(typed.machines.map((row) => row.hostname), "machine hostname");
  // Legacy hosted data can contain more than one physical row for a logical
  // (config, version) pair, including rows with different content. Preserve
  // those rows as evidence. Only the physical snapshot ID must be unique.
  assertUnique(typed.config_snapshots.map((row) => row.id), "config snapshot id");
  assertUnique(typed.profile_config_bindings.map((row) => `${row.profile_slug}:${row.config_slug}`), "profile config binding");
  assertUnique(typed.profile_asset_bindings.map((row) => `${row.profile_slug}:${row.binding.assetKey}`), "profile asset binding");

  const configsBySlug = new Map(typed.configs.map((row) => [row.slug, row]));
  const configSlugs = new Set(configsBySlug.keys());
  const profileSlugs = new Set(typed.profiles.map((row) => row.slug));
  for (const config of typed.configs) {
    assertTimestamp(config.created_at, `config ${config.slug} created_at`);
    assertTimestamp(config.updated_at, `config ${config.slug} updated_at`);
    assertTimestamp(config.synced_at, `config ${config.slug} synced_at`, true);
    if (!Number.isSafeInteger(config.version) || config.version < 1) throw new Error(`Invalid v2 archive: config ${config.slug} has invalid version`);
  }
  for (const row of typed.config_snapshots) {
    const config = configsBySlug.get(row.config_slug);
    if (!config) {
      throw new Error(`Invalid v2 archive: snapshot references missing config ${row.config_slug}`);
    }
    if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > config.version) {
      throw new Error(`Invalid v2 archive: config ${row.config_slug} has an invalid snapshot version`);
    }
    assertTimestamp(row.created_at, `snapshot ${row.config_slug}@${row.version} created_at`);
  }
  for (const profile of typed.profiles) {
    assertTimestamp(profile.created_at, `profile ${profile.slug} created_at`);
    assertTimestamp(profile.updated_at, `profile ${profile.slug} updated_at`);
  }
  for (const row of typed.profile_config_bindings) {
    if (!profileSlugs.has(row.profile_slug) || !configSlugs.has(row.config_slug)) {
      throw new Error(`Invalid v2 archive: profile config binding has a missing logical reference`);
    }
  }
  for (const row of typed.profile_asset_bindings) {
    if (!profileSlugs.has(row.profile_slug) || !configSlugs.has(row.source_config_slug)) {
      throw new Error(`Invalid v2 archive: profile asset binding has a missing logical reference`);
    }
  }
  for (const machine of typed.machines) {
    assertTimestamp(machine.created_at, `machine ${machine.hostname} created_at`);
    assertTimestamp(machine.last_applied_at, `machine ${machine.hostname} last_applied_at`, true);
  }
  return typed;
}


function matchesFilter(config: Config, filter?: ConfigFilter): boolean {
  if (!filter) return true;
  if (filter.category && config.category !== filter.category) return false;
  if (filter.agent && config.agent !== filter.agent) return false;
  if (filter.kind && config.kind !== filter.kind) return false;
  if (filter.is_template !== undefined && config.is_template !== filter.is_template) return false;
  if (filter.tags?.length && !filter.tags.every((tag) => config.tags.includes(tag))) return false;
  if (filter.search) {
    const needle = filter.search.toLocaleLowerCase();
    if (![config.name, config.description ?? "", config.content].some((value) => value.toLocaleLowerCase().includes(needle))) return false;
  }
  return true;
}

export async function collectInstructionsDomain(
  opts: ExportOptions = {},
): Promise<InstructionsDomainArchiveV2> {
  const store = opts.store ?? resolveConfigStore();
  const selectedProfile = opts.profileId ? await store.getProfile(opts.profileId) : null;
  const listedConfigs = selectedProfile ? await store.getProfileConfigs(selectedProfile.id) : await store.listConfigs(opts.filter);
  const configs = listedConfigs.filter((config) => matchesFilter(config, selectedProfile ? opts.filter : undefined));
  configs.sort((left, right) => compareText(left.slug, right.slug));

  const selectedIds = new Set(configs.map((config) => config.id));
  const profiles = (selectedProfile ? [selectedProfile] : await store.listProfiles())
    .sort((left, right) => compareText(left.slug, right.slug));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const configById = new Map(configs.map((config) => [config.id, config]));

  const configSnapshots: InstructionsDomainArchiveV2["config_snapshots"] = [];
  // Keep hosted exports deliberately serialized: a complete production backup
  // must not fan out one snapshot request per config and overload the API it is
  // protecting. Each ConfigStore method owns bounded pagination internally.
  for (const config of configs) {
    for (const snapshot of await store.listSnapshots(config.id)) {
      configSnapshots.push({
        id: snapshot.id,
        config_slug: config.slug,
        content: snapshot.content,
        version: snapshot.version,
        created_at: snapshot.created_at,
      });
    }
  }
  configSnapshots.sort((left, right) => compareText(left.config_slug, right.config_slug) || left.version - right.version || compareText(left.id, right.id));

  const profileConfigBindings = (await Promise.all(profiles.map(async (profile) =>
    (await store.getProfileConfigBindings(profile.id))
      .filter((row) => selectedIds.has(row.config_id))
      .map((row) => ({
        profile_slug: profile.slug,
        config_slug: configById.get(row.config_id)!.slug,
        sort_order: row.sort_order,
        binding: row.binding,
      })),
  ))).flat().sort((left, right) => compareText(left.profile_slug, right.profile_slug) || left.sort_order - right.sort_order || compareText(left.config_slug, right.config_slug));

  const profileAssetBindings = (await Promise.all(profiles.map(async (profile) =>
    (await store.getProfileAssetBindings(profile.id))
      .filter((row) => selectedIds.has(row.source_config_id))
      .map((row) => ({
        profile_slug: profile.slug,
        source_config_slug: configById.get(row.source_config_id)!.slug,
        sort_order: row.sort_order,
        binding: row.binding,
      })),
  ))).flat().sort((left, right) => compareText(left.profile_slug, right.profile_slug) || left.sort_order - right.sort_order || compareText(left.binding.assetKey, right.binding.assetKey));

  // Keep profiles that belong to this archive. A full export keeps all profiles;
  // a profile-scoped export keeps exactly that profile.
  const archivedProfiles = profiles.filter((profile) => profileById.has(profile.id));
  const machines = (await store.listMachines()).sort((left, right) => compareText(left.hostname, right.hostname));
  return {
    schema: INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA,
    configs,
    config_snapshots: configSnapshots,
    profiles: archivedProfiles,
    profile_config_bindings: profileConfigBindings,
    profile_asset_bindings: profileAssetBindings,
    machines,
  };
}

export async function exportConfigs(
  outputPath: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  // Use the exact same complete-domain validator as restore before creating any
  // output file. A collection assembled across multiple hosted reads can be
  // internally inconsistent when a concurrent update crosses those reads.
  const domain = validateInstructionsDomainArchive(await collectInstructionsDomain(opts));
  const integrity = computeDomainIntegrity(domain);
  const payload = `${JSON.stringify(domain, null, 2)}\n`;
  const manifest: InstructionsDomainArchiveManifestV2 = {
    schema: INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA,
    version: "2.0.0",
    exported_at: new Date().toISOString(),
    payload: {
      path: "domain.json",
      sha256: sha256(payload),
      size_bytes: Buffer.byteLength(payload),
    },
    integrity,
    exclusions: ARCHIVE_EXCLUSIONS,
  };

  const absOutput = resolve(outputPath);
  mkdirSync(dirname(absOutput), { recursive: true });
  const stagingDir = mkdtempSync(join(tmpdir(), "instructions-domain-export-"));
  try {
    writeFileSync(join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    writeFileSync(join(stagingDir, "domain.json"), payload, "utf-8");
    const proc = Bun.spawn(["tar", "czf", absOutput, "-C", stagingDir, "manifest.json", "domain.json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tar failed: ${stderr.trim()}`);
    }
    return { path: absOutput, count: domain.configs.length, counts: integrity.counts, integrity };
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}
