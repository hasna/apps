import {
  writeManifest,
  readManifest,
  getDefaultManifest,
  getManifestMachine,
  detectCurrentMachineManifest,
  validateManifest,
  machineSchema,
} from "../manifests.js";
import { getManifestPath } from "../paths.js";
import type { FleetManifest, MachineManifest } from "../types.js";

export function manifestInit(): string {
  return writeManifest(getDefaultManifest(), getManifestPath());
}

export function manifestList(): FleetManifest {
  return readManifest();
}

export function manifestAdd(machine: MachineManifest): FleetManifest {
  const validatedMachine = machineSchema.parse(machine);
  const manifest = readManifest();
  const nextMachines = manifest.machines.filter((entry) => entry.id !== validatedMachine.id);
  nextMachines.push(validatedMachine);
  const nextManifest: FleetManifest = { ...manifest, machines: nextMachines };
  writeManifest(nextManifest);
  return nextManifest;
}

export function manifestBootstrapCurrentMachine(): FleetManifest {
  return manifestAdd(detectCurrentMachineManifest());
}

export function manifestGet(machineId: string): MachineManifest | null {
  return getManifestMachine(machineId);
}

export function manifestRemove(machineId: string): FleetManifest {
  const manifest = readManifest();
  const nextManifest: FleetManifest = {
    ...manifest,
    machines: manifest.machines.filter((machine) => machine.id !== machineId),
  };
  writeManifest(nextManifest);
  return nextManifest;
}

export function manifestValidate(): FleetManifest {
  return validateManifest(getManifestPath());
}
