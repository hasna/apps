export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return result.length ? result : undefined;
}

export function arrayIntersection(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a) return b;
  if (!b) return a;
  const bSet = new Set(b);
  return a.filter((item) => bSet.has(item));
}

export function arrayUnion(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const values = [...(a ?? []), ...(b ?? [])];
  return values.length ? unique(values) : undefined;
}

export function arrayDifference(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a) return undefined;
  if (!b?.length) return a;
  const bSet = new Set(b);
  return a.filter((item) => !bSet.has(item));
}

export function inverseNormalize(value: number | undefined, values: Array<number | undefined>, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const finite = values.filter((item): item is number => item !== undefined && Number.isFinite(item));
  if (finite.length === 0) return fallback;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return 1;
  return clamp01(1 - (value - min) / (max - min));
}

export function normalize(value: number | undefined, values: Array<number | undefined>, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const finite = values.filter((item): item is number => item !== undefined && Number.isFinite(item));
  if (finite.length === 0) return fallback;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return 1;
  return clamp01((value - min) / (max - min));
}
