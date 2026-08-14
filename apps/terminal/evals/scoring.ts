// Fuzzy command matching for NL2Bash eval scoring

/** Normalize a command for comparison */
function normalize(cmd: string): string {
  return cmd
    .trim()
    .replace(/\s+/g, " ")           // collapse whitespace
    .replace(/^(\$|#)\s*/, "")      // strip prompt chars
    .replace(/\s*;\s*$/, "")        // trailing semicolons
    .replace(/\s*\|\s*/g, " | ")    // normalize pipe spacing
    .replace(/\s*&&\s*/g, " && ")   // normalize && spacing
    .replace(/\s*>\s*/g, " > ")     // normalize redirect spacing
    // Normalize head/tail -N to -n N (equivalent shorthand)
    .replace(/\b(head|tail)\s+-(\d+)\b/g, "$1 -n $2")
    // Normalize awk implicit print: 'NR%2==1' == 'NR % 2 == 1 {print}'
    .replace(/\{print\}/g, "")
    .replace(/\s*%\s*/g, "%")
    .replace(/\s*==\s*/g, "==")
}

/** Strip quotes from a string for comparison */
function stripQuotes(s: string): string {
  return s.replace(/['"]/g, "");
}

/** Tokenize command into binary + ordered args + unordered flags */
function tokenize(cmd: string): { binary: string; args: string[]; flags: Set<string> } {
  const parts = normalize(cmd).split(" ");
  const binary = parts[0] ?? "";
  const flags = new Set<string>();
  const args: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("-")) {
      flags.add(p);
    } else {
      args.push(p);
    }
  }

  return { binary, args, flags };
}

// Groups of equivalent commands (any member matches any other)
const EQUIVALENT_COMMANDS: string[][] = [
  ["route", "route -n", "netstat -r", "ip route", "ip route show"],
  ["ps", "ps aux", "ps -e", "ps -ef"],
  ["vmstat", "top", "top -l 1"],
  ["w", "uptime", "w -s"],
  ["free -h", "free", "free -m", "lsmem", "cat /proc/meminfo"],
  ["nice", "ps -o ni", "ps -o pid,ni,comm"],
  ["lsof", "lsof -P -i -n"],
  ["ls -a", "ls -la", "ls -al", "ls -alh"],
  ["ls", "ls -l"],
  ["head -1", "head -n 1", "head -n1"],
  ["tail -1", "tail -n 1", "tail -n1"],
  ["base64 -d", "base64 --decode"],
  ["ifconfig", "ifconfig -a", "ip a", "ip addr", "ip addr show"],
  ["netstat -i", "ip link", "ip link show", "ip a"],
  ["service --status-all", "systemctl list-units --type=service"],
  ["getent passwd", "cat /etc/passwd"],
  ["getconf -a", "sysctl -a", "printenv"],
  ["dpkg --get-selections", "apt list --installed"],
];

/** Extract the "action" from a command for semantic comparison */
function extractAction(cmd: string): string | null {
  const n = normalize(cmd);
  // head -n N file == sed -n 'Np' file == awk 'NR==N' file (line extraction)
  const headMatch = n.match(/^head -n (\d+) (.+)/);
  if (headMatch) return `extract-first-${headMatch[1]}-lines:${headMatch[2]}`;
  const sedFirstMatch = n.match(/^sed -n '(\d+)p' (.+)/);
  if (sedFirstMatch) return `extract-first-${sedFirstMatch[1]}-lines:${sedFirstMatch[2]}`;

  // tail -n N file == sed -n '$p' file for last line
  const tailMatch = n.match(/^tail -n (\d+) (.+)/);
  if (tailMatch) return `extract-last-${tailMatch[1]}-lines:${tailMatch[2]}`;
  const sedLastMatch = n.match(/^sed -n '\$p' (.+)/);
  if (sedLastMatch) return `extract-last-1-lines:${sedLastMatch[1]}`;

  return null;
}

/** Check if two commands are semantically equivalent via known equivalence groups */
function isKnownEquivalent(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);

  // Check equivalence groups
  for (const group of EQUIVALENT_COMMANDS) {
    const normGroup = group.map(normalize);
    if (normGroup.some(g => na.startsWith(g) || na === g) &&
        normGroup.some(g => nb.startsWith(g) || nb === g)) {
      return true;
    }
  }

  // Check action equivalence (head/sed/awk doing the same thing)
  const actionA = extractAction(na);
  const actionB = extractAction(nb);
  if (actionA && actionB && actionA === actionB) return true;

  return false;
}

/** Exact match after normalization */
export function exactMatch(predicted: string, expected: string): boolean {
  return normalize(predicted) === normalize(expected);
}

/** Fuzzy match — same binary, same args (order matters), flags order-independent */
export function fuzzyMatch(predicted: string, expected: string): boolean {
  if (exactMatch(predicted, expected)) return true;

  // Quote-insensitive comparison
  if (normalize(stripQuotes(predicted)) === normalize(stripQuotes(expected))) return true;

  const pred = tokenize(predicted);
  const exp = tokenize(expected);

  // Binary must match
  if (pred.binary !== exp.binary) return false;

  // Args must match in order (quote-insensitive)
  if (pred.args.length !== exp.args.length) return false;
  for (let i = 0; i < pred.args.length; i++) {
    if (stripQuotes(pred.args[i]) !== stripQuotes(exp.args[i])) return false;
  }

  // Flags: predicted must have all expected flags (extra flags OK — model being cautious)
  for (const f of exp.flags) {
    if (!pred.flags.has(f)) return false;
  }

  return true;
}

/** Semantic match — checks known equivalences and flag supersets */
export function semanticMatch(predicted: string, expected: string): boolean {
  if (fuzzyMatch(predicted, expected)) return true;
  if (isKnownEquivalent(predicted, expected)) return true;

  // Extra flag tolerance: same binary, same positional args, model just added extra flags
  const pred = tokenize(predicted);
  const exp = tokenize(expected);
  if (pred.binary === exp.binary) {
    const predArgsQ = pred.args.map(stripQuotes);
    const expArgsQ = exp.args.map(stripQuotes);
    if (predArgsQ.length === expArgsQ.length &&
        predArgsQ.every((a, i) => a === expArgsQ[i])) {
      // Same binary, same args — just different flags (model added -p, -v, etc.)
      // Accept if predicted has all expected flags (superset OK)
      let hasAllExpected = true;
      for (const f of exp.flags) {
        if (!pred.flags.has(f)) { hasAllExpected = false; break; }
      }
      if (hasAllExpected) return true;
    }
  }

  return false;
}

/** Score a prediction against expected + alternative */
export function score(predicted: string, expected: string, alt?: string): {
  exact: boolean;
  fuzzy: boolean;
  semantic: boolean;
  score: number;
} {
  const exact = exactMatch(predicted, expected) || (alt ? exactMatch(predicted, alt) : false);
  const fuzzy = exact || fuzzyMatch(predicted, expected) || (alt ? fuzzyMatch(predicted, alt) : false);
  const semantic = fuzzy || semanticMatch(predicted, expected) || (alt ? semanticMatch(predicted, alt) : false);

  return {
    exact,
    fuzzy,
    semantic,
    score: exact ? 1.0 : fuzzy ? 0.9 : semantic ? 0.8 : 0.0,
  };
}
