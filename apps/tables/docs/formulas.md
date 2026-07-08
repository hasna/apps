# Formulas

`@hasna/tables` ships a small, dependency-free formula engine (tokenizer →
recursive-descent parser → evaluator). It powers `formula` fields and is also
exported standalone.

## Syntax

- **Numbers**: `42`, `3.14`
- **Strings**: `'text'` or `"text"` (with `\` escapes)
- **Booleans**: `TRUE`, `FALSE`
- **Field references**: `{Field Name}` (resolved by name, case-insensitive)
- **Arithmetic**: `+` `-` `*` `/` and unary `-`
- **String concatenation**: `&`
- **Comparison**: `=` (or `==`), `!=` (or `<>`), `<`, `<=`, `>`, `>=`
- **Grouping**: `( ... )`

Operator precedence (loosest → tightest): comparison → `&` → `+ -` → `* /` →
unary → primary.

## Functions

```
Math:  SUM AVERAGE MIN MAX ROUND ABS CEILING FLOOR MOD POWER SQRT VALUE
Text:  CONCAT CONCATENATE UPPER LOWER TRIM LEN LEFT RIGHT MID REPT SUBSTITUTE T
Logic: IF AND OR NOT ISBLANK BLANK
Date:  TODAY NOW
```

## Examples

```ts
import { evaluateFormula } from "@hasna/tables";

evaluateFormula("1 + 2 * 3", () => null);                 // 7
evaluateFormula("'Hello, ' & {Name}", (n) => n === "Name" ? "world" : null); // "Hello, world"
evaluateFormula("ROUND({Impact} / {Effort}, 2)", resolve);
evaluateFormula("IF({Done}, 'shipped', 'open')", resolve);
```

## As a field

```ts
base.addField("Features", {
  name: "Score",
  type: "formula",
  options: { formula: "ROUND({Impact} / {Effort}, 2)", resultType: "number" },
});
```

Formula fields may reference other formula fields; circular references resolve
to empty instead of looping. Division by zero and unknown functions raise a
`FormulaError`, which the compute layer catches per-cell (the cell becomes
empty) so one bad formula never breaks a whole table.

## Compile once, run many

```ts
import { compileFormula } from "@hasna/tables";
const fn = compileFormula("{a} + {b}");
fn((n) => values[n]); // reuse across rows without re-parsing
```
