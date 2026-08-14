import { detectCurrentMachineManifest, findManifestMachine, getManifestMachine, readManifest } from "../manifests.js";
import { resolveExactManifestPath } from "../paths.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { requireMachineCommandSuccess, runMachineCommand, type MachineCommandRunner } from "../remote.js";
import { resolveDesiredPackages, type DesiredPackage } from "./reconcile.js";
import {
  buildExactBunAppsPlan,
  defaultExactBunSourceLoader,
  exactBunPackages,
  runExactBunControllerStatus,
  runExactBunControllerTransaction,
  validateExactBunMachine,
  type ExactBunBootstrapSourceLoader,
  type ExactBunSourceLoader,
} from "./bun-registry-installer.js";
import type {
  AppsDiffResult,
  AppsPlanResult,
  AppsStatusResult,
  AppsValidationResult,
  ExactBunAppsPlan,
  ExactBunAppsStatusResult,
  InstalledAppStatus,
  MachineManifest,
  ManifestAppSpec,
  SetupStep,
} from "../types.js";

export interface AppsManifestOptions {
  manifestPath?: string;
  env?: NodeJS.ProcessEnv;
  installedState?: ExactBunAppsStatusResult;
  bootstrapSourceLoader?: ExactBunBootstrapSourceLoader;
}

function isExactAppsPlan(plan: AppsPlanResult): plan is ExactBunAppsPlan {
  return "schema" in plan && plan.schema === "machines.apps.plan.v2";
}

function readExactBunAppsStatus(
  machine: MachineManifest,
  runner: MachineCommandRunner,
  bootstrapSourceLoader?: ExactBunBootstrapSourceLoader,
): ExactBunAppsStatusResult {
  const desiredPlan = buildExactBunAppsPlan(machine);
  const status = runExactBunControllerStatus(machine, desiredPlan, runner, bootstrapSourceLoader);
  return {
    schema: "machines.apps.status.v2",
    machineId: machine.id,
    platform: desiredPlan.platform,
    source: status.source,
    packages: status.result.probes,
    status: status.result.probes.every((probe) => probe.status === "pass") ? "pass" : "unmanaged",
    reasonCodes: [],
  };
}

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

function packageStepId(packageName: string): string {
  return `package-${packageName.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

function packageSelector(spec: DesiredPackage): string {
  if (!spec.version) throw new Error(`Package ${spec.name} must declare an exact version for apps install.`);
  return `${spec.name}@${spec.version}`;
}

function packageVersionProbeCommand(spec: DesiredPackage): string {
  const bin = shellQuote(spec.bin);
  const managerBin = shellQuote(spec.bin);
  return [
    `if bunBin=$(bun pm bin -g 2>/dev/null) && [ -n "$bunBin" ] && [ -x "$bunBin"/${managerBin} ]; then`,
    `managerPath="$bunBin"/${managerBin};`,
    `if output=$("$managerPath" --version 2>/dev/null); then`,
    "version=$(printf '%s\\n' \"$output\" | awk 'match($0, /[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?/) { print substr($0, RSTART, RLENGTH); exit }');",
    `activePath=$(command -v ${bin} 2>/dev/null || true);`,
    `managerIdentity=$(readlink -f "$managerPath" 2>/dev/null || realpath "$managerPath" 2>/dev/null || printf '%s' "$managerPath");`,
    `activeIdentity=$(if [ -n "$activePath" ]; then readlink -f "$activePath" 2>/dev/null || realpath "$activePath" 2>/dev/null || printf '%s' "$activePath"; fi);`,
    `if [ -n "$version" ]; then if [ -z "$activePath" ]; then printf 'installed=0\\n'; elif [ "$activeIdentity" != "$managerIdentity" ]; then printf 'installed=1\\nversion=%s\\nowner=bun\\nmanager_path=%s\\nactive_path=%s\\ncollision=1\\n' \"$version\" \"$managerPath\" \"$activePath\"; else printf 'installed=1\\nversion=%s\\n' \"$version\"; fi; else printf 'installed=0\\n'; fi;`,
    "else printf 'installed=0\\n'; fi",
    "else printf 'installed=0\\n'; fi",
  ].join(" ");
}

function readSelectedManifest(options: AppsManifestOptions): ReturnType<typeof readManifest> {
  const manifestPath = options.manifestPath === undefined && options.env === undefined
    ? undefined
    : resolveExactManifestPath(options.manifestPath, options.env);
  return readManifest(manifestPath);
}

function packageSpecsForApps(machine: MachineManifest, options: AppsManifestOptions): DesiredPackage[] {
  const manifest = readSelectedManifest(options);
  if (!manifest.machines.some((entry) => entry.id === machine.id)) return [];
  return resolveDesiredPackages(manifest, machine.id)
    .filter((spec) => spec.version !== undefined && spec.verify !== false && spec.exactBunRegistry === undefined);
}

function buildPackageSteps(machine: MachineManifest, options: AppsManifestOptions = {}): SetupStep[] {
  return packageSpecsForApps(machine, options).map((spec) => ({
    id: packageStepId(spec.name),
    title: `Install ${packageSelector(spec)} on ${machine.id}`,
    command: `bun install -g ${shellQuote(packageSelector(spec))}`,
    manager: "bun",
    privileged: false,
    probeCommand: packageVersionProbeCommand(spec),
    expectedVersion: spec.version,
  }));
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

function parseStepProbeOutput(step: SetupStep, stdout: string): { installed: boolean; version?: string } {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const installedLines = lines.filter((line) => line.startsWith("installed="));
  const versionLines = lines.filter((line) => line.startsWith("version="));
  const ownerLines = lines.filter((line) => line.startsWith("owner="));
  const managerPathLines = lines.filter((line) => line.startsWith("manager_path="));
  const activePathLines = lines.filter((line) => line.startsWith("active_path="));
  const collisionLines = lines.filter((line) => line.startsWith("collision="));
  const recognizedLineCount = installedLines.length + versionLines.length + ownerLines.length
    + managerPathLines.length + activePathLines.length + collisionLines.length;
  if (installedLines.length !== 1 || recognizedLineCount !== lines.length) {
    throw new Error(`App probe ${step.id} returned malformed output: expected one installed=0|1 line and an optional version line.`);
  }

  const installedValue = installedLines[0]!.slice("installed=".length);
  if (installedValue !== "0" && installedValue !== "1") {
    throw new Error(`App probe ${step.id} returned malformed output: installed must be 0 or 1.`);
  }

  if (installedValue === "0") {
    if (versionLines.length > 0) {
      throw new Error(`App probe ${step.id} returned malformed output: an absent app must not report a version.`);
    }
    return { installed: false };
  }

  if (versionLines.length !== 1) {
    throw new Error(`App probe ${step.id} returned malformed output: installed=1 requires exactly one version line.`);
  }
  const version = versionLines[0]!.slice("version=".length);
  if (!version.trim()) {
    throw new Error(`App probe ${step.id} returned malformed output: version must not be blank.`);
  }
  if (collisionLines.length === 0 && (ownerLines.length > 0 || managerPathLines.length > 0 || activePathLines.length > 0)) {
    throw new Error(`App probe ${step.id} returned malformed output: owner/PATH metadata requires collision=1.`);
  }
  if (collisionLines.length > 0) {
    if (ownerLines.length !== 1 || ownerLines[0] !== "owner=bun"
      || managerPathLines.length !== 1 || activePathLines.length !== 1
      || collisionLines.length !== 1 || collisionLines[0] !== "collision=1") {
      throw new Error(`App probe ${step.id} returned malformed output: owner/PATH collision details are incomplete.`);
    }
    throw new Error(
      `App verify ${step.id} failed: owner/PATH collision: Bun-managed ${managerPathLines[0]!.slice("manager_path=".length)} reports ${version}, `
      + `but active PATH resolves ${activePathLines[0]!.slice("active_path=".length)}.`,
    );
  }
  return { installed: true, version };
}

function requireStepProbeSuccess(step: SetupStep, result: ReturnType<typeof requireMachineCommandSuccess>): void {
  const parsed = parseStepProbeOutput(step, result.stdout);
  if (!parsed.installed) throw new Error(`App verify ${step.id} failed: executable not installed.`);
  if (step.expectedVersion !== undefined && parsed.version !== step.expectedVersion) {
    throw new Error(`App verify ${step.id} failed: ${parsed.version ?? "no version"} reported, expected ${step.expectedVersion}.`);
  }
}

function resolveMachine(machineId?: string, options: AppsManifestOptions = {}, requireExactTarget = false): MachineManifest {
  const manifestPath = options.manifestPath === undefined && options.env === undefined
    ? undefined
    : resolveExactManifestPath(options.manifestPath, options.env);
  if (!machineId) {
    if (requireExactTarget) throw new Error("Exact app candidate operations require --machine <id>.");
    return detectCurrentMachineManifest();
  }
  if (manifestPath) {
    const manifest = readManifest(manifestPath);
    const machine = findManifestMachine(manifest, machineId);
    if (machine && exactBunPackages(machine).length > 0 && manifest.machines.length !== 1) {
      throw new Error("Exact app candidate manifest must contain exactly one target machine.");
    }
    if (machine) return machine;
  } else {
    const machine = getManifestMachine(machineId);
    if (machine) return machine;
  }
  if (requireExactTarget) throw new Error("Exact app candidate target is missing from the selected manifest.");
  return {
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

export function listApps(machineId?: string, options: AppsManifestOptions = {}): { machineId: string; apps: ManifestAppSpec[] } {
  const machine = resolveMachine(machineId, options);
  return {
    machineId: machine.id,
    apps: machine.apps || [],
  };
}

export function buildAppsPlan(machineId?: string, options: AppsManifestOptions = {}): AppsPlanResult {
  const machine = resolveMachine(machineId, options, options.manifestPath !== undefined);
  if (exactBunPackages(machine).length > 0) return buildExactBunAppsPlan(machine, options.installedState);
  return attachMutationPlanDigest({
    machineId: machine.id,
    mode: "plan",
    steps: [...buildAppSteps(machine), ...buildPackageSteps(machine, options)],
    executed: 0,
  });
}

export interface RunAppsInstallOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
  manifestPath?: string;
  env?: NodeJS.ProcessEnv;
  sourceLoader?: ExactBunSourceLoader;
  installedState?: ExactBunAppsStatusResult;
  bootstrapSourceLoader?: ExactBunBootstrapSourceLoader;
}

export function validateAppsCandidate(machineId: string, options: AppsManifestOptions = {}): AppsValidationResult {
  const errors: string[] = [];
  let machine: MachineManifest | null = null;
  try {
    const manifestPath = resolveExactManifestPath(options.manifestPath, options.env);
    const manifest = readManifest(manifestPath);
    if (manifest.machines.length !== 1) errors.push("candidate_manifest_not_target_only");
    machine = findManifestMachine(manifest, machineId);
    if (!machine) errors.push("target_missing");
    else errors.push(...validateExactBunMachine(machine));
  } catch (error) {
    const message = error instanceof Error ? error.message : "manifest_invalid";
    errors.push(message.startsWith("Explicit --manifest") ? "manifest_authority_conflict" : "manifest_invalid");
  }
  return {
    schema: "machines.apps.validation.v1",
    valid: errors.length === 0,
    machineId,
    platform: machine?.platform ?? null,
    packageCount: machine ? exactBunPackages(machine).length : 0,
    errors,
    warnings: [],
  };
}

export function getAppsStatus(
  machineId?: string,
  runner: MachineCommandRunner = runMachineCommand,
  options: AppsManifestOptions = {},
): AppsStatusResult | ExactBunAppsStatusResult {
  const machine = resolveMachine(machineId, options, options.manifestPath !== undefined);
  if (exactBunPackages(machine).length > 0) {
    return readExactBunAppsStatus(machine, runner, options.bootstrapSourceLoader);
  }
  const readiness = requireMachineCommandSuccess("Apps status readiness check", runner(machine.id, "true"));
  const apps: InstalledAppStatus[] = (machine.apps || []).map((app) => {
    const probe = requireMachineCommandSuccess(`App probe ${app.name}`, runner(machine.id, buildAppProbeCommand(machine, app)));
    return parseProbeOutput(app, machine, probe.stdout);
  });
  for (const spec of packageSpecsForApps(machine, options)) {
    const probeCommand = packageVersionProbeCommand(spec);
    const probe = requireMachineCommandSuccess(`App probe ${spec.name}`, runner(machine.id, probeCommand, { redactOutput: true }));
    const parsed = parseStepProbeOutput({
      id: packageStepId(spec.name),
      title: `Probe ${spec.name} on ${machine.id}`,
      command: probeCommand,
      manager: "bun",
      privileged: false,
      probeCommand,
      expectedVersion: spec.version,
    }, probe.stdout);
    apps.push({
      name: spec.name,
      packageName: spec.name,
      manager: "bun",
      installed: parsed.installed && parsed.version === spec.version,
      ...(parsed.version ? { version: parsed.version } : {}),
    });
  }
  return {
    machineId: machine.id,
    source: readiness.source,
    apps,
  };
}

export function diffApps(machineId?: string, runner: MachineCommandRunner = runMachineCommand, options: AppsManifestOptions = {}): AppsDiffResult {
  const status = getAppsStatus(machineId, runner, options);
  if ("packages" in status) throw new Error("Exact Bun registry candidates use apps status instead of legacy apps diff.");
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
): AppsPlanResult {
  const plan = buildAppsPlan(machineId, options);
  return runAppsPlan(plan, options, runner);
}

export function runAppsPlan(
  plan: AppsPlanResult,
  options: RunAppsInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): AppsPlanResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  if (!options.yes) {
    throw new Error("App installation requires --yes.");
  }

  if (isExactAppsPlan(plan)) {
    if (!options.expectedPlanDigest) throw new Error("Exact Bun app installation requires --expected-plan-digest.");
    const machine = resolveMachine(plan.machineId, options, true);
    const currentPlan = buildExactBunAppsPlan(machine, options.installedState);
    assertMutationPlanDigest(currentPlan, options.expectedPlanDigest);
    if (options.installedState) {
      const liveStatus = readExactBunAppsStatus(machine, runner, options.bootstrapSourceLoader);
      const livePlan = buildExactBunAppsPlan(machine, liveStatus);
      if (livePlan.planDigest !== currentPlan.planDigest) throw new Error("installed_state_stale");
    }
    if (currentPlan.steps.length === 0) {
      return {
        ...currentPlan,
        mode: "apply",
        executed: 0,
        probes: currentPlan.probes ?? [],
        state: "COMMITTED",
        reasonCodes: [],
      };
    }
    const parsed = runExactBunControllerTransaction(
      machine,
      currentPlan,
      options.sourceLoader ?? defaultExactBunSourceLoader,
      runner,
      options.bootstrapSourceLoader,
    );
    return {
      ...currentPlan,
      mode: "apply",
      executed: parsed.executed,
      probes: parsed.probes,
      state: parsed.state,
      reasonCodes: parsed.reasonCodes,
    };
  }

  let executed = 0;
  for (const step of plan.steps) {
    requireMachineCommandSuccess(
      `App install ${step.id}`,
      runner(plan.machineId, step.command, step.manager === "bun" ? { redactOutput: true } : undefined),
    );
    executed += 1;
    if (step.probeCommand) {
      const probe = requireMachineCommandSuccess(
        `App verify ${step.id}`,
        runner(plan.machineId, step.probeCommand, { redactOutput: true }),
      );
      requireStepProbeSuccess(step, probe);
    }
  }

  return attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  });
}
