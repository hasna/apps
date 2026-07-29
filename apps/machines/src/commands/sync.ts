import { existsSync, lstatSync, readFileSync, symlinkSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { readManifest } from "../manifests.js";
import { ensureParentDir } from "../paths.js";
import { getLocalMachineId, recordSyncRun } from "../db.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { describeMachineCommandFailure, resolveMachineCommand, runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { MachineManifest, SyncAction, SyncResult } from "../types.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function packageCheckCommand(machine: MachineManifest, packageName: string, manager = machine.platform === "macos" ? "brew" : "apt"): string {
  const quotedPackageName = quote(packageName);
  if (manager === "bun") {
    return `if bun pm ls -g --all 2>/dev/null | grep -F ${quotedPackageName} >/dev/null 2>&1; then printf 'installed=1\\n'; else printf 'installed=0\\n'; fi`;
  }
  if (manager === "brew") {
    return `if brew list --versions ${quotedPackageName} >/dev/null 2>&1; then printf 'installed=1\\n'; else printf 'installed=0\\n'; fi`;
  }
  if (manager === "apt") {
    return `if dpkg -s ${quotedPackageName} >/dev/null 2>&1; then printf 'installed=1\\n'; else printf 'installed=0\\n'; fi`;
  }
  return `if command -v ${quotedPackageName} >/dev/null 2>&1; then printf 'installed=1\\n'; else printf 'installed=0\\n'; fi`;
}

function packageInstallCommand(machine: MachineManifest, packageName: string, manager = machine.platform === "macos" ? "brew" : "apt"): string {
  if (manager === "bun") {
    return `bun install -g ${quote(packageName)}`;
  }
  if (manager === "brew") {
    return `brew install ${quote(packageName)}`;
  }
  if (manager === "apt") {
    return `sudo apt-get install -y ${quote(packageName)}`;
  }
  return packageName;
}

function detectPackageActions(machine: MachineManifest, runner: MachineCommandRunner): SyncAction[] {
  return (machine.packages || []).map((pkg, index) => {
    const manager = pkg.manager || (machine.platform === "macos" ? "brew" : "apt");
    const check = runner(machine.id, packageCheckCommand(machine, pkg.name, manager));
    if (check.exitCode !== 0) {
      throw new Error(describeMachineCommandFailure(`Sync package probe ${pkg.name}`, check));
    }
    const installed = check.stdout.split("\n").some((line) => line.trim() === "installed=1");
    return {
      id: `package-${index + 1}`,
      title: `${installed ? "Package present" : "Install package"} ${pkg.name}`,
      command: packageInstallCommand(machine, pkg.name, manager),
      status: installed ? "ok" : "missing",
      kind: "package",
    };
  });
}

function detectFileActions(machine: MachineManifest): SyncAction[] {
  if ((machine.files || []).length > 0 && resolveMachineCommand(machine.id, "true").source !== "local") {
    throw new Error(`Remote file sync planning is not supported for ${machine.id}; refusing to inspect or apply local paths as remote state.`);
  }

  return (machine.files || []).map((file, index) => {
    const sourceExists = existsSync(file.source);
    const targetExists = existsSync(file.target);
    let status: SyncAction["status"] = "missing";
    if (sourceExists && targetExists) {
      if (file.mode === "symlink") {
        status = lstatSync(file.target).isSymbolicLink() ? "ok" : "drifted";
      } else {
        const source = readFileSync(file.source, "utf8");
        const target = readFileSync(file.target, "utf8");
        status = source === target ? "ok" : "drifted";
      }
    }

    const command =
      file.mode === "symlink"
        ? `ln -sfn ${quote(file.source)} ${quote(file.target)}`
        : `cp ${quote(file.source)} ${quote(file.target)}`;

    return {
      id: `file-${index + 1}`,
      title: `${status === "ok" ? "File in sync" : "Reconcile file"} ${file.target}`,
      command,
      status,
      kind: "file",
    };
  });
}

export function buildSyncPlan(machineId?: string, runner: MachineCommandRunner = runMachineCommand): SyncResult {
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

  const actions = [
    ...detectPackageActions(target, runner),
    ...detectFileActions(target),
  ];

  return attachMutationPlanDigest({
    machineId: target.id,
    mode: "plan",
    actions,
    executed: 0,
  });
}

function applyFileAction(command: string): void {
  const [verb, source, target] = command.split(" ");
  if (verb === "cp" && source && target) {
    ensureParentDir(target);
    copyFileSync(source.slice(1, -1), target.slice(1, -1));
    return;
  }

  if (verb === "ln" && source && target) {
    const sourcePath = command.match(/ln -sfn '(.+)' '(.+)'/)?.[1];
    const targetPath = command.match(/ln -sfn '(.+)' '(.+)'/)?.[2];
    if (!sourcePath || !targetPath) {
      throw new Error(`Unable to parse symlink command: ${command}`);
    }
    ensureParentDir(targetPath);
    try {
      Bun.file(targetPath).delete();
    } catch {}
    symlinkSync(sourcePath, targetPath);
  }
}

export interface RunSyncOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
}

export function runSync(
  machineId?: string,
  options: RunSyncOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SyncResult {
  const plan = buildSyncPlan(machineId, runner);
  return runSyncPlan(plan, options, runner);
}

export function runSyncPlan(
  plan: SyncResult,
  options: RunSyncOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SyncResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) {
    return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  }

  if (!options.yes) {
    throw new Error("Sync execution requires --yes.");
  }

  let executed = 0;
  for (const action of plan.actions) {
    if (action.status === "ok") continue;
    if (action.kind === "file") {
      applyFileAction(action.command);
    } else {
      const result = runner(plan.machineId, action.command);
      if (result.exitCode !== 0) {
        recordSyncRun(plan.machineId, "failed", {
          executed,
          failedAction: action,
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode,
          source: result.source,
        });
        throw new Error(describeMachineCommandFailure(`Sync action ${action.id}`, result));
      }
    }
    executed += 1;
  }

  const summary: SyncResult = attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    actions: plan.actions,
    executed,
  });
  recordSyncRun(plan.machineId, "completed", summary);
  return summary;
}
