import { discoverMachineTopology, resolveMachineRoute, type MachineRouteOptions, type MachineRouteKind, type MachineRouteConfidence } from "../topology.js";

export interface ResolvedScreenTarget {
  machineId: string;
  user: string | null;
  host: string;
  url: string;
  route: MachineRouteKind;
  confidence: MachineRouteConfidence;
  warnings: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
    const topology = options.topology ?? discoverMachineTopology(options);
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
