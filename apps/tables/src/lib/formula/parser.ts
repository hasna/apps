/** Recursive-descent parser producing an AST from formula tokens. */
import { FormulaError, tokenize, type Token } from "./tokenizer.js";

export type Ast =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "field"; name: string }
  | { kind: "unary"; op: "-" | "!"; operand: Ast }
  | { kind: "binary"; op: string; left: Ast; right: Ast }
  | { kind: "call"; name: string; args: Ast[] };

const COMPARISON = new Set(["=", "==", "!=", "<>", "<", "<=", ">", ">="]);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new FormulaError("Unexpected end of formula");
    this.pos++;
    return t;
  }

  private expect(type: Token["type"]): Token {
    const t = this.next();
    if (t.type !== type) throw new FormulaError(`Expected ${type} but got "${t.value}"`);
    return t;
  }

  parse(): Ast {
    if (this.tokens.length === 0) throw new FormulaError("Empty formula");
    const expr = this.parseComparison();
    if (this.pos < this.tokens.length) {
      throw new FormulaError(`Unexpected token "${this.peek()!.value}"`);
    }
    return expr;
  }

  // lowest precedence
  private parseComparison(): Ast {
    let left = this.parseConcat();
    while (this.peek()?.type === "op" && COMPARISON.has(this.peek()!.value)) {
      const op = this.next().value;
      const right = this.parseConcat();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseConcat(): Ast {
    let left = this.parseAdditive();
    while (this.peek()?.type === "op" && this.peek()!.value === "&") {
      this.next();
      const right = this.parseAdditive();
      left = { kind: "binary", op: "&", left, right };
    }
    return left;
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Ast {
    let left = this.parseUnary();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Ast {
    const t = this.peek();
    if (t?.type === "op" && (t.value === "-" || t.value === "!")) {
      this.next();
      return { kind: "unary", op: t.value as "-" | "!", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const t = this.next();
    switch (t.type) {
      case "number":
        return { kind: "number", value: Number(t.value) };
      case "string":
        return { kind: "string", value: t.value };
      case "field":
        return { kind: "field", name: t.value };
      case "lparen": {
        const expr = this.parseComparison();
        this.expect("rparen");
        return expr;
      }
      case "ident": {
        const upper = t.value.toUpperCase();
        if (upper === "TRUE") return { kind: "boolean", value: true };
        if (upper === "FALSE") return { kind: "boolean", value: false };
        // function call
        if (this.peek()?.type === "lparen") {
          this.next(); // consume (
          const args: Ast[] = [];
          if (this.peek()?.type !== "rparen") {
            args.push(this.parseComparison());
            while (this.peek()?.type === "comma") {
              this.next();
              args.push(this.parseComparison());
            }
          }
          this.expect("rparen");
          return { kind: "call", name: upper, args };
        }
        throw new FormulaError(`Unknown identifier "${t.value}" (functions require parentheses)`);
      }
      default:
        throw new FormulaError(`Unexpected token "${t.value}"`);
    }
  }
}

export function parseFormula(source: string): Ast {
  return new Parser(tokenize(source)).parse();
}
