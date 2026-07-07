import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getConnectorsHome } from "../db/database.js";

export const LEGACY_CONNECTOR_PREFIX = "connect-";

/** Alumia/registry slug aliases → canonical open-connectors connector id. */
export const CONNECTOR_SLUG_ALIASES: Readonly<Record<string, string>> = {
  twitter: "x",
  "x-twitter": "x",
};

const CONNECTOR_NAME_RE = /^[a-z0-9-]+$/;

function stripLegacyPrefix(name: string): string {
  return name.startsWith(LEGACY_CONNECTOR_PREFIX)
    ? name.slice(LEGACY_CONNECTOR_PREFIX.length)
    : name;
}

export function getSlugAliasesForCanonical(canonicalName: string): string[] {
  return Object.entries(CONNECTOR_SLUG_ALIASES)
    .filter(([, target]) => target === canonicalName)
    .map(([alias]) => alias);
}

export interface ConnectorNameResolution {
  input: string;
  canonicalName: string;
  legacyName: string;
  aliases: string[];
  isLegacyInput: boolean;
}

export interface ConnectorPackagePathResolution extends ConnectorNameResolution {
  connectorsDir: string;
  preferredDirName: string;
  preferredPath: string;
  existingPath: string | null;
  existingDirName: string | null;
  checkedPaths: string[];
}

export interface ConnectorConfigPathResolution extends ConnectorNameResolution {
  connectorsHome: string;
  preferredDirName: string;
  preferredPath: string;
  legacyPath: string;
  existingPaths: string[];
  readPaths: string[];
}

export function normalizeConnectorName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const withoutPrefix = stripLegacyPrefix(trimmed);
  return CONNECTOR_SLUG_ALIASES[withoutPrefix] ?? withoutPrefix;
}

export function legacyConnectorName(name: string): string {
  return `${LEGACY_CONNECTOR_PREFIX}${normalizeConnectorName(name)}`;
}

export function resolveConnectorName(name: string): ConnectorNameResolution {
  const canonicalName = normalizeConnectorName(name);
  const legacyName = legacyConnectorName(canonicalName);
  const slugAliases = getSlugAliasesForCanonical(canonicalName);
  const baseAliases =
    canonicalName === legacyName ? [canonicalName] : [canonicalName, legacyName];
  return {
    input: name,
    canonicalName,
    legacyName,
    aliases: [...new Set([...baseAliases, ...slugAliases])],
    isLegacyInput: name.trim().toLowerCase().startsWith(LEGACY_CONNECTOR_PREFIX),
  };
}

export function isValidConnectorName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed !== trimmed.toLowerCase()) return false;
  return CONNECTOR_NAME_RE.test(normalizeConnectorName(trimmed));
}

export function connectorPackageDirNames(name: string): string[] {
  const { canonicalName, legacyName } = resolveConnectorName(name);
  if (!canonicalName) return [legacyName];
  return canonicalName === legacyName ? [canonicalName] : [canonicalName, legacyName];
}

export function connectorConfigDirNames(name: string): string[] {
  return connectorPackageDirNames(name);
}

export function resolveConnectorPackagePath(
  connectorsDir: string,
  name: string,
): ConnectorPackagePathResolution {
  const resolution = resolveConnectorName(name);
  const dirNames = connectorPackageDirNames(name);
  const checkedPaths = dirNames.map((dirName) => join(connectorsDir, dirName));
  const existingPath = checkedPaths.find((path) => existsSync(path)) ?? null;
  const existingDirName = existingPath ? dirNames[checkedPaths.indexOf(existingPath)]! : null;

  return {
    ...resolution,
    connectorsDir,
    preferredDirName: dirNames[0]!,
    preferredPath: checkedPaths[0]!,
    existingPath,
    existingDirName,
    checkedPaths,
  };
}

export function getConnectorPackagePath(connectorsDir: string, name: string): string {
  const resolved = resolveConnectorPackagePath(connectorsDir, name);
  return resolved.existingPath ?? resolved.preferredPath;
}

export function resolveConnectorConfigPaths(
  name: string,
  connectorsHome = getConnectorsHome(),
): ConnectorConfigPathResolution {
  const resolution = resolveConnectorName(name);
  const preferredDirName = resolution.canonicalName || resolution.legacyName;
  const preferredPath = join(connectorsHome, preferredDirName);
  const legacyPath = join(connectorsHome, resolution.legacyName);
  const paths = preferredPath === legacyPath ? [preferredPath] : [preferredPath, legacyPath];
  const existingPaths = paths.filter((path) => existsSync(path));

  return {
    ...resolution,
    connectorsHome,
    preferredDirName,
    preferredPath,
    legacyPath,
    existingPaths,
    readPaths: paths,
  };
}

export function getConnectorConfigDir(
  name: string,
  connectorsHome = getConnectorsHome(),
): string {
  return resolveConnectorConfigPaths(name, connectorsHome).preferredPath;
}

export function getExistingConnectorConfigDirs(
  name: string,
  connectorsHome = getConnectorsHome(),
): string[] {
  return resolveConnectorConfigPaths(name, connectorsHome).existingPaths;
}

export function getConnectorConfigReadDirs(
  name: string,
  connectorsHome = getConnectorsHome(),
): string[] {
  return resolveConnectorConfigPaths(name, connectorsHome).readPaths;
}

export function listConfiguredConnectorNames(connectorsHome = getConnectorsHome()): string[] {
  if (!existsSync(connectorsHome)) return [];

  const names = new Set<string>();
  for (const entry of readdirSync(connectorsHome)) {
    const fullPath = join(connectorsHome, entry);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
      if (!isValidConnectorName(entry)) continue;
      names.add(normalizeConnectorName(entry));
    } catch {
      // Ignore entries that disappear or cannot be statted during iteration.
    }
  }

  return [...names].sort();
}
