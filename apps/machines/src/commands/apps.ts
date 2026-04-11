import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import { runMachineCommand } from "../remote.js";
import type {
  AppsDiffResult,
  AppsStatusResult,
  InstalledAppStatus,
  MachineManifest,
  ManifestAppSpec,
  SetupResult,
  SetupStep,
} from "../types.js";

function getPackageName(app: ManifestAppSpec): string {
  return app.packageName || app.name;
}

function getAppManager(machine: MachineManifest, app: ManifestAppSpec): InstalledAppStatus["manager"] {
  if (app.manager) return app.manager;
  if (machine.platform === "macos") return "brew";
  if (machine.platform === "windows") return "winget";
  return "apt";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAppCommand(machine: MachineManifest, app: ManifestAppSpec): string {
  const packageName = getPackageName(app);
  const manager = getAppManager(machine, app);
  if (manager === "custom") {
    return packageName;
  }

  if (machine.platform === "macos") {
    if (manager === "cask") {
      return `brew install --cask ${packageName}`;
    }
    return `brew install ${packageName}`;
  }

  if (machine.platform === "windows") {
    return `winget install ${packageName}`;
  }

  return `sudo apt-get install -y ${packageName}`;
}

function buildAppProbeCommand(machine: MachineManifest, app: ManifestAppSpec): string {
  const packageName = shellQuote(getPackageName(app));
  const manager = getAppManager(machine, app);

  if (manager === "custom") {
    return `if command -v ${packageName} >/dev/null 2>&1; then printf 'installed=1\\nversion=custom\\n'; else printf 'installed=0\\n'; fi`;
  }

  if (machine.platform === "macos") {
    if (manager === "cask") {
      return `if brew list --cask ${packageName} >/dev/null 2>&1; then printf 'installed=1\\nversion=installed\\n'; else printf 'installed=0\\n'; fi`;
    }
    return `if brew list --versions ${packageName} >/dev/null 2>&1; then printf 'installed=1\\nversion='; brew list --versions ${packageName} | awk '{print $2}'; printf '\\n'; else printf 'installed=0\\n'; fi`;
  }

  if (machine.platform === "windows") {
    return `if winget list --id ${packageName} --exact >/dev/null 2>&1; then printf 'installed=1\\nversion=installed\\n'; else printf 'installed=0\\n'; fi`;
  }

  return `if dpkg-query -W -f='${'${Version}'}' ${packageName} >/tmp/machines-app-version 2>/dev/null; then printf 'installed=1\\nversion='; cat /tmp/machines-app-version; printf '\\n'; rm -f /tmp/machines-app-version; else printf 'installed=0\\n'; fi`;
}

function buildAppSteps(machine: MachineManifest): SetupStep[] {
  return (machine.apps || []).map((app) => ({
    id: `app-${app.name}`,
    title: `Install ${app.name} on ${machine.id}`,
    command: buildAppCommand(machine, app),
    manager:
      getAppManager(machine, app) === "custom"
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

function parseProbeOutput(app: ManifestAppSpec, machine: MachineManifest, stdout: string): InstalledAppStatus {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const installedLine = lines.find((line) => line.startsWith("installed="));
  const versionLine = lines.find((line) => line.startsWith("version="));
  return {
    name: app.name,
    packageName: getPackageName(app),
    manager: getAppManager(machine, app),
    installed: installedLine === "installed=1",
    version: versionLine?.slice("version=".length) || undefined,
  };
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

export function getAppsStatus(machineId?: string): AppsStatusResult {
  const machine = resolveMachine(machineId);
  const apps = (machine.apps || []).map((app) => {
    const probe = runMachineCommand(machine.id, buildAppProbeCommand(machine, app));
    return parseProbeOutput(app, machine, probe.stdout);
  });
  return {
    machineId: machine.id,
    source: apps.length > 0 ? runMachineCommand(machine.id, "true").source : machine.id === detectCurrentMachineManifest().id ? "local" : runMachineCommand(machine.id, "true").source,
    apps,
  };
}

export function diffApps(machineId?: string): AppsDiffResult {
  const status = getAppsStatus(machineId);
  return {
    ...status,
    missing: status.apps.filter((app) => !app.installed).map((app) => app.name),
    installed: status.apps.filter((app) => app.installed).map((app) => app.name),
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
