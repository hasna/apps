// Helpers to project a validated op input onto CLI argv and to pick body/query
// subsets for the HTTP surface — used by both the live surfaces and the
// interface-parity harness so all three stay in lockstep.

export function kebab(key: string): string {
  return key.replace(/_/g, "-");
}

/** Build `--flag value` argv for the given input keys (arrays -> comma-joined). */
export function flags(input: Record<string, unknown>, keys: string[]): string[] {
  const args: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean") {
      if (value) args.push(`--${kebab(key)}`);
      continue;
    }
    args.push(`--${kebab(key)}`, Array.isArray(value) ? value.join(",") : String(value));
  }
  return args;
}

/** Pick a subset of keys from an input object (undefined dropped). */
export function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}
