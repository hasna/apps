/**
 * Route53 domain-registration polling — pure, reusable by the buy command and
 * the domain provisioning daemon. The AWS status string is classified into a
 * terminal/pending verdict; pollRegistrationUntilDone drives it to completion
 * with an injectable status getter + sleep (so it is fully unit-testable).
 */

export type RegVerdict = "pending" | "success" | "failed";

export function classifyRegistrationStatus(status: string): RegVerdict {
  const s = status.toUpperCase();
  if (s === "SUCCESSFUL") return "success";
  if (s === "ERROR" || s === "FAILED") return "failed";
  return "pending"; // SUBMITTED, IN_PROGRESS, PENDING, unknown
}

export interface PollResult {
  status: "success" | "failed" | "timeout";
  attempts: number;
  message?: string;
}

export interface PollOptions {
  getStatus: (operationId: string) => Promise<{ status: string; message?: string }>;
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function pollRegistrationUntilDone(
  operationId: string,
  opts: PollOptions,
): Promise<PollResult> {
  const maxAttempts = opts.maxAttempts ?? 60;
  const intervalMs = opts.intervalMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let attempts = 0;
  while (attempts < maxAttempts) {
    const { status, message } = await opts.getStatus(operationId);
    attempts++;
    const verdict = classifyRegistrationStatus(status);
    if (verdict === "success") return { status: "success", attempts, message };
    if (verdict === "failed") return { status: "failed", attempts, message };
    if (attempts < maxAttempts) await sleep(intervalMs);
  }
  return { status: "timeout", attempts };
}
