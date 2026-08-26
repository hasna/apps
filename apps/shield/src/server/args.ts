export interface ParsedServerArgResult {
  type: "help" | "version";
  text: string;
}

export function parseServerArgs(argv: string[], version: string): ParsedServerArgResult | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      type: "help",
      text: [
        "Usage: shield-serve [options]",
        "",
        "Start the shield dashboard API server.",
        "",
        "Environment:",
        "  PORT                    Port to bind (default: 19428)",
        "  SECURITY_API_KEY        Key required on every /api request (x-api-key or Authorization: Bearer).",
        "  SECURITY_SCAN_ROOTS     Comma-separated absolute paths POST /api/scans may scan (default: $HOME).",
        "  SECURITY_ALLOW_SYSTEM_SCANS=1  Enable include_system host-wide checks.",
        "",
        "Options:",
        "  --host <host>  Host to bind (default: 127.0.0.1; a remote bind requires SECURITY_API_KEY)",
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

export function resolveServerHost(argv: string[]): string | undefined {
  const index = argv.indexOf("--host");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return undefined;
}
