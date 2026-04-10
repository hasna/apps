import { getManifestMachine, detectCurrentMachineManifest } from "../manifests.js";
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
  const machine = (machineId ? getManifestMachine(machineId) : null) || detectCurrentMachineManifest();
  return {
    machineId: machine.id,
    mode: "plan",
    steps: buildInstallSteps(machine),
    executed: 0,
  };
}

export function runTailscaleInstall(machineId?: string, options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
  const plan = buildTailscaleInstallPlan(machineId);
  if (!options.apply) return plan;
  if (!options.yes) {
    throw new Error("Tailscale install requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Tailscale install failed (${step.id}): ${result.stderr.toString().trim()}`);
    }
    executed += 1;
  }

  return {
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  };
}
