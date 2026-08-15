/**
 * PII and data leak detector for AI responses.
 *
 * Scans text for sensitive information patterns (email, phone, SSN, credit card,
 * API keys, private IP addresses) and custom seed patterns.
 *
 * Use it to detect when AI endpoints accidentally leak PII from context/training data.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PiiDetection {
  type: "email" | "phone" | "ssn" | "credit_card" | "api_key" | "ip_private" | "custom";
  value: string;       // redacted: first 3 chars + *** e.g. "adm***"
  position: number;
  severity: "critical" | "high" | "medium";
  context: string;     // 50 chars around match
}

// ─── Built-in patterns ────────────────────────────────────────────────────────

interface PiiPattern {
  type: PiiDetection["type"];
  regex: RegExp;
  severity: PiiDetection["severity"];
}

const BUILTIN_PATTERNS: PiiPattern[] = [
  {
    type: "email",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    severity: "high",
  },
  {
    type: "phone",
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    severity: "medium",
  },
  {
    type: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: "critical",
  },
  {
    type: "credit_card",
    // Matches 13-16 digit sequences, possibly space/dash separated
    regex: /\b(?:\d[ \-]?){13,16}\b/g,
    severity: "critical",
  },
  {
    type: "api_key",
    // Common API key prefixes
    regex: /\b(sk-[A-Za-z0-9]{20,}|pk_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._\-]{20,}|Bearer\s+[A-Za-z0-9._\-]{20,}|[A-Za-z0-9]{32,}(?=\s*["']?\s*(?:api[_-]?key|token|secret|password)))/g,
    severity: "critical",
  },
  {
    type: "ip_private",
    regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    severity: "medium",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redactValue(value: string): string {
  if (value.length <= 3) return "***";
  return value.slice(0, 3) + "***";
}

function extractContext(text: string, position: number, matchLength: number): string {
  const contextRadius = 25; // characters on each side
  const start = Math.max(0, position - contextRadius);
  const end = Math.min(text.length, position + matchLength + contextRadius);
  const slice = text.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + slice + suffix;
}

// Filter out false positives: credit card matches that are clearly timestamps, IDs, etc.
function isLikelyCreditCard(value: string): boolean {
  // Remove separators to get digit string
  const digits = value.replace(/[\s\-]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  // Simple Luhn check
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10);
    if (isEven) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanForPii(text: string, seedPii?: string[]): PiiDetection[] {
  const detections: PiiDetection[] = [];
  const seenPositions = new Set<number>();

  // Built-in patterns
  for (const pattern of BUILTIN_PATTERNS) {
    const re = new RegExp(pattern.regex.source, "g");
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const value = match[0];
      const position = match.index;

      // Skip if already detected at this position
      if (seenPositions.has(position)) continue;

      // Filter out false positive credit cards
      if (pattern.type === "credit_card" && !isLikelyCreditCard(value)) continue;

      // Filter out phone numbers that are clearly not phone numbers (e.g., plain 10-digit IDs)
      if (pattern.type === "phone") {
        // Must have at least one separator (space, dash, dot, parens) to count as phone
        if (!/[-.\s()]/.test(value)) continue;
      }

      seenPositions.add(position);

      detections.push({
        type: pattern.type,
        value: redactValue(value),
        position,
        severity: pattern.severity,
        context: extractContext(text, position, value.length),
      });
    }
  }

  // Custom seed PII: exact string matches (literal, case-insensitive)
  // These always get added regardless of seenPositions (seed PII has highest priority)
  if (seedPii && seedPii.length > 0) {
    for (const seed of seedPii) {
      if (!seed.trim()) continue;
      const lowerText = text.toLowerCase();
      const lowerSeed = seed.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerSeed, idx)) !== -1) {
        seenPositions.add(idx);
        detections.push({
          type: "custom",
          value: redactValue(text.slice(idx, idx + seed.length)),
          position: idx,
          severity: "high",
          context: extractContext(text, idx, seed.length),
        });
        idx += seed.length;
      }
    }
  }

  // Sort by position
  detections.sort((a, b) => a.position - b.position);

  return detections;
}
