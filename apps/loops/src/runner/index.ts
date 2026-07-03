#!/usr/bin/env bun
import { Command } from "commander";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();

program
  .name("loops-runner")
  .description("OpenLoops control-plane runner foundation")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

export function runnerStatus(machineId = process.env.LOOPS_RUNNER_MACHINE_ID || process.env.HASNA_MACHINE_ID) {
  const deployment = buildDeploymentStatus();
  const local = deployment.deploymentMode === "local";
  return {
    ok: local,
    service: "loops-runner",
    machineId,
    deployment,
    state: local
      ? "local_daemon_authoritative"
      : deployment.controlPlane.configured
        ? "control_plane_protocol_pending"
        : "missing_control_plane_configuration",
  };
}

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(program.opts().json || opts?.json);
}

function printStatus(opts?: { json?: boolean }): void {
  const status = runnerStatus();
  if (wantsJson(opts)) console.log(JSON.stringify(status, null, 2));
  else console.log(`${deploymentStatusLine(status.deployment)} runner=${status.state}${status.machineId ? ` machine=${status.machineId}` : ""}`);
  if (!status.ok) process.exitCode = 1;
}

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

program.action(() => printStatus());

program.command("status").option("-j, --json", "print JSON").action((opts) => printStatus(opts));

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
