// Edit-test loop detector — detects repetitive test→edit→test patterns
// and suggests narrowing to specific test files

interface CommandRecord {
  command: string;
  timestamp: number;
}

const history: CommandRecord[] = [];
const MAX_HISTORY = 20;

// Detect test commands
const TEST_PATTERNS = [
  /\bbun\s+test\b/, /\bnpm\s+test\b/, /\bnpx\s+jest\b/, /\bnpx\s+vitest\b/,
  /\bpnpm\s+test\b/, /\byarn\s+test\b/, /\bpytest\b/, /\bgo\s+test\b/,
  /\bcargo\s+test\b/, /\brspec\b/, /\bphpunit\b/, /\bmocha\b/,
];

function isTestCommand(cmd: string): boolean {
  return TEST_PATTERNS.some(p => p.test(cmd));
}

function isFullSuiteCommand(cmd: string): boolean {
  // Full suite = test command without specific file/pattern
  if (!isTestCommand(cmd)) return false;
  // If it has a specific file or --grep, it's already narrowed
  if (/\.(test|spec)\.(ts|tsx|js|jsx|py|rs|go)/.test(cmd)) return false;
  if (/--grep|--filter|-t\s/.test(cmd)) return false;
  return true;
}

export interface LoopContext {
  detected: boolean;
  iteration: number;
  testCommand: string;
  suggestedNarrow?: string;
  reason?: string;
}

/** Record a command execution and detect loops */
export function detectLoop(command: string): LoopContext {
  history.push({ command, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();

  if (!isTestCommand(command)) {
    return { detected: false, iteration: 0, testCommand: command };
  }

  // Count consecutive test runs (allowing non-test commands between them)
  let testCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isTestCommand(history[i].command)) testCount++;
    // If we hit a non-test, non-edit command, stop counting
    // (edits are invisible to us since we only see exec'd commands)
  }

  if (testCount < 3 || !isFullSuiteCommand(command)) {
    return { detected: false, iteration: testCount, testCommand: command };
  }

  // Detected loop — suggest narrowing
  // Try to find a recently-mentioned test file in recent commands
  let suggestedNarrow: string | undefined;

  // Look for file paths in recent history that could be test targets
  for (let i = history.length - 2; i >= Math.max(0, history.length - 10); i--) {
    const cmd = history[i].command;
    // Look for edited/touched files
    const fileMatch = cmd.match(/(\S+\.(ts|tsx|js|jsx|py|rs|go))\b/);
    if (fileMatch && !isTestCommand(cmd)) {
      const file = fileMatch[1];
      // Suggest corresponding test file
      const testFile = file.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
      suggestedNarrow = command.replace(/\b(test)\b/, `test ${testFile}`);
      break;
    }
  }

  // Fallback: suggest adding --grep or specific file
  if (!suggestedNarrow) {
    suggestedNarrow = undefined; // Can't determine which file
  }

  return {
    detected: true,
    iteration: testCount,
    testCommand: command,
    suggestedNarrow,
    reason: `Full test suite run ${testCount} times. Consider narrowing to specific test file.`,
  };
}

/** Reset loop detection (e.g., on session start) */
export function resetLoopDetector(): void {
  history.length = 0;
}
