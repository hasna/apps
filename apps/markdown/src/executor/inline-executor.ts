// Inline Directive Executor — resolve {{}} deterministic + LLM

import type { OmpCard, OmpInlineDirective, OmpDocument, LLMClient, CardContext } from "../types/index.js";
import { randomBytes, createHash } from "crypto";

/**
 * Resolve all {{}} directives in a card's body text.
 * Built-in tools are resolved deterministically.
 * Everything else is sent to the cheap LLM.
 *
 * Returns the body text with all {{}} replaced by their resolved values.
 */
export async function resolveInlineDirectives(
  card: OmpCard,
  document: OmpDocument,
  llm?: LLMClient,
  repeatIndex?: number
): Promise<string> {
  let text = card.body.raw;

  // Sort directives by position (reverse) so replacements don't shift indices
  const directives = [...card.body.inlineDirectives].sort((a, b) => b.start - a.start);

  for (const dir of directives) {
    let resolved: string;

    if (dir.isBuiltinTool) {
      resolved = resolveBuiltinTool(dir, card, document, repeatIndex);
    } else if (llm) {
      const context = buildCardContext(card, document);
      resolved = await llm.complete(dir.content, context);
    } else {
      // No LLM available — leave placeholder
      resolved = `[LLM: ${dir.content}]`;
    }

    text = text.slice(0, dir.start) + resolved + text.slice(dir.end);
  }

  return text;
}

/**
 * Resolve a built-in tool directive deterministically.
 */
export function resolveBuiltinTool(
  dir: OmpInlineDirective,
  card: OmpCard,
  document: OmpDocument,
  repeatIndex?: number
): string {
  const tool = dir.toolName;
  const args = dir.toolArgs ?? [];

  switch (tool) {
    case "random": {
      const length = parseInt(args[0] ?? "32", 10);
      const charset = args[1] ?? "alphanumeric";
      return generateRandom(length, charset);
    }

    case "uuid":
      return crypto.randomUUID();

    case "timestamp": {
      if (args.length > 0) {
        return formatTimestamp(args[0]);
      }
      return new Date().toISOString();
    }

    case "env": {
      const varName = args[0];
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable ${varName} is not set (referenced in card "${card.id}")`);
      }
      return value;
    }

    case "ref": {
      const refPath = args[0]; // e.g., "db.engine"
      const [cardId, ...keyParts] = refPath.split(".");
      const key = keyParts.join(".");
      const targetCard = document.cards.find((c) => c.id === cardId);
      if (!targetCard) {
        return `[ref: card "${cardId}" not found]`;
      }
      const value = targetCard.headers[key];
      if (value === undefined) {
        return `[ref: key "${key}" not found in card "${cardId}"]`;
      }
      return String(value);
    }

    case "count": {
      const typeName = args[0];
      const count = document.cards.filter((c) => c.type === typeName).length;
      return String(count);
    }

    case "index": {
      return String(repeatIndex ?? 0);
    }

    case "hash": {
      const algorithm = args[0] ?? "sha256";
      const input = args[1] ?? "";
      return createHash(algorithm).update(input).digest("hex");
    }

    default:
      return `[unknown tool: ${tool}]`;
  }
}

/**
 * Generate a random string with the given charset.
 */
function generateRandom(length: number, charset: string): string {
  const charsets: Record<string, string> = {
    alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    numeric: "0123456789",
    hex: "0123456789abcdef",
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  };

  const chars = charsets[charset] ?? charsets["alphanumeric"];
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Format a timestamp with a simple format string.
 */
function formatTimestamp(format: string): string {
  const now = new Date();
  return format
    .replace("YYYY", String(now.getFullYear()))
    .replace("MM", String(now.getMonth() + 1).padStart(2, "0"))
    .replace("DD", String(now.getDate()).padStart(2, "0"))
    .replace("HH", String(now.getHours()).padStart(2, "0"))
    .replace("mm", String(now.getMinutes()).padStart(2, "0"))
    .replace("ss", String(now.getSeconds()).padStart(2, "0"));
}

/**
 * Build card context for LLM prompt.
 */
function buildCardContext(card: OmpCard, document: OmpDocument): CardContext {
  // Find related cards (those this card depends on)
  const relatedCards = document.cards.filter((c) => card.depends.includes(c.id));

  return { card, relatedCards, document };
}
