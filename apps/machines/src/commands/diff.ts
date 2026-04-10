import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import type { MachineDiff, MachineManifest } from "../types.js";

function packageNames(machine: MachineManifest): string[] {
  return (machine.packages || []).map((pkg) => pkg.name).sort();
}

function fileTargets(machine: MachineManifest): string[] {
  return (machine.files || []).map((file) => `${file.source}->${file.target}`).sort();
}

export function diffMachines(leftMachineId: string, rightMachineId?: string): MachineDiff {
  const left = getManifestMachine(leftMachineId);
  if (!left) {
    throw new Error(`Machine not found in manifest: ${leftMachineId}`);
  }

  const right = rightMachineId ? getManifestMachine(rightMachineId) : detectCurrentMachineManifest();
  if (!right) {
    throw new Error(`Machine not found in manifest: ${rightMachineId}`);
  }

  const changedFields = [
    left.platform !== right.platform ? "platform" : null,
    left.connection !== right.connection ? "connection" : null,
    left.workspacePath !== right.workspacePath ? "workspacePath" : null,
    left.bunPath !== right.bunPath ? "bunPath" : null,
  ].filter(Boolean) as string[];

  const leftPackages = new Set(packageNames(left));
  const rightPackages = new Set(packageNames(right));
  const leftFiles = new Set(fileTargets(left));
  const rightFiles = new Set(fileTargets(right));

  return {
    leftMachineId: left.id,
    rightMachineId: right.id,
    changedFields,
    missingPackages: {
      leftOnly: [...leftPackages].filter((pkg) => !rightPackages.has(pkg)),
      rightOnly: [...rightPackages].filter((pkg) => !leftPackages.has(pkg)),
    },
    missingFiles: {
      leftOnly: [...leftFiles].filter((file) => !rightFiles.has(file)),
      rightOnly: [...rightFiles].filter((file) => !leftFiles.has(file)),
    },
  };
}
