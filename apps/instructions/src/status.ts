import { existsSync, readFileSync } from "node:fs";
import { resolveConfigStore, type ConfigStore } from "./data/config-store.js";
import type { Config } from "./types/index.js";
import { expandPath } from "./lib/apply.js";
import { isRetiredOrUnsupportedConfigAgent } from "./lib/config-agents.js";
import { getPackageVersion } from "./lib/package-version.js";
import { inspectManagedSkillRuntimes } from "./lib/managed-skill-runtimes.js";
import { redactContent, scanSecrets, redactFormatForTarget, type RedactFormat } from "./lib/redact.js";

const PACKAGE_NAME = "@hasna/instructions";
const PACKAGE_VERSION = getPackageVersion();

type ActiveDbEnv = "HASNA_INSTRUCTIONS_DB_PATH" | null;
type DatabaseKind = "memory" | "file";
type ContractStatus = "ok" | "warn";

export interface ConfigsStatusContract {
  service: "configs";
  schemaVersion: "1.0";
  package: {
    name: string;
    version: string;
  };
  env: {
    database: {
      primary: "HASNA_INSTRUCTIONS_DB_PATH";
      active: ActiveDbEnv;
      kind: DatabaseKind;
    };
  };
  counts: {
    configs: {
      total: number;
      file: number;
      reference: number;
      templates: number;
      retiredAgentRows: number;
    };
    byCategory: Record<string, number>;
    byAgent: Record<string, number>;
    byFormat: Record<string, number>;
    profiles: number;
    /**
     * Profile -> config links, and snapshots across every config.
     *
     * `null` means "not counted in this run", which is the DEFAULT against a
     * hosted store: both numbers cost one HTTP round trip per row, and a
     * summary command must not pay 258 of them (see STATUS_FANOUT_CONCURRENCY).
     * `instructions status --deep` counts them anyway; the on-box SQLite store
     * always does, because there they are free.
     */
    profileLinks: number | null;
    machines: number;
    snapshots: number | null;
    knownTargets: number;
    managedSkillRuntimes: {
      skillsPresent: number;
      healthy: number;
      missing: number;
    };
  };
  health: {
    status: ContractStatus;
    databaseReachable: boolean;
    driftedTargets: number;
    missingTargets: number;
    unredactedSecretFindings: number;
    retiredAgentRows: number;
    missingManagedSkillRuntimes: number;
    hasDrift: boolean;
    hasMissingTargets: boolean;
    hasUnredactedSecrets: boolean;
    hasRetiredAgentRows: boolean;
    hasMissingManagedSkillRuntimes: boolean;
  };
  safety: {
    includesConfigValues: false;
    includesPrivatePaths: false;
    includesHostnames: false;
    includesSecretValues: false;
    statusOutputIsMetadataOnly: true;
  };
}

function activeDatabaseEnv(): ActiveDbEnv {
  if (process.env["HASNA_INSTRUCTIONS_DB_PATH"]) return "HASNA_INSTRUCTIONS_DB_PATH";
  return null;
}

function configuredDatabaseKind(): DatabaseKind {
  const value = process.env["HASNA_INSTRUCTIONS_DB_PATH"] ?? "";
  return value === ":memory:" || value.startsWith("file::memory:") ? "memory" : "file";
}

/**
 * How many per-row reads a DEEP status keeps in flight against a hosted store.
 *
 * `counts.profileLinks` and `counts.snapshots` need one read per profile and
 * one per config. Against the on-box SQLite store those are synchronous and
 * free; against the `/v1` API each one is a separate HTTP round trip, and the
 * serial `for` loop that used to run them is why `instructions status` looked
 * hung on a real station. Measured on station03 against api.hasna.com,
 * 2026-09-11, with 258 configs and 8 profiles:
 *
 *   serial (the old code)            120.3 s for the snapshot loop alone
 *   8 / 16 / 32 / 64 concurrent      37.5 s / 34.2 s / 36.4 s / 37.1 s
 *
 * So the wall time is the SERVICE's throughput (~7 reads/s), not the client's
 * request pattern: concurrency takes 120 s down to ~35 s and then stops
 * helping. A 40 s fleet probe still kills it, which is why the fan-out is no
 * longer part of a default hosted status at all — the counts it feeds are
 * reported as `null` unless the caller asks for them (`status --deep`). The
 * bound stays for that deep path, because a few hundred simultaneous sockets
 * against the gateway is a self-inflicted rate-limit and buys nothing here.
 */
const STATUS_FANOUT_CONCURRENCY = 16;

/**
 * Map `fn` over `items` with at most `limit` promises in flight, preserving
 * order. Workers pull from a shared cursor, so one slow row cannot idle the
 * rest (a chunked `Promise.all` would wait for the slowest row of each batch).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function countBy<T>(items: T[], getValue: (item: T) => string | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = getValue(item);
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export async function getConfigsStatus(
  store: ConfigStore = resolveConfigStore(),
  options: { homeDir?: string; conversationsCommand?: string; deep?: boolean } = {},
): Promise<ConfigsStatusContract> {
  // Per-row counts are free against SQLite and expensive against the API, so
  // they follow the transport unless the caller says otherwise.
  const deepCounts = options.deep ?? store.mode === "local";
  let databaseReachable = true;
  let configs: Config[] = [];
  let categoryStats: Record<string, number> = { total: 0 };

  try {
    configs = await store.listConfigs();
    categoryStats = await store.getConfigStats();
  } catch {
    databaseReachable = false;
  }

  const fileConfigs = configs.filter((config) => config.kind === "file");
  const retiredAgentRows = configs.filter((config) => isRetiredOrUnsupportedConfigAgent(config.agent)).length;
  let driftedTargets = 0;
  let missingTargets = 0;
  let unredactedSecretFindings = 0;
  let knownTargets = 0;

  for (const config of fileConfigs) {
    // Dialect from the path: a stored row keeps the coarse format ("text" for
    // ~/.zshrc), so rescans must re-derive the shell dialect or pre-existing
    // stored literals stay invisible (todos 452cb9d6).
    unredactedSecretFindings += scanSecrets(config.content, redactFormatForTarget(config.target_path ?? "", config.format as RedactFormat)).length;
    if (isRetiredOrUnsupportedConfigAgent(config.agent)) continue;
    if (!config.target_path) continue;

    knownTargets += 1;
    const targetPath = expandPath(config.target_path);
    if (!existsSync(targetPath)) {
      missingTargets += 1;
      continue;
    }

    const disk = readFileSync(targetPath, "utf-8");
    // Redact the disk side with the PATH-derived dialect: stored shell rows
    // keep the coarse "text" format, and redacting disk with "text" leaves the
    // literal — falsely drifting against the shell-redacted stored content
    // (todos 452cb9d6).
    const { content: redactedDisk } = redactContent(disk, redactFormatForTarget(config.target_path, config.format as RedactFormat));
    if (redactedDisk !== config.content) {
      driftedTargets += 1;
    }
  }

  let profiles = 0;
  let machines = 0;
  let profileLinks: number | null = deepCounts ? 0 : null;
  let snapshots: number | null = deepCounts ? 0 : null;
  if (databaseReachable) {
    try {
      const profileList = await store.listProfiles();
      profiles = profileList.length;
      machines = (await store.listMachines()).length;
      if (deepCounts) {
        const linkCounts = await mapWithConcurrency(
          profileList,
          STATUS_FANOUT_CONCURRENCY,
          async (profile) => (await store.getProfileConfigs(profile.id)).length,
        );
        profileLinks = linkCounts.reduce((total, count) => total + count, 0);
        const snapshotCounts = await mapWithConcurrency(
          configs,
          STATUS_FANOUT_CONCURRENCY,
          async (config) => (await store.listSnapshots(config.id)).length,
        );
        snapshots = snapshotCounts.reduce((total, count) => total + count, 0);
      }
    } catch {
      databaseReachable = false;
    }
  }
  const byCategory = Object.fromEntries(Object.entries(categoryStats).filter(([key]) => key !== "total"));
  const managedSkillRuntimes = inspectManagedSkillRuntimes({
    homeDir: options.homeDir,
    conversationsCommand: options.conversationsCommand,
  });

  const status: ContractStatus =
    databaseReachable &&
    driftedTargets === 0 &&
    missingTargets === 0 &&
    unredactedSecretFindings === 0 &&
    retiredAgentRows === 0 &&
    managedSkillRuntimes.missing === 0
      ? "ok"
      : "warn";

  return {
    service: "configs",
    schemaVersion: "1.0",
    package: {
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
    },
    env: {
      database: {
        primary: "HASNA_INSTRUCTIONS_DB_PATH",
        active: activeDatabaseEnv(),
        kind: configuredDatabaseKind(),
      },
    },
    counts: {
      configs: {
        total: configs.length,
        file: fileConfigs.length,
        reference: configs.filter((config) => config.kind === "reference").length,
        templates: configs.filter((config) => config.is_template).length,
        retiredAgentRows,
      },
      byCategory,
      byAgent: countBy(configs, (config) => config.agent),
      byFormat: countBy(configs, (config) => config.format),
      profiles,
      profileLinks,
      machines,
      snapshots,
      knownTargets,
      managedSkillRuntimes: {
        skillsPresent: managedSkillRuntimes.skills_present,
        healthy: managedSkillRuntimes.healthy,
        missing: managedSkillRuntimes.missing,
      },
    },
    health: {
      status,
      databaseReachable,
      driftedTargets,
      missingTargets,
      unredactedSecretFindings,
      retiredAgentRows,
      missingManagedSkillRuntimes: managedSkillRuntimes.missing,
      hasDrift: driftedTargets > 0,
      hasMissingTargets: missingTargets > 0,
      hasUnredactedSecrets: unredactedSecretFindings > 0,
      hasRetiredAgentRows: retiredAgentRows > 0,
      hasMissingManagedSkillRuntimes: managedSkillRuntimes.missing > 0,
    },
    safety: {
      includesConfigValues: false,
      includesPrivatePaths: false,
      includesHostnames: false,
      includesSecretValues: false,
      statusOutputIsMetadataOnly: true,
    },
  };
}
