import { describe, expect, test } from "bun:test";
import {
  buildStationLoaderProbeCommand,
  parseStationLoaderProbeStatus,
  probeStationLoader,
  probeStationLoaderWithBareControl,
  renderStationLoaderProbe,
  renderStationLoaderProbeSuite,
  STATION_LOADER_BEHAVIOR_PROBE,
  type StationLoaderProbeRunner,
} from "../src/commands/station-loader.js";
import type { MachineCommandResult } from "../src/remote.js";

function machineResult(stdout: string, exitCode = 0, stderr = ""): MachineCommandResult {
  return {
    machineId: "station02",
    source: "local",
    stdout,
    stderr,
    exitCode,
    timedOut: false,
    signal: null,
  };
}

function recordingRunner(stdout: string, exitCode = 0): { runner: StationLoaderProbeRunner; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    runner: (_machineId, command) => {
      commands.push(command);
      return machineResult(stdout, exitCode);
    },
  };
}

function sequenceRunner(results: MachineCommandResult[]): { runner: StationLoaderProbeRunner; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    runner: (_machineId, command) => {
      commands.push(command);
      const next = results.shift();
      if (!next) throw new Error("missing test command result");
      return next;
    },
  };
}

describe("station cloud-env loader probe", () => {
  test("builds the same behavior probe for login and bare-control shells", () => {
    expect(buildStationLoaderProbeCommand("login")).toBe(`bash -lc '${STATION_LOADER_BEHAVIOR_PROBE}'`);
    expect(buildStationLoaderProbeCommand("bare")).toBe(`env -i HOME="\${HOME:-}" PATH="\${PATH:-}" bash -c '${STATION_LOADER_BEHAVIOR_PROBE}'`);
    expect(STATION_LOADER_BEHAVIOR_PROBE).toContain("secrets path");
    expect(STATION_LOADER_BEHAVIOR_PROBE).not.toContain("env |");
    expect(STATION_LOADER_BEHAVIOR_PROBE).not.toContain("printenv");
  });

  test("reports OK when the login shell resolves secrets to the shared store", () => {
    const { runner, commands } = recordingRunner("OK\n", 0);

    const result = probeStationLoader({ machineId: "station02", shellMode: "login", runner });

    expect(result.status).toBe("OK");
    expect(result.expectedStatus).toBe("OK");
    expect(result.assertionPassed).toBe(true);
    expect(commands[0]).toContain("bash -lc");
    expect(renderStationLoaderProbe(result)).toContain("station02 OK");
  });

  test("reports NOT-LOADED as the expected bare-control state", () => {
    const { runner, commands } = recordingRunner("NOT-LOADED\n", 3);

    const result = probeStationLoader({ machineId: "station02", shellMode: "bare", runner });

    expect(result.status).toBe("NOT-LOADED");
    expect(result.expectedStatus).toBe("NOT-LOADED");
    expect(result.assertionPassed).toBe(true);
    expect(commands[0]).toContain("env -i HOME=");
    expect(renderStationLoaderProbe(result)).toContain("station02 NOT-LOADED");
  });

  test("flags a bare-control OK as a probe that cannot prove failability", () => {
    const { runner } = recordingRunner("OK\n", 0);

    const result = probeStationLoader({ machineId: "station02", shellMode: "bare", runner });

    expect(result.status).toBe("OK");
    expect(result.expectedStatus).toBe("NOT-LOADED");
    expect(result.assertionPassed).toBe(false);
    expect(renderStationLoaderProbe(result)).toContain("expected NOT-LOADED");
    expect(renderStationLoaderProbe(result)).toContain("cannot prove loader failability");
  });

  test("reports OK only when login is OK and bare-control is NOT-LOADED", () => {
    const { runner, commands } = sequenceRunner([
      machineResult("OK\n", 0),
      machineResult("NOT-LOADED\n", 3),
    ]);

    const result = probeStationLoaderWithBareControl({ machineId: "station02", runner });

    expect(result.status).toBe("OK");
    expect(result.assertionPassed).toBe(true);
    expect(result.login.status).toBe("OK");
    expect(result.bareControl.status).toBe("NOT-LOADED");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("bash -lc");
    expect(commands[1]).toContain("env -i HOME=");
    expect(renderStationLoaderProbeSuite(result)).toContain("login:");
    expect(renderStationLoaderProbeSuite(result)).toContain("bare-control:");
  });

  test("reports NOT-LOADED when the login shell does not load the shared store", () => {
    const { runner } = sequenceRunner([
      machineResult("NOT-LOADED\n", 3),
      machineResult("NOT-LOADED\n", 3),
    ]);

    const result = probeStationLoaderWithBareControl({ machineId: "station02", runner });

    expect(result.status).toBe("NOT-LOADED");
    expect(result.assertionPassed).toBe(false);
    expect(result.reason).toContain("login shell reported NOT-LOADED");
  });

  test("rejects a bare-control OK because that proves the check cannot fail", () => {
    const { runner } = sequenceRunner([
      machineResult("OK\n", 0),
      machineResult("OK\n", 0),
    ]);

    const result = probeStationLoaderWithBareControl({ machineId: "station02", runner });

    expect(result.status).toBe("UNKNOWN");
    expect(result.assertionPassed).toBe(false);
    expect(result.reason).toContain("cannot prove loader failability");
  });

  test("parses only explicit status lines from command output", () => {
    expect(parseStationLoaderProbeStatus("banner\nOK\n")).toBe("OK");
    expect(parseStationLoaderProbeStatus("/home/hasna/.hasna/secrets/vault.db\n")).toBe("UNKNOWN");
  });
});
