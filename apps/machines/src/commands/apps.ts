import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { requireMachineCommandSuccess, runMachineCommand, type MachineCommandRunner } from "../remote.js";
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
  const quotedPackageName = shellQuote(packageName);
  const manager = getAppManager(machine, app);
  if (manager === "custom") {
    return app.installCommand ?? packageName;
  }

  if (machine.platform === "macos") {
    if (manager === "cask") {
      return `brew install --cask ${quotedPackageName}`;
    }
    return `brew install ${quotedPackageName}`;
  }

  if (machine.platform === "windows") {
    return `winget install ${quotedPackageName}`;
  }

  return `sudo apt-get install -y ${quotedPackageName}`;
}

function buildAppProbeCommand(machine: MachineManifest, app: ManifestAppSpec): string {
  const packageName = shellQuote(getPackageName(app));
  const manager = getAppManager(machine, app);

  if (manager === "custom") {
    if (app.probeCommand) return app.probeCommand;
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
  return (machine.apps || []).map((app) => {
    const appManager = getAppManager(machine, app);
    const step: SetupStep = {
      id: `app-${app.name}`,
      title: `Install ${app.name} on ${machine.id}`,
      command: buildAppCommand(machine, app),
      manager:
        appManager === "custom"
          ? "custom"
          : machine.platform === "macos"
            ? "brew"
            : machine.platform === "windows"
              ? "custom"
              : "apt",
      privileged: machine.platform === "linux",
    };
    if (appManager === "custom" && app.probeCommand) {
      step.probeCommand = app.probeCommand;
      if (app.expectedVersion) step.expectedVersion = app.expectedVersion;
    }
    return step;
  });
}

function resolveMachine(machineId?: string): MachineManifest {
  if (!machineId) return detectCurrentMachineManifest();
  return getManifestMachine(machineId) || {
    id: machineId,
    platform: "linux",
    workspacePath: "",
    apps: [],
  };
}

function parseProbeOutput(app: ManifestAppSpec, machine: MachineManifest, stdout: string): InstalledAppStatus {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const installedLines = lines.filter((line) => line.startsWith("installed="));
  const versionLines = lines.filter((line) => line.startsWith("version="));
  const recognizedLineCount = installedLines.length + versionLines.length;
  if (installedLines.length !== 1 || recognizedLineCount !== lines.length) {
    throw new Error(`App probe ${app.name} returned malformed output: expected one installed=0|1 line and an optional version line.`);
  }

  const installedValue = installedLines[0]!.slice("installed=".length);
  if (installedValue !== "0" && installedValue !== "1") {
    throw new Error(`App probe ${app.name} returned malformed output: installed must be 0 or 1.`);
  }

  if (installedValue === "0") {
    if (versionLines.length > 0) {
      throw new Error(`App probe ${app.name} returned malformed output: an absent app must not report a version.`);
    }
    return {
      name: app.name,
      packageName: getPackageName(app),
      manager: getAppManager(machine, app),
      installed: false,
    };
  }

  if (versionLines.length !== 1) {
    throw new Error(`App probe ${app.name} returned malformed output: installed=1 requires exactly one version line.`);
  }
  const version = versionLines[0]!.slice("version=".length);
  if (!version.trim()) {
    throw new Error(`App probe ${app.name} returned malformed output: version must not be blank.`);
  }
  const expectedVersion = getAppManager(machine, app) === "custom" ? app.expectedVersion : undefined;
  return {
    name: app.name,
    packageName: getPackageName(app),
    manager: getAppManager(machine, app),
    installed: expectedVersion === undefined || version === expectedVersion,
    version,
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
  return attachMutationPlanDigest({
    machineId: machine.id,
    mode: "plan",
    steps: buildAppSteps(machine),
    executed: 0,
  });
}

export interface RunAppsInstallOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
}

export function getAppsStatus(machineId?: string, runner: MachineCommandRunner = runMachineCommand): AppsStatusResult {
  const machine = resolveMachine(machineId);
  const readiness = requireMachineCommandSuccess("Apps status readiness check", runner(machine.id, "true"));
  const apps = (machine.apps || []).map((app) => {
    const probe = requireMachineCommandSuccess(`App probe ${app.name}`, runner(machine.id, buildAppProbeCommand(machine, app)));
    return parseProbeOutput(app, machine, probe.stdout);
  });
  return {
    machineId: machine.id,
    source: readiness.source,
    apps,
  };
}

export function diffApps(machineId?: string, runner: MachineCommandRunner = runMachineCommand): AppsDiffResult {
  const status = getAppsStatus(machineId, runner);
  return {
    ...status,
    missing: status.apps.filter((app) => !app.installed).map((app) => app.name),
    installed: status.apps.filter((app) => app.installed).map((app) => app.name),
  };
}

export function runAppsInstall(
  machineId?: string,
  options: RunAppsInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  const plan = buildAppsPlan(machineId);
  return runAppsPlan(plan, options, runner);
}

export function runAppsPlan(
  plan: SetupResult,
  options: RunAppsInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  if (!options.yes) {
    throw new Error("App installation requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    requireMachineCommandSuccess(`App install ${step.id}`, runner(plan.machineId, step.command));
    executed += 1;
  }

  return attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  });
}
