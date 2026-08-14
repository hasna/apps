import { existsSync } from "fs";
import { join } from "path";
import { MCPS_DIR } from "./config.js";
import { getToolCounts, listServers } from "./registry.js";
import { listSources } from "./sources.js";
import { listProviderProfiles } from "./provider-profiles.js";
import { listMachines } from "./machines.js";
import { readPackageVersion } from "./version.js";
import type { McpServerEntry, McpSource, ProviderProfile } from "../types.js";

type ActiveDataDirEnv = "HASNA_MCPS_DATA_DIR" | "MCPS_DATA_DIR" | null;
type ActiveDbEnv = "HASNA_MCPS_DB_PATH" | "MCPS_DB_PATH" | null;
type ContractStatus = "ok" | "warn";

export interface McpsStatusContract {
  service: "mcps";
  schemaVersion: "1.0";
  package: {
    name: "@hasna/mcps";
    version: string;
  };
  env: {
    dataDir: {
      primary: "HASNA_MCPS_DATA_DIR";
      fallback: "MCPS_DATA_DIR";
      active: ActiveDataDirEnv;
    };
    database: {
      primary: "HASNA_MCPS_DB_PATH";
      fallback: "MCPS_DB_PATH";
      active: ActiveDbEnv;
    };
    credentialVaultConfigured: boolean;
  };
  registry: {
    sources: {
      total: number;
      enabled: number;
      disabled: number;
      byType: Record<string, number>;
    };
    providerProfiles: {
      total: number;
      enabled: number;
      disabled: number;
    };
  };
  cache: {
    directoryPresent: boolean;
    cachedTools: number;
    serversWithCachedTools: number;
  };
  counts: {
    servers: {
      total: number;
      enabled: number;
      disabled: number;
      byTransport: Record<string, number>;
      bySource: Record<string, number>;
      withLastError: number;
    };
    machines: {
      total: number;
      enabled: number;
      disabled: number;
    };
  };
  health: {
    status: ContractStatus;
    databaseReachable: boolean;
    hasRegisteredServers: boolean;
    hasServerErrors: boolean;
  };
  safety: {
    includesToolConfigs: false;
    includesCommands: false;
    includesArgs: false;
    includesEnvValues: false;
    includesCredentialRefs: false;
    includesTokens: false;
    includesPrivatePaths: false;
    includesRegistryUrls: false;
    statusOutputIsMetadataOnly: true;
  };
}

function activeDataDirEnv(): ActiveDataDirEnv {
  if (process.env["HASNA_MCPS_DATA_DIR"]) return "HASNA_MCPS_DATA_DIR";
  if (process.env["MCPS_DATA_DIR"]) return "MCPS_DATA_DIR";
  return null;
}

function activeDatabaseEnv(): ActiveDbEnv {
  if (process.env["HASNA_MCPS_DB_PATH"]) return "HASNA_MCPS_DB_PATH";
  if (process.env["MCPS_DB_PATH"]) return "MCPS_DB_PATH";
  return null;
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

export function buildMcpsStatus(input: {
  servers: McpServerEntry[];
  sources: McpSource[];
  providerProfiles: ProviderProfile[];
  machines: Array<{ enabled: boolean }>;
  toolCounts: Map<string, number>;
  cacheDirectoryPresent: boolean;
  databaseReachable?: boolean;
  packageVersion?: string;
}): McpsStatusContract {
  const enabledServers = input.servers.filter((server) => server.enabled).length;
  const enabledSources = input.sources.filter((source) => source.enabled).length;
  const enabledProfiles = input.providerProfiles.filter((profile) => profile.enabled).length;
  const enabledMachines = input.machines.filter((machine) => machine.enabled).length;
  const cachedTools = [...input.toolCounts.values()].reduce((sum, count) => sum + count, 0);
  const serversWithLastError = input.servers.filter((server) => Boolean(server.last_error)).length;
  const databaseReachable = input.databaseReachable !== false;
  const status: ContractStatus = databaseReachable && serversWithLastError === 0 ? "ok" : "warn";

  return {
    service: "mcps",
    schemaVersion: "1.0",
    package: {
      name: "@hasna/mcps",
      version: input.packageVersion ?? readPackageVersion(import.meta.url),
    },
    env: {
      dataDir: {
        primary: "HASNA_MCPS_DATA_DIR",
        fallback: "MCPS_DATA_DIR",
        active: activeDataDirEnv(),
      },
      database: {
        primary: "HASNA_MCPS_DB_PATH",
        fallback: "MCPS_DB_PATH",
        active: activeDatabaseEnv(),
      },
      credentialVaultConfigured: Boolean(process.env["HASNA_MCPS_CREDENTIAL_VAULT_PATH"]),
    },
    registry: {
      sources: {
        total: input.sources.length,
        enabled: enabledSources,
        disabled: input.sources.length - enabledSources,
        byType: countBy(input.sources, (source) => source.type),
      },
      providerProfiles: {
        total: input.providerProfiles.length,
        enabled: enabledProfiles,
        disabled: input.providerProfiles.length - enabledProfiles,
      },
    },
    cache: {
      directoryPresent: input.cacheDirectoryPresent,
      cachedTools,
      serversWithCachedTools: [...input.toolCounts.values()].filter((count) => count > 0).length,
    },
    counts: {
      servers: {
        total: input.servers.length,
        enabled: enabledServers,
        disabled: input.servers.length - enabledServers,
        byTransport: countBy(input.servers, (server) => server.transport),
        bySource: countBy(input.servers, (server) => server.source),
        withLastError: serversWithLastError,
      },
      machines: {
        total: input.machines.length,
        enabled: enabledMachines,
        disabled: input.machines.length - enabledMachines,
      },
    },
    health: {
      status,
      databaseReachable,
      hasRegisteredServers: input.servers.length > 0,
      hasServerErrors: serversWithLastError > 0,
    },
    safety: {
      includesToolConfigs: false,
      includesCommands: false,
      includesArgs: false,
      includesEnvValues: false,
      includesCredentialRefs: false,
      includesTokens: false,
      includesPrivatePaths: false,
      includesRegistryUrls: false,
      statusOutputIsMetadataOnly: true,
    },
  };
}

export function getMcpsStatus(): McpsStatusContract {
  try {
    return buildMcpsStatus({
      servers: listServers(),
      sources: listSources(),
      providerProfiles: listProviderProfiles(),
      machines: listMachines(),
      toolCounts: getToolCounts(),
      cacheDirectoryPresent: existsSync(join(MCPS_DIR, "cache")),
    });
  } catch {
    return buildMcpsStatus({
      servers: [],
      sources: [],
      providerProfiles: [],
      machines: [],
      toolCounts: new Map(),
      cacheDirectoryPresent: false,
      databaseReachable: false,
    });
  }
}
