import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { daemonStatus } from "../daemon/control.js";
import type { Store } from "./store.js";
import { ensureDataDir } from "./paths.js";
import { preflightTarget } from "./executor.js";
import { workflowExecutionOrder } from "./workflow-spec.js";
import { listOpenMachines } from "./machines.js";
import { buildDeploymentStatus } from "./mode.js";
import { RESTART_INTERRUPTED_RUN_PREFIX } from "./health.js";

export type DoctorSeverity = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorSeverity;
  message: string;
  detail?: string;
  /**
   * Which runtime the check actually looked at. Left unset on the local path,
   * where there is only one runtime; stamped on the hosted path, where a
   * scope-less check is precisely how a clean report about the wrong runtime
   * gets read as a clean report about the failing one.
   */
  scope?: "machine" | "control-plane";
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const PROVIDER_COMMANDS = [
  "claude",
  "agent",
  "codewith",
  "aicopilot",
  "opencode",
  "codex",
];

function hasCommand(command: string): boolean {
  const result = spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null", "sh", command], { stdio: "ignore" });
  return (result.status ?? 1) === 0;
}

function commandVersion(command: string): string | undefined {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) return undefined;
  return (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
}

/**
 * Checks that describe THIS MACHINE's ability to execute a loop: data dir,
 * toolchain, machine topology, provider binaries, and the resolved deployment
 * wiring. They are valid whether the client reads a local sqlite file or a
 * hosted control plane, because they answer "can work run here", not "what does
 * the scheduler hold".
 */
export function localRuntimeChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  try {
    const dir = ensureDataDir();
    accessSync(dir, constants.R_OK | constants.W_OK);
    checks.push({ id: "data-dir", status: "ok", message: "data directory is writable", detail: dir });
  } catch (error) {
    checks.push({
      id: "data-dir",
      status: "fail",
      message: "data directory is not writable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const bunVersion = commandVersion("bun");
  checks.push(
    bunVersion
      ? { id: "bun", status: "ok", message: "bun is available", detail: bunVersion }
      : { id: "bun", status: "fail", message: "bun is not available on PATH" },
  );

  const accountsVersion = commandVersion("accounts");
  checks.push(
    accountsVersion
      ? { id: "accounts", status: "ok", message: "accounts is available", detail: accountsVersion }
      : { id: "accounts", status: "warn", message: "accounts CLI is not available; account-routed steps will fail" },
  );

  try {
    const machines = listOpenMachines();
    const local = machines.find((machine) => machine.local);
    checks.push({
      id: "machines",
      status: "ok",
      message: `OpenMachines topology available (${machines.length} machine(s))`,
      detail: local ? `local=${local.id}` : undefined,
    });
  } catch (error) {
    checks.push({
      id: "machines",
      status: "warn",
      message: "OpenMachines topology is not available; machine-assigned loops will fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  for (const command of PROVIDER_COMMANDS) {
    checks.push(
      hasCommand(command)
        ? { id: `provider:${command}`, status: "ok", message: `${command} is available` }
        : { id: `provider:${command}`, status: "warn", message: `${command} is not on PATH` },
    );
  }

  return checks;
}

export function runDoctor(store: Store): DoctorReport {
  const checks: DoctorCheck[] = [...localRuntimeChecks()];

  const status = daemonStatus(store);
  checks.push(
    status.running
      ? { id: "daemon", status: "ok", message: `daemon is running pid=${status.pid}` }
      : { id: "daemon", status: status.stale ? "warn" : "ok", message: status.stale ? "daemon pid file is stale" : "daemon is not running" },
  );

  const failedRuns = store.countRuns("failed");
  const restartInterruptedRuns = store
    .listRuns({ status: "skipped", limit: 1_000 })
    .filter((run) => run.error?.startsWith(RESTART_INTERRUPTED_RUN_PREFIX)).length;
  checks.push(
    failedRuns === 0
      ? { id: "loop-runs", status: "ok", message: "no failed loop runs recorded" }
      : { id: "loop-runs", status: "warn", message: `${failedRuns} failed loop run(s) recorded` },
  );
  if (restartInterruptedRuns > 0) {
    checks.push({
      id: "loop-runs:restart-interrupted",
      status: "warn",
      message: `${restartInterruptedRuns} daemon restart-interrupted loop run(s) recorded`,
    });
  }

  const deployment = buildDeploymentStatus();
  const schedulerState = deployment.schedulerState;
  checks.push({
    id: "scheduler-state",
    status: deployment.deploymentMode === "local" || deployment.controlPlane.configured ? "ok" : "warn",
    message: `scheduler state authority=${schedulerState.authority} local=${schedulerState.localStore.role} remote=${schedulerState.remoteStore.backend}`,
    detail: [
      `route_state=${schedulerState.routeAdmission.stateStore}`,
      `active_statuses=${schedulerState.routeAdmission.activeStatuses.join(",")}`,
      `gates=${schedulerState.routeAdmission.gates.join(",")}`,
      `artifacts=${schedulerState.localStore.runArtifacts}`,
      `remote_artifacts=${schedulerState.remoteStore.objectArtifacts}`,
      `remote_apply=${String(schedulerState.remoteStore.applySupported)}`,
    ].join(" "),
  });

  for (const loop of store.listLoops({ status: "active" })) {
    try {
      if (loop.target.type === "workflow") {
        const workflow = store.requireWorkflow(loop.target.workflowId);
        for (const step of workflowExecutionOrder(workflow)) {
          preflightTarget(
            {
              ...step.target,
              account: step.account ?? step.target.account,
              timeoutMs: step.timeoutMs !== undefined ? step.timeoutMs : step.target.timeoutMs,
            },
            { loopId: loop.id, loopName: loop.name, workflowId: workflow.id, workflowName: workflow.name, workflowStepId: step.id },
            { machine: loop.machine },
          );
        }
      } else {
        preflightTarget(loop.target, { loopId: loop.id, loopName: loop.name }, { machine: loop.machine });
      }
      checks.push({ id: `loop:${loop.id}:preflight`, status: "ok", message: `active loop target is ready: ${loop.name}` });
    } catch (error) {
      checks.push({
        id: `loop:${loop.id}:preflight`,
        status: "fail",
        message: `active loop target preflight failed: ${loop.name}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}
