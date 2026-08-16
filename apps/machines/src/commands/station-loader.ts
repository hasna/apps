import { runMachineCommand, type MachineCommandOptions, type MachineCommandResult } from "../remote.js";
import { redactErrorMessage } from "../redaction.js";

export type StationLoaderShellMode = "login" | "bare";
export type StationLoaderProbeStatus = "OK" | "NOT-LOADED" | "UNKNOWN";

export interface StationLoaderProbeOptions {
  machineId: string;
  shellMode?: StationLoaderShellMode;
  timeoutMs?: number;
  runner?: StationLoaderProbeRunner;
}

export type StationLoaderProbeRunner = (
  machineId: string,
  command: string,
  options?: MachineCommandOptions,
) => MachineCommandResult;

export interface StationLoaderProbeResult {
  machineId: string;
  shellMode: StationLoaderShellMode;
  status: StationLoaderProbeStatus;
  expectedStatus: StationLoaderProbeStatus;
  assertionPassed: boolean;
  source: MachineCommandResult["source"];
  exitCode: number;
  timedOut: boolean;
  reason: string;
  diagnostic: string | null;
}

export interface StationLoaderProbeSuiteResult {
  machineId: string;
  status: StationLoaderProbeStatus;
  assertionPassed: boolean;
  login: StationLoaderProbeResult;
  bareControl: StationLoaderProbeResult;
  reason: string;
}

const STATUS_VALUES = new Set<StationLoaderProbeStatus>(["OK", "NOT-LOADED", "UNKNOWN"]);

export const STATION_LOADER_BEHAVIOR_PROBE = "if ! command -v secrets >/dev/null 2>&1; then printf \"UNKNOWN\\n\"; exit 2; fi; "
  + "resolved=\"$(secrets path 2>/dev/null || true)\"; "
  + "case \"$resolved\" in "
  + "https://*) printf \"OK\\n\"; exit 0;; "
  + "\"\") printf \"UNKNOWN\\n\"; exit 2;; "
  + "*) printf \"NOT-LOADED\\n\"; exit 3;; "
  + "esac";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildStationLoaderProbeCommand(shellMode: StationLoaderShellMode = "login"): string {
  const probe = shellQuote(STATION_LOADER_BEHAVIOR_PROBE);
  if (shellMode === "bare") {
    return `env -i HOME="\${HOME:-}" PATH="\${PATH:-}" bash -c ${probe}`;
  }
  return `bash -lc ${probe}`;
}

export function parseStationLoaderProbeStatus(stdout: string): StationLoaderProbeStatus {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const value = lines[i];
    if (STATUS_VALUES.has(value as StationLoaderProbeStatus)) return value as StationLoaderProbeStatus;
  }
  return "UNKNOWN";
}

function expectedStatusForMode(shellMode: StationLoaderShellMode): StationLoaderProbeStatus {
  return shellMode === "bare" ? "NOT-LOADED" : "OK";
}

function reasonForStatus(shellMode: StationLoaderShellMode, status: StationLoaderProbeStatus, expectedStatus: StationLoaderProbeStatus): string {
  if (shellMode === "bare" && status === "OK") {
    return "bare environment unexpectedly resolved the shared store; the probe cannot prove loader failability";
  }
  if (status === "OK") return "login shell resolved the secrets CLI to the shared https store";
  if (status === "NOT-LOADED") return shellMode === "bare"
    ? "bare environment did not load the cloud-env loader"
    : "login shell did not resolve the secrets CLI to the shared https store";
  return `probe could not determine loader state; expected ${expectedStatus}`;
}

function diagnosticForExecution(execution: MachineCommandResult, status: StationLoaderProbeStatus): string | null {
  if (status !== "UNKNOWN") return null;
  if (execution.timedOut) return "probe timed out";
  const stderr = execution.stderr.trim();
  if (stderr) return redactErrorMessage(stderr).slice(0, 500);
  return `probe exited ${execution.exitCode} without a status line`;
}

export function probeStationLoader(options: StationLoaderProbeOptions): StationLoaderProbeResult {
  const shellMode = options.shellMode ?? "login";
  const expectedStatus = expectedStatusForMode(shellMode);
  const command = buildStationLoaderProbeCommand(shellMode);
  const runner = options.runner ?? runMachineCommand;
  const execution = runner(options.machineId, command, { timeoutMs: options.timeoutMs });
  const status = parseStationLoaderProbeStatus(execution.stdout);

  return {
    machineId: options.machineId,
    shellMode,
    status,
    expectedStatus,
    assertionPassed: status === expectedStatus,
    source: execution.source,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut === true,
    reason: reasonForStatus(shellMode, status, expectedStatus),
    diagnostic: diagnosticForExecution(execution, status),
  };
}

export function probeStationLoaderWithBareControl(
  options: Omit<StationLoaderProbeOptions, "shellMode">,
): StationLoaderProbeSuiteResult {
  const login = probeStationLoader({ ...options, shellMode: "login" });
  const bareControl = probeStationLoader({ ...options, shellMode: "bare" });

  if (login.status === "OK" && bareControl.status === "NOT-LOADED") {
    return {
      machineId: options.machineId,
      status: "OK",
      assertionPassed: true,
      login,
      bareControl,
      reason: "login shell reported OK and the same probe reported NOT-LOADED in the bare environment",
    };
  }

  if (bareControl.status === "OK") {
    return {
      machineId: options.machineId,
      status: "UNKNOWN",
      assertionPassed: false,
      login,
      bareControl,
      reason: "bare environment unexpectedly reported OK; the probe cannot prove loader failability",
    };
  }

  if (login.status === "NOT-LOADED") {
    return {
      machineId: options.machineId,
      status: "NOT-LOADED",
      assertionPassed: false,
      login,
      bareControl,
      reason: "login shell reported NOT-LOADED",
    };
  }

  return {
    machineId: options.machineId,
    status: "UNKNOWN",
    assertionPassed: false,
    login,
    bareControl,
    reason: "probe could not prove both required states",
  };
}

export function renderStationLoaderProbe(result: StationLoaderProbeResult): string {
  const prefix = `${result.machineId} ${result.status}`;
  const expectation = result.assertionPassed ? "" : `; expected ${result.expectedStatus}`;
  const diagnostic = result.diagnostic ? `; ${result.diagnostic}` : "";
  return `${prefix} (${result.shellMode}: ${result.reason}${expectation}${diagnostic})`;
}

export function renderStationLoaderProbeSuite(result: StationLoaderProbeSuiteResult): string {
  return [
    `${result.machineId} ${result.status} (${result.reason})`,
    `login: ${renderStationLoaderProbe(result.login)}`,
    `bare-control: ${renderStationLoaderProbe(result.bareControl)}`,
  ].join("\n");
}
