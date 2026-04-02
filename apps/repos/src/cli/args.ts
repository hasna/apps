export function parseIntOption(value: string, flagName: string, min = 0): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid value for ${flagName}: '${value}' is not an integer`);
  }

  if (parsed < min) {
    throw new Error(`Invalid value for ${flagName}: expected >= ${min}, got ${parsed}`);
  }

  return parsed;
}
