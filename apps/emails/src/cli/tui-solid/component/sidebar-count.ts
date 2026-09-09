const countFormatter = new Intl.NumberFormat("en-US");

export function formatSidebarCount(value: number, lowerBound = false): string {
  return `${lowerBound ? "≥" : ""}${countFormatter.format(value)}`;
}
