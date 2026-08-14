export function providerVersionSatisfies(version: string, range: string): boolean {
  const current = parseProviderVersion(version);
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;
  return trimmed.split(/\s+/).every((part) => {
    const match = /^(>=|<=|>|<|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(part);
    if (!match) throw new Error(`Unsupported provider version range: ${range}`);
    const target: [number, number, number] = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
    const cmp = compareProviderVersions(current, target);
    switch (match[1] ?? "=") {
      case ">=": return cmp >= 0;
      case "<=": return cmp <= 0;
      case ">": return cmp > 0;
      case "<": return cmp < 0;
      case "^": return cmp >= 0 && current[0] === target[0];
      case "~": return cmp >= 0 && current[0] === target[0] && current[1] === target[1];
      default: return cmp === 0;
    }
  });
}

function parseProviderVersion(value: string): [number, number, number] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid provider version: ${value}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareProviderVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
