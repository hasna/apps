// Header Parser — extract key:value pairs from card header section

import type { OmpValue } from "../types/index.js";

export interface ParsedHeader {
  type: string;
  id: string;
  depends: string[];
  headers: Record<string, OmpValue>;
  bodyRaw: string;
  bodyStartLine: number;
}

/**
 * Parse a raw card string into its header section and body section.
 *
 * Header = key: value lines from the top until the first blank line.
 * Body = everything after the blank line.
 *
 * Special handling:
 * - type and id are extracted as required fields
 * - depends is parsed as comma-separated card IDs
 * - Arrays: [a, b, c] syntax
 * - Lists: indented "- item" lines under a key
 * - Objects: { key: value, key2: value2 } syntax
 */
export function parseHeader(raw: string, baseLineNumber: number = 1): ParsedHeader {
  const lines = raw.split("\n");
  const headers: Record<string, OmpValue> = {};
  let bodyStartIdx = lines.length;
  let i = 0;

  // Parse key: value lines until blank line
  while (i < lines.length) {
    const line = lines[i];

    // Blank line = end of header section
    if (line.trim() === "") {
      bodyStartIdx = i + 1;
      break;
    }

    // Check for key: value pattern
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();

      // Check if next lines are indented list items (- item)
      if (value === "" || value === "") {
        const listItems = collectListItems(lines, i + 1);
        if (listItems.items.length > 0) {
          headers[key] = listItems.items;
          i = listItems.nextIndex;
          continue;
        }
      }

      headers[key] = parseValue(value);
      i++;
    } else {
      // Not a key:value line — this is the start of body
      bodyStartIdx = i;
      break;
    }
  }

  // Extract body
  const bodyLines = lines.slice(bodyStartIdx);
  const bodyRaw = bodyLines.join("\n").trim();

  // Extract special fields
  const type = String(headers["type"] ?? "custom");
  const id = String(headers["id"] ?? "");

  // Parse depends
  let depends: string[] = [];
  if (headers["depends"]) {
    const depsVal = headers["depends"];
    if (Array.isArray(depsVal)) {
      depends = depsVal.map(String);
    } else {
      depends = String(depsVal)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // Remove special fields from headers map
  delete headers["type"];
  delete headers["id"];
  delete headers["depends"];

  return {
    type,
    id,
    depends,
    headers,
    bodyRaw,
    bodyStartLine: baseLineNumber + bodyStartIdx,
  };
}

/**
 * Parse a value string into a typed value.
 */
function parseValue(raw: string): OmpValue {
  if (raw === "") return "";

  // Boolean
  if (raw === "true") return true as unknown as OmpValue;
  if (raw === "false") return false as unknown as OmpValue;

  // Number
  if (/^\d+$/.test(raw)) return Number(raw) as unknown as OmpValue;

  // Array: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1);
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Object: { key: value, key2: value2 }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1);
    const obj: Record<string, string> = {};
    const pairs = inner.split(",");
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx > 0) {
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        obj[k] = v;
      }
    }
    return obj;
  }

  // Plain string
  return raw;
}

/**
 * Collect indented list items (- item) under a key.
 */
function collectListItems(
  lines: string[],
  startIdx: number
): { items: string[]; nextIndex: number } {
  const items: string[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch) {
      items.push(listMatch[1].trim());
      i++;
    } else {
      break;
    }
  }

  return { items, nextIndex: i };
}
