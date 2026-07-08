/** Formula lexer: turns an expression string into a flat token stream. */

export type TokenType =
  | "number"
  | "string"
  | "field"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

const OPERATOR_CHARS = new Set(["+", "-", "*", "/", "&", "=", "!", "<", ">"]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;

    // whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // field reference {Field Name}
    if (ch === "{") {
      const end = input.indexOf("}", i + 1);
      if (end === -1) throw new FormulaError(`Unterminated field reference at position ${i}`);
      tokens.push({ type: "field", value: input.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }

    // string literal '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let str = "";
      while (j < n && input[j] !== quote) {
        if (input[j] === "\\" && j + 1 < n) {
          str += input[j + 1];
          j += 2;
          continue;
        }
        str += input[j];
        j++;
      }
      if (j >= n) throw new FormulaError(`Unterminated string starting at position ${i}`);
      tokens.push({ type: "string", value: str, pos: i });
      i = j + 1;
      continue;
    }

    // number
    if ((ch >= "0" && ch <= "9") || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i;
      let seenDot = false;
      while (j < n) {
        const c = input[j]!;
        if (c >= "0" && c <= "9") {
          j++;
        } else if (c === "." && !seenDot) {
          seenDot = true;
          j++;
        } else {
          break;
        }
      }
      tokens.push({ type: "number", value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // identifier / function name
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(input[j]!)) j++;
      tokens.push({ type: "ident", value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, pos: i });
      i++;
      continue;
    }

    // multi/single char operators
    if (OPERATOR_CHARS.has(ch)) {
      const two = input.slice(i, i + 2);
      if (two === "!=" || two === "<>" || two === "<=" || two === ">=" || two === "==") {
        tokens.push({ type: "op", value: two, pos: i });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: ch, pos: i });
      i++;
      continue;
    }

    throw new FormulaError(`Unexpected character "${ch}" at position ${i}`);
  }

  return tokens;
}
