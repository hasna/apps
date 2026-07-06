// Shared query parsing for list/filter params across /v1 routes.

export function parseListQuery(url: URL, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== "") out[key] = value;
  }
  return out;
}

export function parseNumberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
