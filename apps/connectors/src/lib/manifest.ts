import pkg from "../../package.json" with { type: "json" };
import {
  CONNECTORS,
  CATEGORIES,
  getConnector,
  type Category,
  type ConnectorMeta,
} from "./registry.js";
import {
  connectorExists,
  getConnectorDocs,
  getConnectorPath,
  type ConnectorDocs,
} from "./installer.js";
import {
  getConnectorOperations,
  hasConnectorCommandSurface,
  type ConnectorOperationDescriptor,
} from "./runner.js";
import { getAuthType, type AuthType } from "../server/auth.js";
import {
  getSlugAliasesForCanonical,
  legacyConnectorName,
  normalizeConnectorName,
  resolveConnectorConfigPaths,
} from "./connector-resolver.js";
import { getInternalConnectorDefinition } from "../core/builtins.js";

export interface ConnectorCapabilityRuntime {
  packageName: "@hasna/connectors";
  connectorId: string;
  legacyConnectorId: string;
  packagePath: string;
  configDirName: string;
  legacyConfigDirName: string;
  internal: boolean;
  packageDirectory: boolean;
  commandSurface: boolean;
}

export interface ConnectorCapabilityAuth {
  type: AuthType;
  summary: string | null;
  envVars: ConnectorDocs["envVars"];
}

export interface ConnectorCapabilityDocs {
  overview: string;
  cliCommands: string;
  dataStorage: string | null;
}

export interface ConnectorCapability extends ConnectorMeta {
  id: string;
  aliases: string[];
  runtime: ConnectorCapabilityRuntime;
  auth: ConnectorCapabilityAuth;
  docs: ConnectorCapabilityDocs;
  operations?: ConnectorOperationDescriptor[];
}

export interface ConnectorCapabilityManifest {
  version: 1;
  packageName: "@hasna/connectors";
  packageVersion: string;
  generatedAt: string;
  categories: readonly Category[];
  connectorCount: number;
  connectors: ConnectorCapability[];
}

export interface ConnectorCapabilityOptions {
  includeOperations?: boolean;
}

export interface ConnectorCapabilityManifestOptions extends ConnectorCapabilityOptions {
  connectorNames?: string[];
}

function buildAliases(name: string): string[] {
  const canonicalName = normalizeConnectorName(name);
  const legacyName = legacyConnectorName(canonicalName);
  const slugAliases = getSlugAliasesForCanonical(canonicalName);
  const baseAliases =
    canonicalName === legacyName ? [canonicalName] : [canonicalName, legacyName];
  return [...new Set([...baseAliases, ...slugAliases])];
}

async function loadOperations(
  name: string,
  includeOperations: boolean | undefined,
): Promise<ConnectorOperationDescriptor[] | undefined> {
  if (!includeOperations || !hasConnectorCommandSurface(name)) return undefined;
  return (await getConnectorOperations(name)).operations;
}

export async function getConnectorCapability(
  name: string,
  options: ConnectorCapabilityOptions = {},
): Promise<ConnectorCapability | null> {
  const connectorName = normalizeConnectorName(name);
  const meta = getConnector(connectorName);
  if (!meta) return null;

  const docs = getConnectorDocs(connectorName);
  const configPaths = resolveConnectorConfigPaths(connectorName);
  const operations = await loadOperations(connectorName, options.includeOperations);

  return {
    ...meta,
    id: connectorName,
    aliases: buildAliases(connectorName),
    runtime: {
      packageName: "@hasna/connectors",
      connectorId: connectorName,
      legacyConnectorId: legacyConnectorName(connectorName),
      packagePath: getConnectorPath(connectorName),
      configDirName: configPaths.preferredDirName,
      legacyConfigDirName: configPaths.legacyName,
      internal: Boolean(getInternalConnectorDefinition(connectorName)),
      packageDirectory: connectorExists(connectorName),
      commandSurface: hasConnectorCommandSurface(connectorName),
    },
    auth: {
      type: getAuthType(connectorName),
      summary: docs?.auth ?? null,
      envVars: docs?.envVars ?? [],
    },
    docs: {
      overview: docs?.overview ?? "",
      cliCommands: docs?.cliCommands ?? "",
      dataStorage: docs?.dataStorage ?? null,
    },
    ...(operations ? { operations } : {}),
  };
}

export async function getConnectorCapabilityManifest(
  options: ConnectorCapabilityManifestOptions = {},
): Promise<ConnectorCapabilityManifest> {
  const names = options.connectorNames
    ? [...new Set(options.connectorNames.map((name) => normalizeConnectorName(name)))].sort()
    : CONNECTORS.map((connector) => connector.name);

  const connectors: ConnectorCapability[] = [];
  for (const name of names) {
    const capability = await getConnectorCapability(name, options);
    if (capability) connectors.push(capability);
  }

  return {
    version: 1,
    packageName: "@hasna/connectors",
    packageVersion: pkg.version,
    generatedAt: new Date().toISOString(),
    categories: CATEGORIES,
    connectorCount: connectors.length,
    connectors,
  };
}
