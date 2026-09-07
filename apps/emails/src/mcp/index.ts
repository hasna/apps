#!/usr/bin/env bun
/**
 * Emails MCP server entry point.
 */
import pkg from "../../package.json" with { type: "json" };

function printHelp(): void {
  console.log(`Usage: emails-mcp [options]

Runs the @hasna/emails MCP server. Transport: stdio by default (one server per
client, no listening socket). Pass --http to opt into the shared Streamable HTTP
transport on 127.0.0.1 — it exposes every tool over the network, so it requires a
bearer token in EMAILS_MCP_HTTP_TOKEN and refuses to start without one.

Options:
      --stdio        Serve MCP over stdio (default)
      --http         Serve MCP over Streamable HTTP on 127.0.0.1 (opt-in)
  -p, --port <port>  HTTP port (default: MCP_HTTP_PORT or 8861)
  -V, --version      output the version number
  -h, --help         display help for command

Environment:
  MCP_STDIO=1                  Select the stdio transport (already the default)
  MCP_HTTP=1                   Select the Streamable HTTP transport
  MCP_HTTP_PORT                Override default HTTP port (8861)
  EMAILS_MCP_HTTP_TOKEN        Required bearer token for the HTTP transport
  EMAILS_MCP_ALLOWED_HOSTS     Comma-separated Host allowlist (default: loopback)
  EMAILS_MCP_ALLOWED_ORIGINS   Comma-separated Origin allowlist (default: loopback)`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

async function main(): Promise<void> {
  const { isHttpMode, isStdioMode, resolveHttpPort } = await import("./options.js");
  // HTTP is opt-in. Serving the full tool graph (send_email, add_forwarding_rule,
  // set_config, create_send_key, ...) on a listening socket must be a deliberate
  // choice, not what a bare `emails-mcp` does. `--stdio` wins if both are passed.
  if (isHttpMode(args) && !isStdioMode(args)) {
    const { startHttpServer } = await import("./http.js");
    startHttpServer({ port: resolveHttpPort(args) });
    await new Promise<never>(() => {});
    return;
  }
  // Default: stdio (one server per client, no listening socket).
  const [{ StdioServerTransport }, { buildServer }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("./server.js"),
  ]);
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * The typed refusals of the storage/credential seam. Their MESSAGE is the whole
 * diagnostic (which Keychain item, which file, which env key), so a source
 * frame or a stack after it only buries the line an operator has to read.
 */
const CONFIGURATION_REFUSALS = new Set([
  "StoreConfigurationError",
  "ClientTransportConfigurationError",
  "CredentialResolutionError",
]);

main().catch((err: unknown) => {
  // The FIRST stderr line names what is missing — never a Bun source frame
  // (#1720 validation). An unexpected failure keeps its stack on the lines after.
  const message = err instanceof Error ? err.message : String(err);
  console.error(`emails-mcp: ${message}`);
  if (err instanceof Error && !CONFIGURATION_REFUSALS.has(err.name) && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
