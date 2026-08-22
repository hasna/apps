import {
  writeManifest,
  readManifest,
  getDefaultManifest,
  getManifestMachine,
  machineDisplayName,
  normalizeFriendlyName,
  detectCurrentMachineManifest,
  validateManifest,
  machineSchema,
} from "../manifests.js";
import { getManifestPath } from "../paths.js";
import type { FleetManifest, MachineManifest } from "../types.js";

export interface MachineFriendlyNameResult {
  machine_id: string;
  friendly_name: string | null;
  display_name: string;
  updated_at: string | null;
}

export interface SetMachineFriendlyNameInput {
  machineId: string;
  friendlyName: string;
}

export interface ClearMachineFriendlyNameInput {
  machineId: string;
}

export function manifestInit(): string {
  return writeManifest(getDefaultManifest(), getManifestPath());
}

export function manifestList(): FleetManifest {
  return readManifest();
}

export function manifestAdd(machine: MachineManifest): FleetManifest {
  const friendlyName = normalizeFriendlyName(machine.friendlyName);
  const candidate: MachineManifest = {
    ...machine,
    updatedAt: machine.updatedAt ?? new Date().toISOString(),
  };
  if (friendlyName) {
    candidate.friendlyName = friendlyName;
  } else {
    delete candidate.friendlyName;
  }
  const validatedMachine = machineSchema.parse(candidate);
  const manifest = readManifest();
  const nextStations = manifest.stations.filter((entry) => entry.id !== validatedMachine.id);
  nextStations.push(validatedMachine);
  const nextManifest: FleetManifest = { ...manifest, stations: nextStations };
  writeManifest(nextManifest);
  return nextManifest;
}

export function manifestBootstrapCurrentMachine(): FleetManifest {
  return manifestAdd(detectCurrentMachineManifest());
}

export function manifestGet(machineId: string): MachineManifest | null {
  return getManifestMachine(machineId);
}

function machineFriendlyNameResult(machine: MachineManifest): MachineFriendlyNameResult {
  return {
    machine_id: machine.id,
    friendly_name: normalizeFriendlyName(machine.friendlyName),
    display_name: machineDisplayName(machine),
    updated_at: machine.updatedAt ?? null,
  };
}

function updateManifestMachine(machineId: string, updater: (machine: MachineManifest, now: string) => MachineManifest): MachineManifest {
  if (!machineId.trim()) throw new Error("machineId is required.");
  const manifest = readManifest();
  const now = new Date().toISOString();
  let updated: MachineManifest | null = null;
  const nextManifest: FleetManifest = {
    ...manifest,
    stations: manifest.stations.map((machine) => {
      if (machine.id !== machineId) return machine;
      updated = machineSchema.parse(updater(machine, now));
      return updated;
    }),
  };
  if (!updated) throw new Error(`Machine not found in manifest: ${machineId}`);
  writeManifest(nextManifest);
  return updated;
}

export function machineFriendlyNameResourceId(machineId: string): string {
  return `manifest:machine:${machineId}:friendly-name`;
}

export function setMachineFriendlyNameMutationArgs(input: SetMachineFriendlyNameInput): Record<string, unknown> {
  return {
    machine_id: input.machineId,
    friendly_name: normalizeFriendlyName(input.friendlyName) ?? "",
  };
}

export function clearMachineFriendlyNameMutationArgs(input: ClearMachineFriendlyNameInput): Record<string, unknown> {
  return {
    machine_id: input.machineId,
  };
}

export function manifestGetFriendlyName(machineId: string): MachineFriendlyNameResult {
  const machine = getManifestMachine(machineId);
  if (!machine) throw new Error(`Machine not found in manifest: ${machineId}`);
  return machineFriendlyNameResult(machine);
}

export function manifestSetFriendlyName(input: SetMachineFriendlyNameInput): MachineFriendlyNameResult {
  const friendlyName = normalizeFriendlyName(input.friendlyName);
  if (!friendlyName) throw new Error("friendlyName is required.");
  const machine = updateManifestMachine(input.machineId, (current, now) => ({
    ...current,
    friendlyName,
    updatedAt: now,
  }));
  return machineFriendlyNameResult(machine);
}

export function manifestClearFriendlyName(input: ClearMachineFriendlyNameInput): MachineFriendlyNameResult {
  const machine = updateManifestMachine(input.machineId, (current, now) => {
    const next: MachineManifest = {
      ...current,
      updatedAt: now,
    };
    delete next.friendlyName;
    return next;
  });
  return machineFriendlyNameResult(machine);
}

export function manifestRemove(machineId: string): FleetManifest {
  const manifest = readManifest();
  const nextManifest: FleetManifest = {
    ...manifest,
    stations: manifest.stations.filter((machine) => machine.id !== machineId),
  };
  writeManifest(nextManifest);
  return nextManifest;
}

export function manifestValidate(): FleetManifest {
  return validateManifest(getManifestPath());
}
