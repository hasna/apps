export interface ParsedMcpArgResult {
  type: "help" | "version";
  text: string;
}

export function parseMcpArgs(argv: string[], version: string): ParsedMcpArgResult | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      type: "help",
      text: [
        "Usage: security-mcp [options]",
        "",
        "Start the Open Security MCP stdio server.",
        "",
        "Options:",
        "  -h, --help     display help for command",
        "  -V, --version  output the version number",
      ].join("\n"),
    };
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    return { type: "version", text: version };
  }

  return null;
}
