export type RemoveEntityType = "model" | "job";

export function parseRemoveType(rawType?: string): RemoveEntityType | undefined {
  if (!rawType) return undefined;
  const normalized = rawType.trim().toLowerCase();
  if (normalized === "model" || normalized === "job") {
    return normalized;
  }
  throw new Error(`Invalid --type value: ${rawType}. Use model or job.`);
}
