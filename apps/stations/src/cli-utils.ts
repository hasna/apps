export function parseIntegerOption(value: string, label: string, constraints: { min?: number; max?: number } = {}): number {
  const parsed = Number.parseInt(value, 10);
  const { min, max } = constraints;
  if (!Number.isFinite(parsed) || !/^-?\d+$/.test(value.trim())) {
    throw new Error(`Invalid value for ${label}: ${value}`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected >= ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected <= ${max}.`);
  }
  return parsed;
}

export function renderKeyValueTable(entries: Array<[string, string]>): string {
  const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  return entries.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n");
}

export function renderList(title: string, items: string[]): string {
  if (items.length === 0) {
    return `${title}: none`;
  }
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}
