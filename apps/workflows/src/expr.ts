/**
 * A tiny, bounded expression language for decision/while conditions.
 *
 * Grammar (recursive descent):
 *   expr       := or
 *   or         := and ("or" and)*
 *   and        := not ("and" not)*
 *   not        := "not" not | comparison
 *   comparison := primary (("==" | "!=" | "<" | "<=" | ">" | ">=") primary)?
 *   primary    := "(" expr ")" | literal | path
 *   literal    := number | string | true | false
 *   path       := identifier ("." identifier)*   — resolves against the run context
 *
 * Values: numbers, strings, booleans. Comparisons require the same type on
 * both sides. A path that does not resolve throws ExprEvalError; the caller
 * turns that into a node failure with the path named.
 */
export class ExprSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprSyntaxError";
  }
}

export class ExprEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprEvalError";
  }
}

export type ExprValue = number | string | boolean;

export interface Token {
  kind: "number" | "string" | "ident" | "op" | "lparen" | "rparen";
  value: string;
}

const COMPARISON_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", value: ")" });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < input.length) {
        if (input[j] === quote) {
          closed = true;
          break;
        }
        out += input[j];
        j++;
      }
      if (!closed) throw new ExprSyntaxError(`unterminated string literal at offset ${i}`);
      tokens.push({ kind: "string", value: out });
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (COMPARISON_OPS.has(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if (ch === "<" || ch === ">" || ch === "=" || ch === "!") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ kind: "number", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_.]/.test(input[j])) j++;
      tokens.push({ kind: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new ExprSyntaxError(`unexpected character ${JSON.stringify(ch)} at offset ${i}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expectOp(value: string): void {
    const t = this.next();
    if (!t || t.kind !== "op" || t.value !== value) {
      throw new ExprSyntaxError(`expected ${JSON.stringify(value)}`);
    }
  }

  parse(): AstNode {
    if (this.tokens.length === 0) throw new ExprSyntaxError("empty expression");
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new ExprSyntaxError(`unexpected trailing token ${JSON.stringify(this.peek()!.value)}`);
    }
    return node;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.peek()?.kind === "ident" && this.peek()!.value === "or") {
      this.next();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseNot();
    while (this.peek()?.kind === "ident" && this.peek()!.value === "and") {
      this.next();
      const right = this.parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseNot(): AstNode {
    if (this.peek()?.kind === "ident" && this.peek()!.value === "not") {
      this.next();
      return { kind: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t && t.kind === "op" && COMPARISON_OPS.has(t.value)) {
      this.next();
      const right = this.parsePrimary();
      return { kind: "comparison", op: t.value, left, right };
    }
    return left;
  }

  private parsePrimary(): AstNode {
    const t = this.next();
    if (!t) throw new ExprSyntaxError("unexpected end of expression");
    if (t.kind === "lparen") {
      const inner = this.parseOr();
      this.expectCloseParen();
      return inner;
    }
    if (t.kind === "number") {
      const value = Number(t.value);
      if (!Number.isFinite(value)) throw new ExprSyntaxError(`invalid number ${JSON.stringify(t.value)}`);
      return { kind: "literal", value };
    }
    if (t.kind === "string") return { kind: "literal", value: t.value };
    if (t.kind === "ident") {
      if (t.value === "true") return { kind: "literal", value: true };
      if (t.value === "false") return { kind: "literal", value: false };
      return { kind: "path", segments: t.value.split(".") };
    }
    throw new ExprSyntaxError(`unexpected token ${JSON.stringify(t.value)}`);
  }

  private expectCloseParen(): void {
    const t = this.next();
    if (!t || t.kind !== "rparen") throw new ExprSyntaxError("expected )");
  }
}

export type AstNode =
  | { kind: "literal"; value: ExprValue }
  | { kind: "path"; segments: string[] }
  | { kind: "comparison"; op: string; left: AstNode; right: AstNode }
  | { kind: "and"; left: AstNode; right: AstNode }
  | { kind: "or"; left: AstNode; right: AstNode }
  | { kind: "not"; operand: AstNode };

/** Parse and return the AST without evaluating (used by validate()). */
export function parseExpr(input: string): AstNode {
  return new Parser(tokenize(input)).parse();
}

function resolvePath(segments: string[], context: Record<string, unknown>): ExprValue {
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      throw new ExprEvalError(`unknown path ${segments.join(".")}`);
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      throw new ExprEvalError(`unknown path ${segments.join(".")}`);
    }
    current = record[segment];
  }
  if (typeof current === "number" || typeof current === "string" || typeof current === "boolean") {
    return current;
  }
  throw new ExprEvalError(`path ${segments.join(".")} is not a scalar value`);
}

function evalNode(node: AstNode, context: Record<string, unknown>): ExprValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "path":
      return resolvePath(node.segments, context);
    case "comparison": {
      const left = evalNode(node.left, context);
      const right = evalNode(node.right, context);
      if (typeof left !== typeof right) {
        throw new ExprEvalError(
          `cannot compare ${JSON.stringify(left)} (${typeof left}) with ${JSON.stringify(right)} (${typeof right})`,
        );
      }
      switch (node.op) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        default:
          throw new ExprEvalError(`unknown operator ${node.op}`);
      }
    }
    case "and": {
      const left = evalNode(node.left, context);
      const right = evalNode(node.right, context);
      if (typeof left !== "boolean" || typeof right !== "boolean") {
        throw new ExprEvalError("and requires boolean operands");
      }
      return left && right;
    }
    case "or": {
      const left = evalNode(node.left, context);
      const right = evalNode(node.right, context);
      if (typeof left !== "boolean" || typeof right !== "boolean") {
        throw new ExprEvalError("or requires boolean operands");
      }
      return left || right;
    }
    case "not": {
      const operand = evalNode(node.operand, context);
      if (typeof operand !== "boolean") throw new ExprEvalError("not requires a boolean operand");
      return !operand;
    }
  }
}

/** Evaluate a condition expression against a run context. */
export function evaluateExpr(input: string, context: Record<string, unknown>): ExprValue {
  const ast = parseExpr(input);
  const value = evalNode(ast, context);
  if (typeof value !== "boolean") {
    throw new ExprEvalError(`condition must evaluate to a boolean, got ${typeof value}`);
  }
  return value;
}
