/** Canonical kebab-case slug normalization shared by local and Postgres paths. */
export function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isCanonicalSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && normalizeSlug(value) === value;
}
