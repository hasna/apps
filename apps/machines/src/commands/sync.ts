import { existsSync, lstatSync, readFileSync, symlinkSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { readManifest } from "../manifests.js";
import { ensureParentDir } from "../paths.js";
import { getLocalMachineId, recordSyncRun } from "../db.js";
import type { MachineManifest, SyncAction, SyncResult } from "../types.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function packageCheckCommand(machine: MachineManifest, packageName: string, manager = machine.platform === "macos" ? "brew" : "apt"): string {
  if (manager === "bun") {
    return `bun pm ls -g --all | grep -F ${quote(packageName)}`;
  }
  if (manager === "brew") {
    return `brew list --versions ${quote(packageName)}`;
  }
  if (manager === "apt") {
    return `dpkg -s ${quote(packageName)} >/dev/null 2>&1`;
  }
  return `command -v ${quote(packageName)} >/dev/null 2>&1`;
}

function packageInstallCommand(machine: MachineManifest, packageName: string, manager = machine.platform === "macos" ? "brew" : "apt"): string {
  if (manager === "bun") {
    return `bun install -g ${packageName}`;
  }
  if (manager === "brew") {
    return `brew install ${packageName}`;
  }
  if (manager === "apt") {
    return `sudo apt-get install -y ${packageName}`;
  }
  return packageName;
}

function detectPackageActions(machine: MachineManifest): SyncAction[] {
  return (machine.packages || []).map((pkg, index) => {
    const manager = pkg.manager || (machine.platform === "macos" ? "brew" : "apt");
    const check = Bun.spawnSync(["bash", "-lc", packageCheckCommand(machine, pkg.name, manager)], {
      stdout: "ignore",
      stderr: "ignore",
      env: process.env,
    });
    const installed = check.exitCode === 0;
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

export function buildSyncPlan(machineId?: string): SyncResult {
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

  const actions = [
    ...detectPackageActions(target),
    ...detectFileActions(target),
  ];

  return {
    machineId: target.id,
    mode: "plan",
    actions,
    executed: 0,
  };
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

export function runSync(machineId?: string, options: { apply?: boolean; yes?: boolean } = {}): SyncResult {
  const plan = buildSyncPlan(machineId);
  if (!options.apply) {
    return plan;
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
      const result = Bun.spawnSync(["bash", "-lc", action.command], {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });
      if (result.exitCode !== 0) {
        recordSyncRun(plan.machineId, "failed", {
          executed,
          failedAction: action,
          stderr: result.stderr.toString(),
        });
        throw new Error(`Sync action failed (${action.id}): ${result.stderr.toString().trim()}`);
      }
    }
    executed += 1;
  }

  const summary: SyncResult = {
    machineId: plan.machineId,
    mode: "apply",
    actions: plan.actions,
    executed,
  };
  recordSyncRun(plan.machineId, "completed", summary);
  return summary;
}
