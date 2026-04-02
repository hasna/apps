export interface ParsedServerArgResult {
  type: "help" | "version";
  text: string;
}

export function parseServerArgs(argv: string[], version: string): ParsedServerArgResult | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      type: "help",
      text: [
        "Usage: security-serve [options]",
        "",
        "Start the Open Security dashboard API server.",
        "",
        "Environment:",
        "  PORT  Port to bind (default: 19428)",
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
