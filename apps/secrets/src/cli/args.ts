import type { SecretEntry, SecretMetadata } from "../types.js";

export type CliFlags = Record<string, string>;

const BOOLEAN_FLAGS = new Set([
  "redact",
  "push",
  "dry-run",
  "plan",
  "force",
  "overwrite",
  "show",
  "plaintext",
  "pretty",
  "favorite",
  "json",
  "fix-permissions",
]);

export function parseArgs(args: string[]): { flags: CliFlags; positional: string[] } {
  const flags: CliFlags = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

export function parseTtl(ttl: string): string {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) {
    console.error(`Invalid TTL: ${ttl}. Use e.g. 30d, 24h, 60m`);
    process.exit(1);
  }
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as string]!;
  return new Date(Date.now() + parseInt(num) * ms).toISOString();
}

export function formatEntry(entry: SecretEntry | SecretMetadata, showValue = false): string {
  const val = showValue && "value" in entry ? entry.value : "***";
  const label = entry.label ? ` (${entry.label})` : "";
  const expiry = entry.expires_at
    ? ` [expires: ${new Date(entry.expires_at).toLocaleDateString()}]`
    : "";
  const expired =
    entry.expires_at && new Date(entry.expires_at) < new Date() ? " [EXPIRED]" : "";
  return `${entry.key}${label} [${entry.type}]${expiry}${expired} = ${val}`;
}

export function parseAwsOptions(flags: CliFlags) {
  return {
    dryRun: flags["dry-run"] === "true" || flags.plan === "true",
    region: flags.region,
    prefix: flags.prefix,
    profile: flags.profile,
    credentialMode: flags["credential-mode"] as any,
    roleArn: flags["role-arn"],
    sourceProfile: flags["source-profile"],
    externalId: flags["external-id"],
    sessionName: flags["session-name"],
  };
}

export function formatJson(value: unknown, pretty = false): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

export function positiveIntegerFlag(flags: CliFlags, name: string): number | undefined {
  const value = flags[name];
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.error(`Invalid --${name}: ${value}. Use a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

export function commaListFlag(flags: CliFlags, name: string): string[] | undefined {
  const value = flags[name];
  if (!value) return undefined;
  const parts = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}
