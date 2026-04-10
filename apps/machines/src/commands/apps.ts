import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import type { MachineManifest, ManifestAppSpec, SetupResult, SetupStep } from "../types.js";

function getPackageName(app: ManifestAppSpec): string {
  return app.packageName || app.name;
}

function buildAppCommand(machine: MachineManifest, app: ManifestAppSpec): string {
  const packageName = getPackageName(app);
  if (app.manager === "custom") {
    return packageName;
  }

  if (machine.platform === "macos") {
    if (app.manager === "cask") {
      return `brew install --cask ${packageName}`;
    }
    return `brew install ${packageName}`;
  }

  if (machine.platform === "windows") {
    return `winget install ${packageName}`;
  }

  return `sudo apt-get install -y ${packageName}`;
}

function buildAppSteps(machine: MachineManifest): SetupStep[] {
  return (machine.apps || []).map((app) => ({
    id: `app-${app.name}`,
    title: `Install ${app.name} on ${machine.id}`,
    command: buildAppCommand(machine, app),
    manager:
      app.manager === "custom"
        ? "custom"
        : machine.platform === "macos"
          ? "brew"
          : machine.platform === "windows"
            ? "custom"
            : "apt",
    privileged: machine.platform === "linux",
  }));
}

function resolveMachine(machineId?: string): MachineManifest {
  return (machineId ? getManifestMachine(machineId) : null) || detectCurrentMachineManifest();
}

export function listApps(machineId?: string): { machineId: string; apps: ManifestAppSpec[] } {
  const machine = resolveMachine(machineId);
  return {
    machineId: machine.id,
    apps: machine.apps || [],
  };
}

export function buildAppsPlan(machineId?: string): SetupResult {
  const machine = resolveMachine(machineId);
  return {
    machineId: machine.id,
    mode: "plan",
    steps: buildAppSteps(machine),
    executed: 0,
  };
}

export function runAppsInstall(machineId?: string, options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
  const plan = buildAppsPlan(machineId);
  if (!options.apply) return plan;
  if (!options.yes) {
    throw new Error("App installation requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`App install failed (${step.id}): ${result.stderr.toString().trim()}`);
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
