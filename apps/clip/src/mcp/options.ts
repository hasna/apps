import {
  isHttpMode as harnessIsHttpMode,
  resolveMcpHttpPort as harnessResolveMcpHttpPort,
} from "@hasna/mcp-harness";

/**
 * open-clip MCP mode/port boilerplate — now a thin shim over
 * `@hasna/mcp-harness`. The public API (names, signatures, and default
 * behavior) is preserved so `mcp/index.ts`, `mcp/http.ts`, and the tests are
 * unchanged; only the hand-rolled `--http` / `--port` / `MCP_HTTP_PORT`
 * parsing was removed in favor of the shared harness.
 *
 * Note: open-clip's `isStdioMode` semantics (stdio unless `--http` is given)
 * predate and differ from the harness's own `isStdioMode` (stdio only when
 * `--stdio`/`MCP_STDIO=1` is given), so it is kept as a local negation of
 * `isHttpMode` rather than delegated directly.
 */

export const MCP_NAME = "clip";
export const DEFAULT_MCP_HTTP_PORT = 8874;

export function isHttpMode(args: string[] = process.argv.slice(2)): boolean {
  return harnessIsHttpMode(args);
}

export function isStdioMode(args: string[] = process.argv.slice(2)): boolean {
  return !isHttpMode(args);
}

export function resolveHttpPort(args: string[] = process.argv.slice(2)): number {
  // Normalize the short `-p` flag to `--port` so the harness's strict argv
  // parser recognizes it too (harness only understands `--port`/`--port=`).
  const normalized = args.includes("-p") && !args.includes("--port")
    ? args.map((arg) => (arg === "-p" ? "--port" : arg))
    : args;
  try {
    return harnessResolveMcpHttpPort({ argv: normalized, default: DEFAULT_MCP_HTTP_PORT });
  } catch {
    // Preserve the previous lenient fallback-to-default behavior on malformed input.
    return DEFAULT_MCP_HTTP_PORT;
  }
}
