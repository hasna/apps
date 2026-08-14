export function compactAge(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo`;
  return `${Math.floor(seconds / 31536000)}y`;
}

function trimmed(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${trimmed(n / 1_000_000)}m`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}k`;
  if (n >= 1000) return `${trimmed(n / 1000)}k`;
  return `${n}`;
}

export function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function compactDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const rem = s % 60;
    return rem ? `${Math.floor(s / 60)}m${rem}s` : `${Math.floor(s / 60)}m`;
  }
  const rem = Math.floor((s % 3600) / 60);
  return rem ? `${Math.floor(s / 3600)}h${rem}m` : `${Math.floor(s / 3600)}h`;
}
