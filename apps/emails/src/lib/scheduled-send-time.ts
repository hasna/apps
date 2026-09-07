/** Require an explicit timezone so the same schedule means the same instant on every station. */
export function parseScheduledSendTime(
  value: unknown,
  now = Date.now(),
): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error(
      "scheduled_at must be an ISO-8601 timestamp with an explicit timezone",
    );
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    month > 12 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error("scheduled_at contains an invalid date");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now)
    throw new Error("scheduled_at must be in the future");
  return new Date(timestamp).toISOString();
}
