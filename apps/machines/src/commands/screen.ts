import { buildSshCommandPlan } from "./ssh.js";
import {
  discoverMachineTopology,
  resolveMachineRoute,
  type MachineRouteOptions,
  type MachineRouteKind,
  type MachineRouteConfidence,
} from "../topology.js";
import { getManifestMachine } from "../manifests.js";

export const SCREEN_SECRET_NAMESPACE_ENV = "HASNA_MACHINES_SCREEN_SECRET_NAMESPACE";
export const DEFAULT_SCREEN_SECRET_NAMESPACE = "machines/screen-sharing";

export interface ResolvedScreenTarget {
  machineId: string;
  user: string | null;
  host: string;
  url: string;
  route: MachineRouteKind;
  confidence: MachineRouteConfidence;
  warnings: string[];
}

export interface ScreenCredentialResolution {
  machineId: string;
  user: string | null;
  userSource: "option" | "route" | "metadata" | "missing";
  passwordSecretKey: string;
  passwordSecretSource: "option" | "metadata" | "default";
}

export interface ScreenEnableCommandPlan {
  machineId: string;
  user: string;
  passwordSecretKey: string;
  remoteCommand: string;
  secretsCommand: string;
  secretsCommandArgs: string[];
  sshCommand: string;
  sshCommandArgs: string[];
  command: string;
}

export interface ScreenCredentialOptions extends MachineRouteOptions {
  user?: string;
  passwordSecretKey?: string;
}

export interface ScreenEnableCommandOptions extends ScreenCredentialOptions {
  secretsCommand?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellCommand(command: string[]): string {
  return command.map(shellQuote).join(" ");
}

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Split a route target that may be in `user@host` form into its parts.
 * Returns `[user|null, host]`.
 */
function splitTarget(target: string): [string | null, string] {
  const at = target.indexOf("@");
  if (at === -1) return [null, target];
  return [target.slice(0, at), target.slice(at + 1)];
}

export function defaultScreenPasswordSecretKey(machineId: string): string {
  const namespace = process.env[SCREEN_SECRET_NAMESPACE_ENV]?.trim() || DEFAULT_SCREEN_SECRET_NAMESPACE;
  return `${namespace}/screen-${machineId}-vnc-password`;
}

/**
 * Resolve the best screen-sharing (VNC) target for a machine.
 * Prefers the live LAN route over Tailscale (lower latency for screen sharing),
 * and always produces a `vnc://user@host` URL when a user is known.
 */
export function resolveScreenTarget(machineId: string, options: MachineRouteOptions = {}): ResolvedScreenTarget {
  const resolved = resolveMachineRoute(machineId, options);
  if (!resolved.ok || !resolved.target) {
    throw new Error(`Machine route not found: ${machineId}`);
  }
  if (resolved.route === "unknown") {
    throw new Error(`Machine route is not reachable for screen sharing: ${machineId}`);
  }

  let [user, host] = splitTarget(resolved.target);

  // If the route target didn't carry a user, look one up from topology metadata.
  if (!user) {
    const topology = options.topology ?? discoverMachineTopology({ ...options, limit: null, offset: 0 });
    const entry = topology.machines.find(
      (m) => m.machine_id === (resolved.machine_id ?? machineId),
    );
    user = entry?.user ?? null;
  }

  const url = user ? `vnc://${user}@${host}` : `vnc://${host}`;

  return {
    machineId: resolved.machine_id ?? machineId,
    user,
    host,
    url,
    route: resolved.route,
    confidence: resolved.confidence,
    warnings: resolved.warnings,
  };
}

export function resolveScreenCredentials(machineId: string, options: ScreenCredentialOptions = {}): ScreenCredentialResolution {
  const topology = options.topology ?? discoverMachineTopology({ ...options, limit: null, offset: 0 });
  const screen = resolveScreenTarget(machineId, { ...options, topology });
  const entry = topology.machines.find((machine) => machine.machine_id === screen.machineId);
  const manifestEntry = getManifestMachine(screen.machineId) ?? getManifestMachine(machineId);
  const metadata = manifestEntry?.metadata ?? entry?.metadata;
  const metadataUser = metadataString(metadata, ["screenUser", "screen_user", "user", "username"]);
  const metadataPasswordSecret = metadataString(metadata, [
    "screenPasswordSecret",
    "screen_password_secret",
    "screenVncPasswordSecret",
    "screen_vnc_password_secret",
    "vncPasswordSecret",
    "vnc_password_secret",
  ]);
  const user = options.user ?? screen.user ?? metadataUser;
  const passwordSecretKey = options.passwordSecretKey ?? metadataPasswordSecret ?? defaultScreenPasswordSecretKey(screen.machineId);

  return {
    machineId: screen.machineId,
    user: user ?? null,
    userSource: options.user ? "option" : screen.user ? "route" : metadataUser ? "metadata" : "missing",
    passwordSecretKey,
    passwordSecretSource: options.passwordSecretKey ? "option" : metadataPasswordSecret ? "metadata" : "default",
  };
}

/**
 * One row of `screen-credentials` output as far as exit-code evaluation is concerned.
 * `ok: false` marks a machine we could not resolve (e.g. no route); when a secret was
 * checked, `passwordSecret.present` reports whether it exists in the vault.
 */
export interface ScreenCredentialOutcome {
  ok: boolean;
  passwordSecret?: { checked: boolean; present: boolean | null };
}

/**
 * Decide whether `screen-credentials` should exit non-zero.
 *
 * A read/list command that returns data for at least one machine is a success: an
 * unroutable machine (`ok: false`, e.g. "Machine route not found") is already surfaced
 * per-entry in the output, so a fully-returned listing must not fail-close solely because
 * one machine was unreachable. An explicitly checked-and-missing secret
 * (`passwordSecret.present === false`) is a distinct, requested check that remains fatal.
 *
 * `strict` opts into full fail-closed behaviour: exit non-zero if ANY machine failed to
 * resolve, in addition to the missing-secret check.
 */
export function screenCredentialsFailed(
  entries: ScreenCredentialOutcome[],
  options: { strict?: boolean } = {},
): boolean {
  if (entries.length === 0) return true;
  const secretMissing = entries.some(
    (entry) => Boolean(entry.passwordSecret?.checked && entry.passwordSecret.present === false),
  );
  if (options.strict) {
    return entries.some((entry) => !entry.ok) || secretMissing;
  }
  // Non-strict: unroutable machines are informational as long as at least one machine
  // returned data; only a total lookup miss or a missing checked secret is fatal.
  const noData = !entries.some((entry) => entry.ok);
  return noData || secretMissing;
}

/**
 * Build the macOS command that opens Screen Sharing to a machine.
 * `open vnc://user@host` launches Screen Sharing.app pointed at the resolved route.
 */
export function buildScreenCommand(machineId: string, options: MachineRouteOptions = {}): string {
  const resolved = resolveScreenTarget(machineId, options);
  return `open ${resolved.url}`;
}

/**
 * Build the remote command that ENABLES Remote Management / Screen Sharing on a
 * macOS target via `kickstart`, plus the SRP + legacy-VNC password tweaks that
 * make user-password auth work reliably from Screen Sharing.app and ARD.
 *
 * `vncPassword` is truncated to 8 chars by the VNC protocol; callers should pass
 * an <=8 char value (or accept that only the first 8 chars are honored by legacy
 * VNC clients).
 *
 * Returns the shell command to run AS ROOT on the target (caller pipes the sudo
 * password or runs under an already-root context).
 */
export function buildScreenEnableRemoteCommand(user: string, vncPassword: string): string {
  const kickstart =
    "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart";
  const lines = [
    // Put the user in the screen-sharing access group
    `dseditgroup -o edit -a ${shellQuote(user)} -t user com.apple.access_screensharing 2>/dev/null || true`,
    // Force SRP so modern macOS-to-macOS auth works
    "defaults write /Library/Preferences/com.apple.RemoteManagement AllowSRPForNetworkNodes -bool true",
    // Configure legacy VNC password (<=8 chars honored)
    `${kickstart} -configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw ${shellQuote(vncPassword)}`,
    // Activate Remote Management, grant the user all privileges, restart the agent + menu extra
    `${kickstart} -activate -configure -access -on -users ${shellQuote(user)} -privs -all -restart -agent -menu`,
  ];
  return lines.join(" && ");
}

/**
 * Build the remote root command used by secure screen-enable plans.
 * The VNC password is read from stdin so it is not embedded in shell history,
 * generated command text, or the SSH remote command arguments.
 */
export function buildScreenEnableRemoteCommandFromStdin(user: string): string {
  const kickstart =
    "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart";
  const script = [
    "set -euo pipefail",
    'user="$1"',
    "IFS= read -r vnc_pw",
    'if [ -z "$vnc_pw" ]; then echo "missing VNC password on stdin" >&2; exit 1; fi',
    `kickstart=${shellQuote(kickstart)}`,
    'dseditgroup -o edit -a "$user" -t user com.apple.access_screensharing 2>/dev/null || true',
    "defaults write /Library/Preferences/com.apple.RemoteManagement AllowSRPForNetworkNodes -bool true",
    '"$kickstart" -configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw "$vnc_pw"',
    '"$kickstart" -activate -configure -access -on -users "$user" -privs -all -restart -agent -menu',
  ].join("\n");
  return `sudo -n -p '' /bin/bash -c ${shellQuote(script)} -- ${shellQuote(user)}`;
}

export function buildScreenEnableCommand(machineId: string, options: ScreenEnableCommandOptions = {}): ScreenEnableCommandPlan {
  const credentials = resolveScreenCredentials(machineId, options);
  if (!credentials.user) {
    throw new Error(`No screen-sharing user known for ${machineId}; pass --user <name> or set metadata.user in the manifest.`);
  }
  const secretsCommand = options.secretsCommand || "secrets";
  const remoteCommand = buildScreenEnableRemoteCommandFromStdin(credentials.user);
  const secretsCommandArgs = [secretsCommand, "get", credentials.passwordSecretKey];
  const sshPlan = buildSshCommandPlan(machineId, remoteCommand, options);
  return {
    machineId: credentials.machineId,
    user: credentials.user,
    passwordSecretKey: credentials.passwordSecretKey,
    remoteCommand,
    secretsCommand,
    secretsCommandArgs,
    sshCommand: sshPlan.command,
    sshCommandArgs: sshPlan.args,
    command: `${shellCommand(secretsCommandArgs)} | ${sshPlan.shellCommand}`,
  };
}
