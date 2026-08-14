/**
 * Read-back verification for a delegation: did the authority ACTUALLY persist
 * the lineage, or did it accept the patch and drop it?
 *
 * WHY THIS IS NOT PARANOIA. `todos delegate` writes through
 * `PATCH /v1/tasks/:id`, and the authority serving that route is a separately
 * deployed build with its own release cadence. Before this change, NOTHING in
 * the server or storage layer handled `assigned_by`, `delegated_from` or
 * `delegation_depth` — the columns existed, were indexed, and had no write path
 * — so any authority running an earlier build accepts the patch, returns 200
 * with a bumped version, and writes none of the lineage.
 *
 * That produces the one failure shape this verb cannot afford: a successful
 * exit code, a [DISPATCH] comment asserting a lineage, and a row that is
 * indistinguishable from a plain `todos assign`. The whole claim of `delegate`
 * over `assign` is the handover record; reporting one that was silently
 * discarded is worse than not having the verb.
 *
 * So: `secrets exec` returning 0 means the command ran, not that the credential
 * arrived — same shape. A 200 means the request was accepted, not that the
 * field was stored. Verify the PROPERTY, not the CALL.
 *
 * Kept as a pure function over a plain row so both arms are testable without an
 * old server to point at. A check that can only ever be observed passing is not
 * evidence about anything.
 */

/** The subset of a task row this verification reads. */
export interface PersistedLineage {
  assigned_to?: string | null;
  assigned_by?: string | null;
  delegated_from?: string | null;
  delegation_depth?: number | null;
}

export interface ExpectedLineage {
  assignedTo: string;
  assignedBy: string;
  delegatedFrom: string;
  depth: number;
}

/**
 * Field names the authority did not persist as asked. Empty means the handover
 * is fully recorded.
 *
 * Names are compared case-insensitively: agent names are a case-INSENSITIVE
 * identity across this codebase, so a server that canonicalises casing is
 * behaving correctly and must not be reported as having dropped the field.
 * Depth is compared exactly, and `0` is a legitimate value rather than absence
 * — a truthiness test here would call every root dispatch a failure.
 */
export function missingDelegationLineage(
  persisted: PersistedLineage,
  expected: ExpectedLineage,
): string[] {
  const missing: string[] = [];
  if (!sameName(persisted.assigned_to, expected.assignedTo)) missing.push("assigned_to");
  if (!sameName(persisted.assigned_by, expected.assignedBy)) missing.push("assigned_by");
  if (!sameName(persisted.delegated_from, expected.delegatedFrom)) missing.push("delegated_from");
  if (persisted.delegation_depth !== expected.depth) missing.push("delegation_depth");
  return missing;
}

function sameName(actual: string | null | undefined, wanted: string): boolean {
  return typeof actual === "string" && actual.trim().toLowerCase() === wanted.trim().toLowerCase();
}

/**
 * The refusal text for a partial delegation. It names what DID land, so nobody
 * re-runs blindly against a row that is already half-changed, and it names the
 * real remedy rather than sending the reader to debug their connection.
 */
export function partialDelegationMessage(missing: readonly string[], taskId: string): string {
  return (
    `The delegation was only PARTIALLY recorded on task ${taskId}: the authority accepted the update but did not ` +
    `persist ${missing.join(", ")}. ` +
    "The row may now be assigned without its handover lineage, so it is NOT safe to treat this as delegated. " +
    "This is an authority-version problem, not a connectivity, credential or storage-mode problem: the /v1 server " +
    "must be running a build that writes assigned_by, delegated_from and delegation_depth. " +
    "Re-run this exact command once it is, and the row will be completed in place."
  );
}
