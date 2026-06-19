import { homedir } from "node:os";
import { readManifest } from "../manifests.js";
import { getLocalMachineId, recordSetupRun } from "../db.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { describeMachineCommandFailure, runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { MachineManifest, SetupResult, SetupStep } from "../types.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildBaseSteps(machine: MachineManifest): SetupStep[] {
  const steps: SetupStep[] = [
    {
      id: "workspace",
      title: "Ensure workspace directory exists",
      command: `mkdir -p ${quote(machine.workspacePath)}`,
      manager: "shell",
    },
    {
      id: "bun",
      title: "Install Bun if missing",
      command: "command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash",
      manager: "shell",
    },
  ];

  if (machine.platform === "linux") {
    steps.push({
      id: "apt-base",
      title: "Install core Linux tooling",
      command: "sudo apt-get update && sudo apt-get install -y git curl unzip build-essential",
      manager: "apt",
      privileged: true,
    });
    steps.push({
      id: "linux-update-downloads",
      title: "Enable Linux package list refresh and download-only upgrades",
      command: "printf '%s\\n' 'APT::Periodic::Update-Package-Lists \"1\";' 'APT::Periodic::Download-Upgradeable-Packages \"1\";' 'APT::Periodic::Unattended-Upgrade \"0\";' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null",
      manager: "apt",
      privileged: true,
    });
  } else if (machine.platform === "macos") {
    steps.push({
      id: "brew-base",
      title: "Install Homebrew if missing",
      command: "command -v brew >/dev/null 2>&1 || /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
      manager: "brew",
    });
    steps.push({
      id: "brew-core",
      title: "Install core macOS tooling",
      command: "brew install git coreutils",
      manager: "brew",
    });
    steps.push({
      id: "macos-update-downloads",
      title: "Enable macOS update checks and downloads without automatic install",
      command: "sudo softwareupdate --schedule on && sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool true && sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -int 1 && sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -int 0",
      manager: "custom",
      privileged: true,
    });
    steps.push({
      id: "macos-management-readiness",
      title: "Report Apple management readiness without enrolling devices",
      command: "profiles status -type enrollment 2>/dev/null || true",
      manager: "custom",
    });
  }

  steps.push({
    id: "github-app-auth-readiness",
    title: "Check GitHub CLI/App auth readiness without printing credentials",
    command: "command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 || true",
    manager: "custom",
  });

  return steps;
}

function buildPackageSteps(machine: MachineManifest): SetupStep[] {
  return (machine.packages || []).map((pkg, index) => {
    const manager = pkg.manager || (machine.platform === "macos" ? "brew" : "apt");
    let command = pkg.name;
    if (manager === "bun") {
      command = `bun install -g ${quote(pkg.name)}`;
    } else if (manager === "brew") {
      command = `brew install ${quote(pkg.name)}`;
    } else if (manager === "apt") {
      command = `sudo apt-get install -y ${quote(pkg.name)}`;
    }

    return {
      id: `package-${index + 1}`,
      title: `Install package ${pkg.name}`,
      command,
      manager,
      privileged: manager === "apt",
    };
  });
}

export function buildSetupPlan(machineId?: string): SetupResult {
  const manifest = readManifest();
  const currentMachineId = getLocalMachineId();
  const selected = machineId
    ? manifest.machines.find((machine) => machine.id === machineId)
    : manifest.machines.find((machine) => machine.id === currentMachineId);

  if (machineId && !selected) {
    throw new Error(`Machine not found in manifest: ${machineId}`);
  }

  const target: MachineManifest = selected || {
    id: currentMachineId,
    platform: "linux",
    workspacePath: `${homedir()}/workspace`,
  };

  const steps = [...buildBaseSteps(target), ...buildPackageSteps(target)];

  return attachMutationPlanDigest({
    machineId: target.id,
    mode: "plan",
    steps,
    executed: 0,
  });
}

export interface RunSetupOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
}

export function runSetup(
  machineId?: string,
  options: RunSetupOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  const plan = buildSetupPlan(machineId);
  return runSetupPlan(plan, options, runner);
}

export function runSetupPlan(
  plan: SetupResult,
  options: RunSetupOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) {
    return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  }

  if (!options.yes) {
    throw new Error("Setup execution requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = runner(plan.machineId, step.command);
    if (result.exitCode !== 0) {
      recordSetupRun(plan.machineId, "failed", {
        executed,
        failedStep: step,
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        source: result.source,
      });
      throw new Error(describeMachineCommandFailure(`Setup step ${step.id}`, result));
    }
    executed += 1;
  }

  const summary: SetupResult = attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  });
  recordSetupRun(plan.machineId, "completed", summary);
  return summary;
}
