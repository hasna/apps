/**
 * The `[DISPATCH]` record, and the one-line channel notice.
 *
 * These are separated from the command so the exact text is testable without
 * spawning a CLI, and so the record's SHAPE is a decision made once rather than
 * a template string buried in an action handler.
 *
 * WHY NOT `lib/dispatch-formatter.ts`, which already exists and already formats
 * a dispatch: that module builds a HUMAN PROMPT to be typed into a tmux pane —
 * it is the message body of the legacy `dispatch` verb. This builds a
 * MACHINE-GREPPABLE AUDIT LINE that lands in a task comment. Bending the
 * existing formatter to do both would couple the record this verb is measured
 * by to the message format of the verb it replaces.
 *
 * The first line is a fixed, anchored marker because the terminal-state
 * counters read it: N1 counts directive-cited rows with NO `[DISPATCH]`
 * comment, and N2 counts `[DISPATCH]` comments older than the claim window
 * whose row still has a null `started_at`. Both are greps, so the marker must
 * be stable and must start the comment.
 */

export interface DelegationRecordInput {
  taskId: string;
  worker: string;
  dispatcher: string;
  runtime: string | null;
  briefSource: string;
  briefSha256: string;
  briefBytes: number;
  depth: number;
  reportsTo: string;
  seatSlug: string;
  seatOpenTasks: number;
  depthThreshold: number | null;
  override: "despite-depth" | "owner-directive" | null;
  identityOutcome: "created" | "reused" | "skipped";
  dispatchedAt: string;
  claimDeadline: string;
}

/** The marker every reader and counter greps for. Anchored at line start. */
export const DISPATCH_COMMENT_MARKER = "[DISPATCH]";

export function formatDispatchComment(input: DelegationRecordInput): string {
  const lines: string[] = [];
  lines.push(`${DISPATCH_COMMENT_MARKER} ${input.worker} <- ${input.dispatcher} @ ${input.dispatchedAt}`);
  lines.push(`runtime: ${input.runtime ?? "unspecified"}`);
  lines.push(`brief: ${input.briefSource} (${input.briefBytes} bytes, sha256 ${input.briefSha256})`);
  lines.push(`lineage: delegated_from=${input.dispatcher} delegation_depth=${input.depth} reports_to=${input.reportsTo}`);
  lines.push(`identity: ${input.identityOutcome}`);
  lines.push(
    `seat ${input.seatSlug}: ${input.seatOpenTasks} open, threshold ${
      input.depthThreshold === null ? "unset" : input.depthThreshold
    }${input.override ? `, OVERRIDE ${input.override}` : ""}`,
  );
  lines.push(`claim deadline: ${input.claimDeadline}`);
  // Said explicitly because it is the property that keeps this verb's own
  // failure rate measurable, and a reader of the record should not have to know
  // it from elsewhere.
  lines.push("started_at is deliberately NOT set: the worker claims with `todos start`.");
  return lines.join("\n");
}

/**
 * The channel notice. ONE line, because it goes to a shared channel that
 * several seats read, and a multi-line dispatch log there is how a channel
 * stops being read at all.
 */
export function formatDispatchNotice(input: DelegationRecordInput): string {
  const shortId = input.taskId.slice(0, 8);
  const override = input.override ? ` [${input.override}]` : "";
  return (
    `${DISPATCH_COMMENT_MARKER} ${shortId} -> ${input.worker} ` +
    `(by ${input.dispatcher}, depth ${input.depth}, claim by ${input.claimDeadline})${override}`
  );
}

/** Dispatch time plus the claim window, as an ISO instant. */
export function claimDeadlineFrom(dispatchedAt: Date, windowMinutes: number): string {
  return new Date(dispatchedAt.getTime() + windowMinutes * 60_000).toISOString();
}
