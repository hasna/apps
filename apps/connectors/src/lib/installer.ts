/**
 * Connector installer - manages project-local connector enablement.
 *
 * Legacy versions copied full connector source trees into `.connectors/`.
 * The one-product model keeps connectors inside the package and writes only a
 * lightweight enablement manifest plus a generated index for project context.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getInternalConnectorDefinition,
  hasInternalConnectorDefinition,
} from "../core/builtins.js";
import { getConnectorsHome } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve connectors directory - works from both source (src/lib/) and built (bin/) locations
function resolveConnectorsDir(): string {
  // Try from built location: bin/ -> ../connectors/
  const fromBin = join(__dirname, "..", "connectors");
  if (existsSync(fromBin)) return fromBin;
  // Try from source location: src/lib/ -> ../../connectors/
  const fromSrc = join(__dirname, "..", "..", "connectors");
  if (existsSync(fromSrc)) return fromSrc;
  return fromBin; // default
}

const CONNECTORS_DIR = resolveConnectorsDir();

export interface InstallResult {
  connector: string;
  success: boolean;
  error?: string;
  path?: string;
}

export interface InstallOptions {
  targetDir?: string;
  overwrite?: boolean;
}

interface InstalledConnectorsManifest {
  version: 1;
  mode: "internal";
  updatedAt: string;
  connectors: string[];
}

const PROJECT_CONNECTORS_DIRNAME = ".connectors";
const ENABLEMENT_MANIFEST_FILENAME = "manifest.json";
const ENABLEMENT_INDEX_FILENAME = "index.ts";

function normalizeConnectorName(name: string): string {
  return name.startsWith("connect-") ? name.slice("connect-".length) : name;
}

function getProjectConnectorsDir(targetDir: string): string {
  return join(targetDir, PROJECT_CONNECTORS_DIRNAME);
}

function getEnablementManifestPath(targetDir: string): string {
  return join(getProjectConnectorsDir(targetDir), ENABLEMENT_MANIFEST_FILENAME);
}

function getEnablementIndexPath(targetDir: string): string {
  return join(getProjectConnectorsDir(targetDir), ENABLEMENT_INDEX_FILENAME);
}

function getLegacyInstallPath(targetDir: string, name: string): string {
  return join(getProjectConnectorsDir(targetDir), `connect-${normalizeConnectorName(name)}`);
}

function loadEnablementManifest(targetDir: string): InstalledConnectorsManifest | null {
  const manifestPath = getEnablementManifestPath(targetDir);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Partial<InstalledConnectorsManifest>;
    if (!Array.isArray(raw.connectors)) {
      return null;
    }

    return {
      version: 1,
      mode: "internal",
      updatedAt:
        typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      connectors: raw.connectors
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeConnectorName(value))
        .filter((value, index, all) => all.indexOf(value) === index)
        .sort(),
    };
  } catch {
    return null;
  }
}

function getLegacyInstalledConnectors(targetDir: string): string[] {
  const connectorsDir = getProjectConnectorsDir(targetDir);
  if (!existsSync(connectorsDir)) {
    return [];
  }

  return readdirSync(connectorsDir)
    .filter((entry) => {
      const fullPath = join(connectorsDir, entry);
      return entry.startsWith("connect-") && statSync(fullPath).isDirectory();
    })
    .map((entry) => entry.replace("connect-", ""))
    .sort();
}

function getEnabledConnectors(targetDir: string): string[] {
  const manifestConnectors = loadEnablementManifest(targetDir)?.connectors ?? [];
  return [...new Set([...manifestConnectors, ...getLegacyInstalledConnectors(targetDir)])].sort();
}

function updateConnectorsIndex(connectorsDir: string, connectors: string[]): void {
  const indexPath = join(connectorsDir, ENABLEMENT_INDEX_FILENAME);
  const connectorList = connectors.map((connector) => `  "${connector}",`).join("\n");

  const content = `/**
 * Auto-generated enabled connector index
 * This file tracks project-local enablement for the one-product runtime.
 * Connectors execute from the installed @hasna/connectors package instead of
 * copied source trees.
 */

export const enabledConnectors = [
${connectorList}
] as const;

export type EnabledConnectorName = typeof enabledConnectors[number];
`;

  writeFileSync(indexPath, content);
}

function writeEnablementManifest(targetDir: string, connectors: string[]): void {
  const connectorsDir = getProjectConnectorsDir(targetDir);
  mkdirSync(connectorsDir, { recursive: true });

  const manifest: InstalledConnectorsManifest = {
    version: 1,
    mode: "internal",
    updatedAt: new Date().toISOString(),
    connectors: [...new Set(connectors.map((value) => normalizeConnectorName(value)))].sort(),
  };

  writeFileSync(
    getEnablementManifestPath(targetDir),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  updateConnectorsIndex(connectorsDir, manifest.connectors);
}

/**
 * Get the path to a connector in the package
 */
export function getConnectorPath(name: string): string {
  const connectorName = name.startsWith("connect-") ? name : `connect-${name}`;
  return join(CONNECTORS_DIR, connectorName);
}

/**
 * Check if a connector exists in the package
 */
export function connectorExists(name: string): boolean {
  const normalizedName = normalizeConnectorName(name);
  return (
    hasInternalConnectorDefinition(normalizedName) ||
    existsSync(getConnectorPath(normalizedName))
  );
}

/**
 * Install a single connector to the target directory
 */
export function installConnector(
  name: string,
  options: InstallOptions = {}
): InstallResult {
  const { targetDir = process.cwd(), overwrite = false } = options;

  // Validate connector name to prevent path traversal
  if (!/^[a-z0-9-]+$/.test(name)) {
    return {
      connector: name,
      success: false,
      error: `Invalid connector name '${name}'`,
    };
  }

  const normalizedName = normalizeConnectorName(name);
  const manifestPath = getEnablementManifestPath(targetDir);
  const legacyInstallPath = getLegacyInstallPath(targetDir, normalizedName);

  // Check if connector exists in package
  if (!connectorExists(normalizedName)) {
    return {
      connector: normalizedName,
      success: false,
      error: `Connector '${name}' not found`,
    };
  }

  const installed = getEnabledConnectors(targetDir);

  if (installed.includes(normalizedName) && !overwrite) {
    return {
      connector: normalizedName,
      success: false,
      error: `Already enabled for this project. Use --overwrite to refresh enablement.`,
      path: manifestPath,
    };
  }

  try {
    const nextEnabled = [...new Set([...installed, normalizedName])].sort();
    writeEnablementManifest(targetDir, nextEnabled);

    // Remove a legacy copied install for this connector if the caller asked to
    // overwrite/refresh it; the manifest is now the source of truth.
    if (overwrite && existsSync(legacyInstallPath)) {
      rmSync(legacyInstallPath, { recursive: true });
    }

    return {
      connector: normalizedName,
      success: true,
      path: manifestPath,
    };
  } catch (error) {
    return {
      connector: normalizedName,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Install multiple connectors
 */
export function installConnectors(
  names: string[],
  options: InstallOptions = {}
): InstallResult[] {
  return names.map((name) => installConnector(name, options));
}

/**
 * Get list of installed connectors in a directory
 */
export function getInstalledConnectors(targetDir: string = process.cwd()): string[] {
  return getEnabledConnectors(targetDir);
}

/**
 * Parsed documentation from a connector's CLAUDE.md
 */
export interface ConnectorDocs {
  overview: string;
  auth: string;
  envVars: { variable: string; description: string }[];
  cliCommands: string;
  dataStorage: string;
  raw: string;
}

function parseConnectorDocs(raw: string): ConnectorDocs {
  return {
    overview: extractSection(raw, "Project Overview"),
    auth: extractSection(raw, "Authentication"),
    envVars: parseEnvVarsTable(extractSection(raw, "Environment Variables")),
    cliCommands: extractSection(raw, "CLI Commands"),
    dataStorage: extractSection(raw, "Data Storage"),
    raw,
  };
}

/**
 * Read and parse a connector's documentation (CLAUDE.md)
 */
export function getConnectorDocs(name: string): ConnectorDocs | null {
  const normalizedName = normalizeConnectorName(name);
  const connectorPath = getConnectorPath(normalizedName);
  const claudeMdPath = join(connectorPath, "CLAUDE.md");

  if (existsSync(claudeMdPath)) {
    return parseConnectorDocs(readFileSync(claudeMdPath, "utf-8"));
  }

  const internalDocs = getInternalConnectorDefinition(normalizedName)?.docsMarkdown;
  if (internalDocs) {
    return parseConnectorDocs(internalDocs);
  }

  return null;
}

/**
 * Extract a markdown section by heading name
 */
function extractSection(markdown: string, heading: string): string {
  // Match ## Heading or ### Heading
  const regex = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m");
  const match = regex.exec(markdown);
  if (!match) return "";

  const start = match.index + match[0].length;
  // Find the next heading of same or higher level
  const nextHeading = markdown.slice(start).search(/^##\s/m);
  const content = nextHeading === -1
    ? markdown.slice(start)
    : markdown.slice(start, start + nextHeading);

  return content.trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a markdown table of env vars into structured data
 */
function parseEnvVarsTable(section: string): { variable: string; description: string }[] {
  if (!section) return [];

  const vars: { variable: string; description: string }[] = [];
  const lines = section.split("\n");

  for (const line of lines) {
    // Match table rows: | `VAR_NAME` | Description |
    const match = line.match(/\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/);
    if (match && match[1] !== "Variable") {
      vars.push({ variable: match[1], description: match[2].trim() });
    }
  }

  return vars;
}

/**
 * Remove an installed connector
 */
export function removeConnector(
  name: string,
  targetDir: string = process.cwd()
): boolean {
  const normalizedName = normalizeConnectorName(name);
  const installed = getEnabledConnectors(targetDir);

  if (!installed.includes(normalizedName)) {
    return false;
  }

  const nextEnabled = installed.filter((connector) => connector !== normalizedName);
  writeEnablementManifest(targetDir, nextEnabled);

  const legacyInstallPath = getLegacyInstallPath(targetDir, normalizedName);
  if (existsSync(legacyInstallPath)) {
    rmSync(legacyInstallPath, { recursive: true });
  }

  return true;
}
