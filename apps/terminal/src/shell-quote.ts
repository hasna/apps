export function expandHomePath(value: string, home = process.env.HOME): string {
  if (!home) return value;
  if (value === "~") return home;
  if (!value.startsWith("~/")) return value;

  const base = home === "/" ? "" : home.replace(/\/+$/, "");
  return `${base}${value.slice(1)}`;
}

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellPathArg(value: string): string {
  const expandedValue = expandHomePath(value);
  const isPlainRelative =
    expandedValue.length > 0 &&
    !expandedValue.startsWith("/") &&
    !expandedValue.startsWith("./") &&
    !expandedValue.startsWith("../") &&
    !expandedValue.startsWith("~");
  const safeValue = isPlainRelative ? `./${expandedValue}` : expandedValue;
  return shellQuote(safeValue);
}
