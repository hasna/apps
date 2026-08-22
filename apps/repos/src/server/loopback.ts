/**
 * Loopback-only hostnames are safe to serve without a token: only processes
 * on this machine can reach the socket. Any other bind exposes the API and
 * the MCP endpoint to the network, so it requires REPOS_SERVE_TOKEN.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}
