export const MCP_NAME = "clip";
export const DEFAULT_MCP_HTTP_PORT = 8874;

export function isHttpMode(args: string[] = process.argv.slice(2)): boolean {
  return args.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(args: string[] = process.argv.slice(2)): boolean {
  return !isHttpMode(args);
}

export function resolveHttpPort(args: string[] = process.argv.slice(2)): number {
  const flagIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  const raw = fromFlag ?? process.env["MCP_HTTP_PORT"];
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_MCP_HTTP_PORT;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MCP_HTTP_PORT;
}
