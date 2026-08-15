import type { FractionInput } from "./types";

export function formatFraction(input: FractionInput) {
  const covered = assertNonNegativeInteger(input.numerator, "covered");
  const total = assertNonNegativeInteger(input.denominator, "total");
  if (covered > total) {
    throw new Error("covered count cannot exceed total count");
  }

  return {
    fraction: `${covered}/${total}`,
    provenance: {
      source: input.source,
      observedAt: input.observedAt,
      axes: [...input.axes],
      omittedAxis: input.omittedAxis,
    },
  };
}

export function assertNoNumeratorKeys(value: unknown, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoNumeratorKeys(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "numerator") {
      throw new Error(`forbidden numerator key at ${path}.${key}`);
    }
    assertNoNumeratorKeys(entry, `${path}.${key}`);
  }
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
