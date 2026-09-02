/** Server-only PostgreSQL validation. Never prints the supplied DSN. */
export function validateDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || /\s/.test(value) || url.hash) throw 0;
    return value;
  } catch { throw new Error("Calendar requires a valid server-side PostgreSQL database URL."); }
}
