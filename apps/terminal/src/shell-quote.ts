export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellPathArg(value: string): string {
  const isPlainRelative =
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("./") &&
    !value.startsWith("../") &&
    !value.startsWith("~");
  const safeValue = isPlainRelative ? `./${value}` : value;
  return shellQuote(safeValue);
}
