import { getManifestMachine, detectCurrentMachineManifest } from "../manifests.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { requireMachineCommandSuccess, runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { MachineManifest, SetupResult, SetupStep } from "../types.js";

function buildInstallSteps(machine: MachineManifest): SetupStep[] {
  if (machine.platform === "macos") {
    return [
      {
        id: "tailscale-brew",
        title: "Install Tailscale via Homebrew",
        command: "brew install --cask tailscale",
        manager: "brew",
      },
    ];
  }

  if (machine.platform === "windows") {
    return [
      {
        id: "tailscale-winget",
        title: "Install Tailscale via winget",
        command: "winget install Tailscale.Tailscale",
        manager: "custom",
      },
    ];
  }

  return [
    {
      id: "tailscale-linux",
      title: "Install Tailscale on Linux",
      command: "curl -fsSL https://tailscale.com/install.sh | sh",
      manager: "custom",
      privileged: true,
    },
  ];
}

export function buildTailscaleInstallPlan(machineId?: string): SetupResult {
  const machine = machineId ? getManifestMachine(machineId) : detectCurrentMachineManifest();
  if (!machine) {
    throw new Error(`Machine not found in manifest: ${machineId}`);
  }
  return attachMutationPlanDigest({
    machineId: machine.id,
    mode: "plan",
    steps: buildInstallSteps(machine),
    executed: 0,
  });
}

export interface RunTailscaleInstallOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
}

export function runTailscaleInstall(
  machineId?: string,
  options: RunTailscaleInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  const plan = buildTailscaleInstallPlan(machineId);
  return runTailscaleInstallPlan(plan, options, runner);
}

export function runTailscaleInstallPlan(
  plan: SetupResult,
  options: RunTailscaleInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  if (!options.yes) {
    throw new Error("Tailscale install requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    requireMachineCommandSuccess(`Tailscale install ${step.id}`, runner(plan.machineId, step.command));
    executed += 1;
  }

  return attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  });
}
