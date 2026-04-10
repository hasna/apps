import { readManifest } from "../manifests.js";
import { getLocalMachineId, recordSetupRun } from "../db.js";
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
  }

  return steps;
}

function buildPackageSteps(machine: MachineManifest): SetupStep[] {
  return (machine.packages || []).map((pkg, index) => {
    const manager = pkg.manager || (machine.platform === "macos" ? "brew" : "apt");
    let command = pkg.name;
    if (manager === "bun") {
      command = `bun install -g ${pkg.name}`;
    } else if (manager === "brew") {
      command = `brew install ${pkg.name}`;
    } else if (manager === "apt") {
      command = `sudo apt-get install -y ${pkg.name}`;
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

  const target: MachineManifest = selected || {
    id: currentMachineId,
    platform: "linux",
    workspacePath: "~/workspace",
  };

  const steps = [...buildBaseSteps(target), ...buildPackageSteps(target)];

  return {
    machineId: target.id,
    mode: "plan",
    steps,
    executed: 0,
  };
}

export function runSetup(machineId?: string, options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
  const plan = buildSetupPlan(machineId);
  if (!options.apply) {
    return plan;
  }

  if (!options.yes) {
    throw new Error("Setup execution requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      recordSetupRun(plan.machineId, "failed", {
        executed,
        failedStep: step,
        stderr: result.stderr.toString(),
      });
      throw new Error(`Setup step failed (${step.id}): ${result.stderr.toString().trim()}`);
    }
    executed += 1;
  }

  const summary: SetupResult = {
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  };
  recordSetupRun(plan.machineId, "completed", summary);
  return summary;
}
