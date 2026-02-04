/**
 * Connector installer - handles copying connectors to user projects
 */

import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONNECTORS_DIR = join(__dirname, "..", "..", "connectors");

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
  const { readdirSync } = require("fs");
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

  const { readdirSync, statSync } = require("fs");
  return readdirSync(connectorsDir)
    .filter((f: string) => {
      const fullPath = join(connectorsDir, f);
      return f.startsWith("connect-") && statSync(fullPath).isDirectory();
    })
    .map((f: string) => f.replace("connect-", ""));
}

/**
 * Remove an installed connector
 */
export function removeConnector(
  name: string,
  targetDir: string = process.cwd()
): boolean {
  const { rmSync } = require("fs");
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
