// Body Parser — extract NL text, tables, accepts lines, {{}} directives

import type { OmpBody, OmpTable, OmpInlineDirective } from "../types/index.js";
import { BUILTIN_TOOLS } from "../types/index.js";

const INLINE_DIRECTIVE_RE = /\{\{(.+?)\}\}/g;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEPARATOR_RE = /^\|[\s\-:|]+\|$/;
const ACCEPTS_RE = /^accepts:\s*(.+)$/;

/**
 * Parse a card body into its components: NL text, tables, inline directives, accepts.
 */
export function parseBody(raw: string, baseLineNumber: number = 1): OmpBody {
  const tables = extractTables(raw, baseLineNumber);
  const inlineDirectives = extractInlineDirectives(raw);
  const accepts = extractAccepts(raw);

  // Text is the body with tables and accepts stripped for LLM consumption
  const text = raw;

  return {
    raw,
    text,
    tables,
    inlineDirectives,
  };
}

/**
 * Extract markdown tables from body text.
 */
export function extractTables(raw: string, baseLineNumber: number = 1): OmpTable[] {
  const lines = raw.split("\n");
  const tables: OmpTable[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for table start: a line matching | ... |
    if (TABLE_ROW_RE.test(line.trim())) {
      const tableLines: string[] = [line];
      let j = i + 1;

      // Collect consecutive table lines
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        tableLines.push(lines[j]);
        j++;
      }

      // Need at least 3 lines: header, separator, one data row
      if (tableLines.length >= 3 && TABLE_SEPARATOR_RE.test(tableLines[1].trim())) {
        const headers = parseTableRow(tableLines[0]);
        const rows: string[][] = [];

        // Skip header (0) and separator (1), parse data rows
        for (let k = 2; k < tableLines.length; k++) {
          rows.push(parseTableRow(tableLines[k]));
        }

        tables.push({
          headers,
          rows,
          lineNumber: baseLineNumber + i,
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  return tables;
}

/**
 * Parse a single table row into cells.
 */
function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1) // remove leading/trailing empty from split
    .map((cell) => cell.trim());
}

/**
 * Extract {{}} inline directives from body text.
 */
export function extractInlineDirectives(raw: string): OmpInlineDirective[] {
  const directives: OmpInlineDirective[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  const re = new RegExp(INLINE_DIRECTIVE_RE.source, "g");

  while ((match = re.exec(raw)) !== null) {
    const content = match[1].trim();
    const toolInfo = classifyDirective(content);

    directives.push({
      raw: match[0],
      content,
      isBuiltinTool: toolInfo.isBuiltin,
      toolName: toolInfo.toolName,
      toolArgs: toolInfo.toolArgs,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return directives;
}

/**
 * Classify an inline directive as built-in tool or LLM prompt.
 */
function classifyDirective(content: string): {
  isBuiltin: boolean;
  toolName?: string;
  toolArgs?: string[];
} {
  // Check for built-in tool patterns

  // {{random(32, alphanumeric)}}
  const funcMatch = content.match(/^(\w+)\((.+)\)$/);
  if (funcMatch) {
    const name = funcMatch[1];
    if ((BUILTIN_TOOLS as readonly string[]).includes(name)) {
      const args = funcMatch[2].split(",").map((s) => s.trim());
      return { isBuiltin: true, toolName: name, toolArgs: args };
    }
  }

  // {{uuid}}, {{timestamp}}, {{index}}
  if ((BUILTIN_TOOLS as readonly string[]).includes(content)) {
    return { isBuiltin: true, toolName: content, toolArgs: [] };
  }

  // {{env:VAR_NAME}}
  if (content.startsWith("env:")) {
    return { isBuiltin: true, toolName: "env", toolArgs: [content.slice(4)] };
  }

  // {{ref:card-id.key}}
  if (content.startsWith("ref:")) {
    return { isBuiltin: true, toolName: "ref", toolArgs: [content.slice(4)] };
  }

  // {{count:type}}
  if (content.startsWith("count:")) {
    return { isBuiltin: true, toolName: "count", toolArgs: [content.slice(6)] };
  }

  // {{timestamp:format}}
  if (content.startsWith("timestamp:")) {
    return { isBuiltin: true, toolName: "timestamp", toolArgs: [content.slice(10)] };
  }

  // {{hash:algorithm:input}}
  if (content.startsWith("hash:")) {
    const parts = content.slice(5).split(":");
    return { isBuiltin: true, toolName: "hash", toolArgs: parts };
  }

  // Everything else → LLM prompt
  return { isBuiltin: false };
}

/**
 * Extract accepts: lines from body text.
 * Returns an array of individual acceptance criteria (split on ;).
 */
export function extractAccepts(raw: string): string[] {
  const lines = raw.split("\n");
  const accepts: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(ACCEPTS_RE);
    if (match) {
      const criteria = match[1]
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      accepts.push(...criteria);
    }
  }

  return accepts;
}
