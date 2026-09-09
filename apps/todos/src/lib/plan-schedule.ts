/** Calendar dates are stored verbatim; no timezone conversion or invented defaults. */
export function validatePlanSchedule(value: {start_date?: unknown; end_date?: unknown}): string | null {
  for (const key of ["start_date", "end_date"] as const) {
    const date = value[key];
    if (date === undefined || date === null) continue;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) return `${key} must be a valid ISO calendar date (YYYY-MM-DD)`;
  }
  if (typeof value.start_date === "string" && typeof value.end_date === "string" && value.start_date > value.end_date) return "end_date must not precede start_date";
  return null;
}
