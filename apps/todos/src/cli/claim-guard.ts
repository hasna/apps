/**
 * The identity a lock-sensitive verb may use, shared by `start`, `lock`,
 * `bulk start`, `done`, and `unlock`.
 *
 * These verbs are different in kind from `add`. `add` may legitimately produce an
 * ownerless row — an unrouted task is a visible, recoverable state, and #142 chose
 * to warn and continue rather than refuse. A CLAIM cannot do the same, because it
 * writes `locked_by`: the column that decides which session holds a task. There is
 * no coherent "held by nobody in particular" — that value IS the defect.
 *
 * What was there before (todos task cf995f20): `globalOpts.agent || "cli"`, whose
 * result `startTask` writes into BOTH `assigned_to` and `locked_by`. Two costs:
 *
 *  - `assigned_to` was overwritten with a placeholder the moment anyone started
 *    the task, and a non-empty bogus assignee is worse than NULL because a
 *    coverage audit reads it as routed and skips the row.
 *  - Every session that omitted `--agent` shared ONE lock identity. `startTask`'s
 *    predicate admits `locked_by = ?`, and `lockTask` treats a matching
 *    `locked_by` as a LEASE RENEWAL, so any such session could take, renew and
 *    hold any other's lock. A lock that cannot distinguish its holders is not a
 *    lock.
 *
 * That expression also never consulted TODOS_AGENT_ID, so the per-session escape
 * hatch `lib/creator-identity.ts` recommends for concurrent sessions under one
 * HOME was inert on exactly the verbs where holder identity decides correctness.
 *
 * WHY NOT THE PERSISTED IDENTITY, which is the obvious-looking fix and the one the
 * bug report proposed: `resolveWritableIdentity` refuses it deliberately
 * (creator-identity.ts:138-152). `identity.json` is keyed on $HOME, and this fleet
 * runs many named sessions per station under one HOME, so it names the BOX rather
 * than the caller. Promoting it to a lock holder would not fix the shared-holder
 * defect; it would rename it, and the rename would be worse than the placeholder
 * because "titus-skill-corpus holds this lock" is believed while "cli" is at least
 * visibly a stub.
 *
 * WHY NOT A GENERATED PER-PROCESS ID, the other candidate: every `todos`
 * invocation is a separate process, so a pid- or random-derived holder would make
 * a session unable to renew or release its OWN lock on the next command, and
 * `lockTask`'s renewal branch would never match. It converts a shared-holder bug
 * into an unreleasable-lock bug, and it still writes a meaningless name into the
 * queue column that `assigned_to` is.
 *
 * `done` and `unlock` need the same boundary for the inverse reason: omitting
 * identity used to clear another agent's live lock. Force release remains
 * available to explicitly authorized server and stale-recovery paths; omission
 * at the CLI is not force authorization.
 *
 * So: refuse. The cost is real and is stated rather than glossed — a script or CI
 * job that ran one of these verbs with no identity now exits non-zero where it
 * used to succeed. The remedy is one line (`export TODOS_AGENT_ID=<name>`), the
 * error names it, and the alternative is a lock the fleet cannot trust.
 */
import { resolveWritableIdentity } from "../lib/creator-identity.js";
import { handleError } from "./helpers.js";

/** The verb name is carried only so the refusal can name what was refused. */
export function resolveClaimIdentity(verb: string, explicit?: string | null): string {
  const resolved = resolveWritableIdentity(explicit);
  if (!resolved.agent_id) {
    handleError(
      new Error(
        `Cannot ${verb} a task without an agent identity: this operation changes a task lock, and a lock with no distinct caller is not a lock. ` +
          `Set TODOS_AGENT_ID=<name> for this session, or pass --agent <name>. ` +
          `An identity persisted by 'todos init' is deliberately not used here — it is keyed on $HOME and names the station, not this session.`,
      ),
    );
  }
  return resolved.agent_id;
}
