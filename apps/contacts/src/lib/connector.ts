/**
 * Generic connector runner — the scalable foundation for all external service
 * integrations. Any connector (Gmail, Google Contacts, HubSpot, Salesforce…)
 * uses this same interface; only the `name` and `args` differ.
 *
 * Prerequisites: the target connector must be globally installed and authed:
 *   bun install -g @hasnaxyz/connect-{name}
 *   connect-{name} auth login
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

export interface ConnectorRunOptions {
  /** Connector profile to use (default: "default") */
  profile?: string;
  /** Timeout in ms (default: 30_000) */
  timeout?: number;
}

export class ConnectorNotInstalledError extends Error {
  constructor(public readonly connectorName: string) {
    super(
      `connect-${connectorName} is not installed. ` +
        `Run: bun install -g @hasnaxyz/connect-${connectorName}`
    );
    this.name = "ConnectorNotInstalledError";
  }
}

export class ConnectorAuthError extends Error {
  constructor(public readonly connectorName: string, detail?: string) {
    super(
      `connect-${connectorName} is not authenticated. ` +
        `Run: connect-${connectorName} auth login` +
        (detail ? ` (${detail})` : "")
    );
    this.name = "ConnectorAuthError";
  }
}

/**
 * Execute any connector operation and return the parsed JSON output.
 *
 * Usage:
 *   const messages = await runConnector("gmail", ["messages", "list", "-q", "from:acme.com"]);
 *   const contacts = await runConnector("googlecontacts", ["contacts", "list"]);
 */
export async function runConnector(
  name: string,
  args: string[],
  opts: ConnectorRunOptions = {}
): Promise<unknown> {
  const binary = `connect-${name}`;
  const profile = opts.profile ?? "default";

  const fullArgs = [
    "--format",
    "json",
    "--profile",
    profile,
    ...args,
  ];

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([binary, ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      throw new ConnectorNotInstalledError(name);
    }
    throw err;
  }

  const timeoutMs = opts.timeout ?? 30_000;
  const timer = setTimeout(() => proc.kill(), timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout ? new Response(proc.stdout as ReadableStream<Uint8Array>).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr as ReadableStream<Uint8Array>).text() : Promise.resolve(""),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const errText = (stderr || stdout).trim();
      const lower = errText.toLowerCase();
      if (
        lower.includes("auth") ||
        lower.includes("token") ||
        lower.includes("401") ||
        lower.includes("unauthorized") ||
        lower.includes("not authenticated")
      ) {
        throw new ConnectorAuthError(name, errText.slice(0, 200));
      }
      throw new Error(`connect-${name} exited ${exitCode}: ${errText.slice(0, 400)}`);
    }

    const text = stdout.trim();
    if (!text || text === "null") return null;
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the path to a connector's token file.
 * Useful for implementations that need direct API access with refreshed tokens.
 * Checks canonical path first, then legacy fallback.
 */
export function getConnectorTokenPath(name: string, profile = "default"): string | null {
  const bases = [
    join(homedir(), ".connectors", `connect-${name}`, "profiles", profile, "tokens.json"),
    join(homedir(), ".connect", `connect-${name}`, "profiles", profile, "tokens.json"),
    join(homedir(), ".connect", `connect-${name}`, "tokens.json"),
  ];
  for (const p of bases) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read and parse connector tokens from disk.
 * Useful when a library needs a raw access token (e.g. for batched REST calls
 * that would be too slow to do one-at-a-time through the CLI).
 */
export function readConnectorTokens(name: string, profile = "default"): Record<string, unknown> {
  const path = getConnectorTokenPath(name, profile);
  if (!path) throw new ConnectorAuthError(name);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new ConnectorAuthError(name, "tokens file unreadable");
  }
}
