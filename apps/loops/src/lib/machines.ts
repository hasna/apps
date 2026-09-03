import type { LoopMachineRef } from "../types.js";
import { ValidationError } from "./errors.js";

/**
 * `@hasna/machines` was deleted from the public registry and from hasna/apps
 * (owner directive, 2026-09-03). Machine-assigned loops are no longer
 * supported: every machine-routing entry point fails loudly with the same
 * unavailable error the optional dependency used to surface when it was not
 * installed, so no loop can silently degrade into an unclaimable NULL pin.
 */

export interface MachineCommandPlan {
  command: string;
  args: string[];
  source: string;
}

export interface OpenMachineSummary {
  id: string;
  hostname?: string;
  platform?: string;
  user?: string;
  workspacePath?: string;
  route?: string;
  local: boolean;
  heartbeatStatus?: string;
  tailscaleOnline?: boolean | null;
  tags: string[];
}

const MACHINES_DELETED =
  "@hasna/machines has been deleted (2026-09-03); machine-assigned loops are no longer supported. Remove the machine pin and run the loop locally.";

function machinesUnavailable(): never {
  throw new Error(MACHINES_DELETED);
}

export function listOpenMachines(): OpenMachineSummary[] {
  return machinesUnavailable();
}

export function resolveLoopMachine(_machineId: string): LoopMachineRef {
  return machinesUnavailable();
}

export function resolveMachineCommand(_machineId: string, _command: string): MachineCommandPlan {
  return machinesUnavailable();
}

export function refreshLoopMachine(_machine: LoopMachineRef): LoopMachineRef {
  return machinesUnavailable();
}

/**
 * Fail-closed validation of an incoming machine assignment on a create path.
 *
 * The scheduler gates every claim on the STORED machine ref
 * (`runnerMatchesLoop` reads `machine.id`), so a stored value that is not a
 * well-formed ref is a loop that can never be claimed: a bare string stores
 * as machine_json `"spark02"` whose `id` is undefined, matching no runner,
 * and an empty object matches no runner either. Both present as "leased but
 * never executed" — the O15-00172 assignment-loss class. Every surface that
 * can place a machine on a loop (server create route, SDK create) must pass
 * machine values through here so a malformed pin fails loudly at create time
 * instead of persisting an unclaimable loop.
 */
export function validateLoopMachineRef(machine: unknown, label = "machine"): asserts machine is LoopMachineRef {
  if (!machine || typeof machine !== "object" || Array.isArray(machine)) {
    throw new ValidationError(`${label} must be an object with a non-empty string id`);
  }
  const id = (machine as { id?: unknown }).id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new ValidationError(`${label}.id must be a non-empty string`);
  }
}