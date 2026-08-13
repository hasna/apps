# Formulas

`@hasna/sheets` evaluates formulas with
[`fast-formula-parser`](https://www.npmjs.com/package/fast-formula-parser)
(MIT) — never HyperFormula (GPL-3.0).

## Writing formulas

A cell is a formula when its raw input starts with `=`:

```ts
setCell(wb, "C1", "=A1*B1");
setCell(wb, "C2", "=SUM(A1:A10)");
setCell(wb, "C3", '=IF(A1>0,"positive","non-positive")');
setCell(wb, "C4", "=Data!B2 + 1"); // cross-sheet reference
```

Supported: cell refs (`A1`, `$A$1`), ranges (`A1:B3`), full-column ranges
(`A:A`, clamped to the sheet's dimensions), cross-sheet references
(`SheetName!A1`), and ~280 Excel functions.

## Commonly used functions

`SUM`, `AVERAGE`, `AVERAGEA`, `COUNT`, `PRODUCT`, `IF`, `AND`, `OR`, `NOT`,
`ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `POWER`, `SQRT`, `MOD`, `SUMIF`,
`COUNTIF`, `VLOOKUP`, `CONCATENATE`, `LEFT`, `RIGHT`, `MID`, `LEN`, `UPPER`,
`LOWER`, `TRIM`, date/time functions, and more.

## Error values

| Value | Meaning |
| --- | --- |
| `#DIV/0!` | division by zero |
| `#VALUE!` | wrong argument type |
| `#NAME?` | unknown name |
| `#N/A` | lookup miss |
| `#CIRCULAR!` | the cell is part of a reference cycle |
| `#ERROR!` | the formula could not be parsed/evaluated |

The concrete error string is also stored on `cell.error`.

## Engine limitations (v1)

- **`MAX` / `MIN` are not implemented** by `fast-formula-parser@1.0.19` and
  resolve to `#ERROR!`. This is an upstream gap, documented so callers can
  avoid it (e.g. use `AVERAGE`, or compute extrema in application code).
- Circular references are reported as errors rather than iteratively converged
  (Excel's default behaviour); iterative calculation is not enabled.
- Array-spilling formulas are evaluated to a single (top-left) scalar.
