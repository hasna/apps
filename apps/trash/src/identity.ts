import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname as machineHostname } from "node:os";

export interface StationIdentity {
  name: string;
  hostname: string;
  source: "environment" | "tailscale" | "hostname";
  platform: string;
  architecture: string;
}

export interface AgentIdentity {
  name: string;
  harness: "codex" | "claude" | "opencode" | "cursor" | null;
  session: string | null;
}

type TailscaleSelf = { HostName?: string; DNSName?: string };

function readTailscaleSelf(): TailscaleSelf | null {
  const candidates = process.platform === "darwin"
    ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"]
    : ["/usr/bin/tailscale", "/usr/sbin/tailscale", "/usr/local/bin/tailscale"];
  const binary = candidates.find(existsSync);
  if (!binary) return null;
  try {
    const output = execFileSync(binary, ["status", "--json"], {
      timeout: 750, maxBuffer: 2 * 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const self = JSON.parse(output)?.Self;
    if (!self || typeof self !== "object") return null;
    return { HostName: self.HostName, DNSName: self.DNSName };
  } catch {
    return null;
  }
}

function stationName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new Error("Invalid station name; expected a DNS label.");
  return name;
}

/** Reported provenance only. Server-issued station bindings carry authority. */
export function detectStation(options: {
  env?: NodeJS.ProcessEnv;
  hostname?: () => string;
  tailscale?: () => TailscaleSelf | null;
} = {}): StationIdentity {
  const env = options.env ?? process.env;
  const hostname = (options.hostname ?? machineHostname)();
  if (!hostname || hostname.length > 253 || /[\x00-\x1f\x7f]/.test(hostname)) throw new Error("Invalid station hostname.");
  const base = { hostname, platform: process.platform, architecture: process.arch };
  const explicit = env.HASNA_TRASH_STATION ?? env.HASNA_STATION;
  if (explicit !== undefined) return { ...base, name: stationName(explicit), source: "environment" };
  const self = (options.tailscale ?? readTailscaleSelf)();
  const names = [typeof self?.DNSName === "string" ? self.DNSName.split(".")[0] : null, self?.HostName];
  for (const name of names) {
    if (typeof name !== "string" || !name) continue;
    try { return { ...base, name: stationName(name), source: "tailscale" }; }
    catch { /* An invalid daemon label never becomes a station identity. */ }
  }
  return { ...base, name: stationName(hostname.split(".")[0]!), source: "hostname" };
}

function agentLabel(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value)) throw new Error("Invalid agent identity; use 1–128 printable identity characters.");
  return value;
}

/** Explicitly project identity fields; never serialize the environment. */
export function detectAgent(env: NodeJS.ProcessEnv = process.env, name?: string): AgentIdentity {
  const candidates: [AgentIdentity["harness"], string | undefined][] = [
    ["codex", env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID],
    ["claude", env.CLAUDE_SESSION_ID],
    ["opencode", env.OPENCODE_SESSION_ID],
    ["cursor", env.CURSOR_TRACE_ID],
  ];
  const selected = candidates.find(([, value]) => value !== undefined);
  return {
    name: agentLabel(name ?? env.HASNA_TRASH_AGENT ?? env.TODOS_AGENT_ID ?? "unknown"),
    harness: selected?.[0] ?? null,
    session: selected?.[1] === undefined ? null : agentLabel(selected[1]),
  };
}
