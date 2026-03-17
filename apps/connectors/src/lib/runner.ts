/**
 * Connector runner - discovers and executes connector CLI operations via subprocess.
 *
 * Design: Each connector has its own Commander.js CLI at src/cli/index.ts.
 * Instead of importing all 62 CLIs (which would bloat the process), we spawn
 * them as subprocesses and capture stdout/stderr. This keeps the main CLI/MCP
 * lightweight while exposing every connector's full API.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the connectors/ directory (works from src/lib/ and bin/) */
function resolveConnectorsDir(): string {
  const fromBin = join(__dirname, "..", "connectors");
  if (existsSync(fromBin)) return fromBin;
  const fromSrc = join(__dirname, "..", "..", "connectors");
  if (existsSync(fromSrc)) return fromSrc;
  return fromBin;
}

const CONNECTORS_DIR = resolveConnectorsDir();

/**
 * Derive the expected env var name from a connector name.
 * e.g. "exa" → "EXA", "stabilityai" → "STABILITYAI", "openweathermap" → "OPENWEATHERMAP"
 *
 * Special cases where the connector name doesn't match the env var prefix
 * are handled with an explicit map.
 */
const ENV_VAR_NAME_OVERRIDES: Record<string, string[]> = {
  // Connectors whose env var prefix differs from uppercase(name)
  googlemaps: ["GOOGLE_MAPS"],
  googletasks: ["GOOGLE_TASKS", "GOOGLE"],
  google: ["GOOGLE"],
  stabilityai: ["STABILITY"],
  openweathermap: ["OPENWEATHERMAP", "OPENWEATHER"],
};

/**
 * Build the subprocess env with auto-detected credentials.
 *
 * For each connector we derive the "canonical" env var (e.g. EXA_API_KEY)
 * and, if it's not already set, check common alternative patterns from the
 * user's environment. When a match is found we inject it so the connector
 * subprocess can read it.
 *
 * Patterns checked (in priority order):
 *   1. HASNAXYZ_{NAME}_LIVE_API_KEY  → {NAME}_API_KEY
 *   2. HASNA_{NAME}_LIVE_API_KEY     → {NAME}_API_KEY
 *   3. {NAME}_LIVE_API_KEY           → {NAME}_API_KEY
 *   4. {NAME}_KEY                    → {NAME}_API_KEY
 *   5. {NAME}_TOKEN                  → {NAME}_API_KEY
 */
export function buildEnvWithCredentials(
  connectorName: string,
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  const prefixes = ENV_VAR_NAME_OVERRIDES[connectorName] || [
    connectorName.toUpperCase().replace(/-/g, "_"),
  ];

  for (const prefix of prefixes) {
    const canonicalKey = `${prefix}_API_KEY`;

    // If the canonical var is already set, nothing to do for this prefix
    if (env[canonicalKey]) continue;

    // Check alternative patterns in priority order
    const alternatives = [
      `HASNAXYZ_${prefix}_LIVE_API_KEY`,
      `HASNA_${prefix}_LIVE_API_KEY`,
      `${prefix}_LIVE_API_KEY`,
      `${prefix}_KEY`,
      `${prefix}_TOKEN`,
    ];

    for (const alt of alternatives) {
      const value = env[alt];
      if (value) {
        env[canonicalKey] = value;
        break;
      }
    }
  }

  return env;
}

/**
 * Get the path to a connector's CLI entry point.
 * Returns null if the connector has no CLI.
 */
export function getConnectorCliPath(name: string): string | null {
  const safeName = name.replace(/[^a-z0-9-]/g, "");
  const connectorDir = join(CONNECTORS_DIR, `connect-${safeName}`);
  const cliPath = join(connectorDir, "src", "cli", "index.ts");
  if (existsSync(cliPath)) return cliPath;
  return null;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

/**
 * Run a connector CLI command as a subprocess.
 *
 * @param name - Connector name (e.g. "stripe", "gmail")
 * @param args - CLI arguments (e.g. ["products", "list", "--limit", "5"])
 * @param timeoutMs - Max execution time (default 30s)
 */
export function runConnectorCommand(
  name: string,
  args: string[],
  timeoutMs = 30000
): Promise<RunResult> {
  const cliPath = getConnectorCliPath(name);
  if (!cliPath) {
    return Promise.resolve({
      stdout: "",
      stderr: `Connector '${name}' not found or has no CLI.`,
      exitCode: 1,
      success: false,
    });
  }

  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", cliPath, ...args], {
      timeout: timeoutMs,
      env: buildEnvWithCredentials(name, process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        success: code === 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        success: false,
      });
    });
  });
}

/**
 * Get the list of available operations for a connector by parsing its --help output.
 * Returns structured command list.
 */
export async function getConnectorOperations(
  name: string
): Promise<{ commands: string[]; helpText: string; hasCli: boolean }> {
  const cliPath = getConnectorCliPath(name);
  if (!cliPath) {
    return { commands: [], helpText: "", hasCli: false };
  }

  const result = await runConnectorCommand(name, ["--help"]);
  const helpText = result.stdout || result.stderr;

  // Parse Commander.js help output to extract commands
  const commands: string[] = [];
  const lines = helpText.split("\n");
  let inCommands = false;

  for (const line of lines) {
    if (line.trim().startsWith("Commands:")) {
      inCommands = true;
      continue;
    }
    if (inCommands) {
      // Commander outputs commands as "  command-name [options]  description"
      const match = line.match(/^\s{2,}(\S+)/);
      if (match && match[1] !== "help") {
        commands.push(match[1]);
      }
      // Empty line or next section ends the commands block
      if (line.trim() === "" && commands.length > 0) {
        inCommands = false;
      }
    }
  }

  return { commands, helpText, hasCli: true };
}

/**
 * Get detailed help for a specific connector subcommand.
 */
export async function getConnectorCommandHelp(
  name: string,
  command: string
): Promise<string> {
  const result = await runConnectorCommand(name, [command, "--help"]);
  return result.stdout || result.stderr;
}

/**
 * Check which connectors have CLI entry points.
 */
export function getConnectorsWithCli(): string[] {
  const { readdirSync } = require("fs");
  const connectors: string[] = [];

  try {
    const dirs = readdirSync(CONNECTORS_DIR);
    for (const dir of dirs) {
      if (!dir.startsWith("connect-")) continue;
      const name = dir.replace("connect-", "");
      if (getConnectorCliPath(name)) {
        connectors.push(name);
      }
    }
  } catch {
    // connectors dir not found
  }

  return connectors;
}
