import { SqliteAdapter as Database } from "../storage.js";
import { getCurrentMachineId } from "../db/machines.js";
import type { MemoryFilter, Memory } from "../types/index.js";

/**
 * Raised when the caller did not name a machine and this machine's identity
 * could not be resolved.
 *
 * It exists because the previous `catch { return null }` produced a value that
 * is INDISTINGUISHABLE from an explicit `machineId: null`, and the two
 * transports then read that same `null` in opposite ways:
 *
 *   local  — `src/db/memories.ts` maps `visible_to_machine_id === null` to
 *            `machine_id IS NULL`, hiding every machine-scoped memory;
 *   hosted — `toQuery` DROPS a null, so the parameter never reaches the
 *            server, the server never sets the filter, and memories scoped to
 *            OTHER machines come back.
 *
 * One swallowed failure, two opposite wrong answers, neither visible to the
 * caller. Refusing is the only reading that is safe on both.
 */
export class MachineIdentityUnresolvedError extends Error {
  readonly code = "MEMENTOS_MACHINE_IDENTITY_UNRESOLVED";
  constructor(cause: unknown) {
    super(
      "mementos could not resolve this machine's identity, so it cannot apply the " +
        "machine-visibility filter. Refusing rather than guessing: dropping the filter would " +
        "expose memories scoped to other machines, and forcing it to null would hide every " +
        "machine-scoped memory. Pass an explicit machine id, or pass null to ask for the " +
        "machine-agnostic view on purpose. Cause: " +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = "MachineIdentityUnresolvedError";
    this.cause = cause;
  }
}

/**
 * The machine id to scope a read to.
 *
 * An EXPLICIT argument always wins, including an explicit `null` — that is how
 * a caller asks for the machine-agnostic view deliberately. Only the implicit
 * case consults this machine's identity, and only the implicit case can fail:
 * it throws {@link MachineIdentityUnresolvedError} instead of degrading.
 */
export function resolveVisibleMachineId(
  machineId?: string | null,
  db?: Database
): string | null {
  if (machineId !== undefined) {
    return machineId;
  }

  try {
    return getCurrentMachineId(db);
  } catch (e) {
    throw new MachineIdentityUnresolvedError(e);
  }
}

export function visibleToMachineFilter(
  machineId?: string | null,
  db?: Database
): Pick<MemoryFilter, "visible_to_machine_id"> {
  return {
    visible_to_machine_id: resolveVisibleMachineId(machineId, db),
  };
}

/**
 * Is this memory visible from the given machine?
 *
 * A predicate has a safe answer where a filter does not: when the identity
 * cannot be resolved, a machine-scoped memory is NOT shown. That is the
 * closed answer, so this stays total and does not throw.
 */
export function isMemoryVisibleToMachine(
  memory: Pick<Memory, "machine_id">,
  machineId?: string | null,
  db?: Database
): boolean {
  if (!memory.machine_id) {
    return true;
  }

  let visibleMachineId: string | null;
  try {
    visibleMachineId = resolveVisibleMachineId(machineId, db);
  } catch (e) {
    if (e instanceof MachineIdentityUnresolvedError) return false;
    throw e;
  }
  return visibleMachineId !== null && memory.machine_id === visibleMachineId;
}
