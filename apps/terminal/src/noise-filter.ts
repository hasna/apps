// Noise filter — strips output that is NEVER useful for AI agents or humans
// Applied before any parsing/compression so ALL features benefit

const NOISE_PATTERNS: RegExp[] = [
  // npm noise
  /^\d+ packages? are looking for funding/,
  /^\s*run [`']?npm fund[`']? for details/,
  /^found 0 vulnerabilities/,
  /^npm warn deprecated\b/,
  /^npm warn ERESOLVE\b/,
  /^npm warn old lockfile/,
  /^npm notice\b/,

  // Progress bars and spinners
  /[█▓▒░⣾⣽⣻⢿⡿⣟⣯⣷]{3,}/,
  /\[\s*[=>#-]{5,}\s*\]\s*\d+%/,    // [=====>    ] 45%
  /^\s*[\\/|/-]{1}\s*$/,              // spinner chars alone on a line
  /Downloading\s.*\d+%/,
  /Progress:\s*\d+%/i,

  // Build noise
  /^gyp info\b/,
  /^gyp warn\b/,
  /^TSFILE:/,
  /^\s*hmr update\s/i,

  // Python noise
  /^Requirement already satisfied:/,

  // Docker noise
  /^Pulling fs layer/,
  /^Waiting$/,
  /^Downloading\s+\[/,
  /^Extracting\s+\[/,

  // Git LFS
  /^Filtering content:/,
  /^Git LFS:/,

  // Generic download/upload progress
  /^\s*\d+(\.\d+)?\s*[KMG]?B\s*\/\s*\d+(\.\d+)?\s*[KMG]?B\b/,
];

// Sensitive env var patterns — ONLY match actual env var assignments (export X=val, X=val at line start)
// NOT code lines like `const API_KEY = process.env.API_KEY` or `this.token = config.token`
const SENSITIVE_PATTERNS = [
  // export KEY_NAME="value" or KEY_NAME=value (shell env vars only)
  /^(export\s+[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*)=(.+)$/,
  // Plain env assignment at start of line (no leading whitespace = not code)
  /^([A-Z_]*(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|AUTH_TOKEN)[A-Z_]*)=(.+)$/,
];

/** Redact sensitive values in output (env vars only, not code) */
function redactSensitive(line: string): string {
  const trimmed = line.trim();
  // Skip lines that look like code (have leading whitespace, semicolons, const/let/var, etc.)
  if (/^\s*(const|let|var|this\.|private|public|protected|import|export\s+(default|const|let|function|class)|\/\/|\/\*|\*)/.test(line)) {
    return line; // Code — never redact
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return `${match[1]}=[REDACTED]`;
    }
  }
  return line;
}

/** Strip noise lines from output. Returns cleaned output + count of lines removed. */
export function stripNoise(output: string): { cleaned: string; linesRemoved: number } {
  const lines = output.split("\n");
  let removed = 0;
  const kept: string[] = [];

  // Track consecutive blank lines
  let blankRun = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Collapse 3+ blank lines to 1
    if (!trimmed) {
      blankRun++;
      if (blankRun <= 1) kept.push(line);
      else removed++;
      continue;
    }
    blankRun = 0;

    // Check noise patterns
    if (NOISE_PATTERNS.some(p => p.test(trimmed))) {
      removed++;
      continue;
    }

    // Carriage return overwrites (spinner animations)
    if (line.includes("\r") && !line.endsWith("\r")) {
      // Keep only the last part after \r
      const parts = line.split("\r");
      kept.push(parts[parts.length - 1]);
      continue;
    }

    // Redact sensitive values (env vars with KEY, TOKEN, SECRET, etc.)
    kept.push(redactSensitive(line));
  }

  return { cleaned: kept.join("\n"), linesRemoved: removed };
}
