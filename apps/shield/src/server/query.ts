export function getFirstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string");
    return typeof first === "string" ? first : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function getQueryInt(value: unknown, fallback: number): number {
  const text = getFirstString(value);
  if (!text) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
