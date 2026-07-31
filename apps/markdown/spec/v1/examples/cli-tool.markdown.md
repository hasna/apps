# jsonkit

@use shell

---

type: project
id: init
name: jsonkit
framework: none
language: typescript
pkg: bun

CLI tool with Bun. No web framework. Strict TypeScript. `bin: ./dist/cli.js`, version `{{random(1, numeric)}}.0.0`, shebang `#!/usr/bin/env bun`.

---

type: tree
id: file-structure
depends: init

src/
  cli.ts
  commands/
    parse.ts
    validate.ts
    format.ts
    diff.ts
  lib/
    parser.ts
    validator.ts
    formatter.ts
    differ.ts
    errors.ts
  types/
    index.ts
tests/
  parser.test.ts
  validator.test.ts
  formatter.test.ts
  differ.test.ts
  cli.test.ts

`commands/` delegates to `lib/`. Pure logic in `lib/` for testability.

---

type: functions
id: types
file: src/types/index.ts
depends: init

- JsonValue(): JsonPrimitive | JsonObject | JsonArray
  Union of all valid JSON value types.

- ParseOptions(): { strict: boolean, allowComments: boolean, maxDepth: number }
  Strict rejects trailing commas. AllowComments strips JS-style comments.

- FormatOptions(): { indent: number, sortKeys: boolean, trailingNewline: boolean }
  SortKeys alphabetizes recursively.

- DiffEntry(): { path: string, type: 'added' | 'removed' | 'changed', left: JsonValue, right: JsonValue }
  Single difference with JSON Pointer (RFC 6901) path.

---

type: functions
id: parser-lib
file: src/lib/parser.ts
depends: types

- parse(input: string, options: ParseOptions): JsonValue
  Parse JSON. Strict rejects non-standard extensions. Strip comments when allowed. ParseError with line/column. DepthExceededError past maxDepth.

- parseFile(filePath: string, options: ParseOptions): JsonValue
  Read and parse file. BOM detection, default UTF-8. FileNotFoundError for missing.

- stringify(value: JsonValue, indent: number): string
  Serialize to JSON string.

accepts: strict rejects trailing commas; depth enforced

---

type: functions
id: validator-lib
file: src/lib/validator.ts
depends: types, parser-lib

- validate(input: string, options: ParseOptions): ValidationResult
  Collect all errors, don't stop at first.

- validateAgainstSchema(input: JsonValue, schema: JsonValue): ValidationResult
  JSON Schema draft 2020-12: type, required, properties, items, enum, pattern, min, max, $ref.

accepts: multiple errors collected; JSON Schema 2020-12

---

type: functions
id: formatter-lib
file: src/lib/formatter.ts
depends: types, parser-lib

- format(input: string, options: FormatOptions): string
  Re-serialize with formatting. SortKeys recursive.

- minify(input: string): string
  Single line. Preserve whitespace inside strings.

- formatInPlace(filePath: string, options: FormatOptions): void
  Atomic write via temp-rename. Preserve permissions.

accepts: sorted keys recursive; atomic write

---

type: functions
id: differ-lib
file: src/lib/differ.ts
depends: types, parser-lib

- diff(left: JsonValue, right: JsonValue): DiffEntry[]
  Recursive comparison with JSON Pointer paths. Arrays by index.

- diffFiles(leftPath: string, rightPath: string, options: ParseOptions): DiffEntry[]
  Read, parse, diff two files.

- formatDiff(entries: DiffEntry[]): string
  Colored: green additions, red removals, yellow changes.

accepts: nested diffs recursive; colored output

---

type: functions
id: error-lib
file: src/lib/errors.ts
depends: init

- ParseError(message: string, line: number, column: number): Error
- DepthExceededError(maxDepth: number, currentDepth: number): Error
- FileNotFoundError(filePath: string): Error
- SchemaError(message: string, pointer: string): Error

---

type: middleware
id: cli-args
file: src/cli.ts
depends: parser-lib, validator-lib, formatter-lib, differ-lib

Parse `process.argv`:

- `jsonkit parse <file> [--strict] [--allow-comments] [--max-depth N]`
- `jsonkit validate <file> [--schema <schema-file>]`
- `jsonkit format <file> [--indent N] [--sort-keys] [--minify] [--write]`
- `jsonkit diff <file1> <file2> [--strict]`
- `jsonkit --help` -- {{generate concise help text for a JSON CLI with parse, validate, format, diff}}
- `jsonkit --version` -- version from package.json

Errors to stderr with file, line, column. Exit 1 on error, 0 on success.

accepts: --help works; --version works; errors to stderr with exit 1

---

type: test
id: parser-tests
pattern: tests/parser.test.ts
framework: bun:test
depends: parser-lib

- parse valid JSON returns correct structure
- strict rejects trailing commas and single quotes
- allowComments strips comments
- ParseError includes line and column
- DepthExceededError at maxDepth
- parseFile FileNotFoundError for missing files

---

type: test
id: formatter-tests
pattern: tests/formatter.test.ts
framework: bun:test
depends: formatter-lib

- format applies indent and sorts keys recursively
- minify removes whitespace, preserves strings
- formatInPlace atomic write, preserves permissions

---

type: test
id: differ-tests
pattern: tests/differ.test.ts
framework: bun:test
depends: differ-lib

- diff detects added, removed, changed keys
- handles nested objects and arrays
- formatDiff produces colored output

---

type: test
id: cli-tests
pattern: tests/cli.test.ts
framework: bun:test
depends: cli-args

- parse --strict exits 1 for invalid JSON
- validate --schema reports violations
- format --write modifies file in place
- diff shows differences
- --help and --version print expected output
- unknown commands exit 1

accepts: all pass; exit codes correct

---

type: deploy
id: publish
provider: npm
env: [NPM_TOKEN]
depends: cli-args, parser-tests, formatter-tests, differ-tests, cli-tests

Build: `bun build src/cli.ts --outdir dist --target node`. Shebang in output. `files: ["dist", "README.md", "LICENSE"]`. Run `npm publish --access public`. Verify: `bunx jsonkit --version`.

accepts: publish succeeds; binary executable; --version works
