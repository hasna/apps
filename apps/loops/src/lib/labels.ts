const LOOP_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const LOOP_LABEL_MAX_COUNT = 32;

export function normalizeLoopLabels(value: string | string[] | undefined, label = "label"): string[] {
  if (value === undefined) return [];
  const rawLabels = Array.isArray(value) ? value : [value];
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawLabels) {
    const item = raw.trim().toLowerCase();
    if (!item) throw new Error(`${label} must be a non-empty string`);
    if (!LOOP_LABEL_PATTERN.test(item)) {
      throw new Error(
        `${label} must start with a lowercase letter or digit and contain only lowercase letters, digits, dots, dashes, or underscores`,
      );
    }
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }

  if (normalized.length > LOOP_LABEL_MAX_COUNT) {
    throw new Error(`loops can have at most ${LOOP_LABEL_MAX_COUNT} labels`);
  }
  return normalized;
}

export function mergeLoopLabels(current: string[] | undefined, added: string | string[]): string[] {
  return normalizeLoopLabels([...(current ?? []), ...(Array.isArray(added) ? added : [added])]);
}

export function removeLoopLabels(current: string[] | undefined, removed: string | string[]): string[] {
  const remove = new Set(normalizeLoopLabels(removed));
  return normalizeLoopLabels(current ?? []).filter((label) => !remove.has(label));
}
