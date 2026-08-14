// Card Splitter — splits an OMP document on --- into raw cards

export interface RawCard {
  raw: string;
  lineNumber: number;
}

export interface SplitResult {
  title: string;
  cards: RawCard[];
}

/**
 * Split an OMP document into its title and raw card strings.
 *
 * Rules:
 * - Everything before the first --- is the title section
 * - Cards are separated by lines that are exactly "---" (with optional whitespace)
 * - Multiple consecutive --- are collapsed (no empty cards)
 * - The --- inside markdown tables (|---|---|) are NOT treated as separators
 */
export function splitCards(input: string): SplitResult {
  const lines = input.split("\n");
  let title = "";
  const cards: RawCard[] = [];

  let currentLines: string[] = [];
  let currentStart = 1;
  let foundFirstSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (isSeparator(line)) {
      if (!foundFirstSeparator) {
        // Everything before first --- is the title
        title = currentLines.join("\n").trim();
        foundFirstSeparator = true;
        currentLines = [];
        currentStart = lineNum + 1;
      } else {
        // Flush current card if non-empty
        const raw = currentLines.join("\n").trim();
        if (raw.length > 0) {
          cards.push({ raw, lineNumber: currentStart });
        }
        currentLines = [];
        currentStart = lineNum + 1;
      }
    } else {
      currentLines.push(line);
    }
  }

  // Flush last card
  const raw = currentLines.join("\n").trim();
  if (raw.length > 0) {
    if (!foundFirstSeparator) {
      // No separators at all — entire document is the title (or a single implicit card)
      title = raw;
    } else {
      cards.push({ raw, lineNumber: currentStart });
    }
  }

  return { title, cards };
}

/**
 * Check if a line is a card separator.
 * Must be exactly "---" with optional leading/trailing whitespace.
 * Must NOT be inside a table (lines containing | are table separators like |---|---|).
 */
function isSeparator(line: string): boolean {
  const trimmed = line.trim();
  // Exact --- or more dashes, but not a table separator
  if (trimmed === "---" || trimmed === "----" || trimmed === "-----") {
    return !line.includes("|");
  }
  return false;
}

/**
 * Extract the document title from the title section.
 * Looks for a # heading, otherwise returns the raw text.
 */
export function extractTitle(titleSection: string): string {
  const match = titleSection.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : titleSection.trim();
}
