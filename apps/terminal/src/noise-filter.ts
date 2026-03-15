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

// Sensitive env var patterns — redact values, keep names only if needed
const SENSITIVE_PATTERNS = [
  /^(.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH).*?)=(.+)$/i,
  /^(.*(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET).*?)=(.+)$/i,
];

/** Redact sensitive values in output (env vars, credentials) */
function redactSensitive(line: string): string {
  for (const pattern of SENSITIVE_PATTERNS) {
    const match = line.match(pattern);
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
