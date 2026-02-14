/**
 * Connector installer - handles copying connectors to user projects
 */

import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
  return existsSync(getConnectorPath(name));
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

  const connectorName = name.startsWith("connect-") ? name : `connect-${name}`;
  const sourcePath = getConnectorPath(name);
  const destDir = join(targetDir, ".connectors");
  const destPath = join(destDir, connectorName);

  // Check if connector exists in package
  if (!existsSync(sourcePath)) {
    return {
      connector: name,
      success: false,
      error: `Connector '${name}' not found`,
    };
  }

  // Check if already installed
  if (existsSync(destPath) && !overwrite) {
    return {
      connector: name,
      success: false,
      error: `Already installed. Use --overwrite to replace.`,
      path: destPath,
    };
  }

  try {
    // Ensure .connectors directory exists
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Copy connector
    cpSync(sourcePath, destPath, { recursive: true });

    // Update or create .connectors/index.ts for easy imports
    updateConnectorsIndex(destDir);

    return {
      connector: name,
      success: true,
      path: destPath,
    };
  } catch (error) {
    return {
      connector: name,
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
 * Update the .connectors/index.ts file to export all installed connectors
 */
function updateConnectorsIndex(connectorsDir: string): void {
  const indexPath = join(connectorsDir, "index.ts");

  // Get all installed connectors
  const connectors = readdirSync(connectorsDir).filter(
    (f: string) => f.startsWith("connect-") && !f.includes(".")
  );

  // Generate index content
  const exports = connectors
    .map((c: string) => {
      const name = c.replace("connect-", "");
      return `export * as ${name} from './${c}/src/index.js';`;
    })
    .join("\n");

  const content = `/**
 * Auto-generated index of installed connectors
 * Do not edit manually - run 'connectors install' to update
 */

${exports}
`;

  writeFileSync(indexPath, content);
}

/**
 * Get list of installed connectors in a directory
 */
export function getInstalledConnectors(targetDir: string = process.cwd()): string[] {
  const connectorsDir = join(targetDir, ".connectors");

  if (!existsSync(connectorsDir)) {
    return [];
  }

  return readdirSync(connectorsDir)
    .filter((f: string) => {
      const fullPath = join(connectorsDir, f);
      return f.startsWith("connect-") && statSync(fullPath).isDirectory();
    })
    .map((f: string) => f.replace("connect-", ""));
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

/**
 * Read and parse a connector's documentation (CLAUDE.md)
 */
export function getConnectorDocs(name: string): ConnectorDocs | null {
  const connectorPath = getConnectorPath(name);
  const claudeMdPath = join(connectorPath, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) return null;

  const raw = readFileSync(claudeMdPath, "utf-8");

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
  const connectorName = name.startsWith("connect-") ? name : `connect-${name}`;
  const connectorsDir = join(targetDir, ".connectors");
  const connectorPath = join(connectorsDir, connectorName);

  if (!existsSync(connectorPath)) {
    return false;
  }

  rmSync(connectorPath, { recursive: true });
  updateConnectorsIndex(connectorsDir);
  return true;
}
