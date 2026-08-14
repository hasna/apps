/**
 * Generate a short ticket ID: "API-0042"
 * prefix: project ticket_prefix (e.g. "API")
 * counter: auto-incremented integer from projects.ticket_counter
 */
export function generateShortId(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(4, "0")}`;
}

/**
 * Parse a short ID into its components.
 * "API-0042" → { prefix: "API", counter: 42 }
 * Returns null if the format doesn't match.
 */
export function parseShortId(shortId: string): { prefix: string; counter: number } | null {
  const match = /^([A-Z0-9]+)-(\d+)$/.exec(shortId.toUpperCase());
  if (!match) return null;
  return { prefix: match[1]!, counter: parseInt(match[2]!, 10) };
}

/**
 * Returns true if a string looks like a short ticket ID.
 */
export function isShortId(value: string): boolean {
  return /^[A-Z0-9]+-\d+$/i.test(value);
}
