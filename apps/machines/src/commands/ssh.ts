import { spawnSync } from "node:child_process";
import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";

export interface ResolvedSshTarget {
  machineId: string;
  target: string;
  route: "lan" | "tailscale" | "local";
}

function envReachableHosts(): Set<string> {
  const raw = process.env["HASNA_MACHINES_REACHABLE_HOSTS"];
  return new Set((raw || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function isReachable(host: string): boolean {
  const overrides = envReachableHosts();
  if (overrides.size > 0) {
    return overrides.has(host);
  }

  const probe = spawnSync("bash", ["-lc", `getent hosts ${host} >/dev/null 2>&1 || ping -c 1 -W 1 ${host} >/dev/null 2>&1`], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

export function resolveSshTarget(machineId: string): ResolvedSshTarget {
  const machine = getManifestMachine(machineId);
  if (!machine) {
    throw new Error(`Machine not found in manifest: ${machineId}`);
  }

  const current = detectCurrentMachineManifest();
  if (machine.id === current.id) {
    return {
      machineId,
      target: "localhost",
      route: "local",
    };
  }

  const lanTarget = machine.sshAddress || machine.hostname || machine.id;
  const tailscaleTarget = machine.tailscaleName || machine.hostname || machine.id;
  const route = isReachable(lanTarget) ? "lan" : "tailscale";

  return {
    machineId,
    target: route === "lan" ? lanTarget : tailscaleTarget,
    route,
  };
}

export function buildSshCommand(machineId: string, remoteCommand?: string): string {
  const resolved = resolveSshTarget(machineId);
  return remoteCommand ? `ssh ${resolved.target} ${JSON.stringify(remoteCommand)}` : `ssh ${resolved.target}`;
}
