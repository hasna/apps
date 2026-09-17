# Output-efficiency contract

This contract standardizes machine-facing collection output without changing
application authority or transport behavior. Applications authorize and fetch
data as before, then pass already-authorized values into the pure
`@hasna/contracts/output` helpers.

## Page semantics

A page envelope contains `items` and `_meta`.

- `count` is derived from the emitted page.
- `total` is the whole requested population when known, otherwise `null`.
- `cursor_semantics` explicitly distinguishes numeric `offset`, string
  `opaque`, and non-pagination `whole-query` cursors.
- Numeric offsets require `next_cursor === cursor + count`; they cannot move
  backward, skip rows, terminate before a known total, or continue at/past it.
- `has_more` states whether the response provides a usable continuation.
- `complete` is true only when this envelope contains the whole requested
  population. It is not inferred from a missing cursor, and a nonzero offset
  cannot claim completeness unless `whole-query` semantics are explicit.
- `truncated` records representation-level omission and requires one or more
  `truncation_reasons`.
- `complete: true` cannot coexist with `has_more: true` or `truncated: true`.
- A known total and `complete: true` require `count === total`.

The helper refuses contradictory claims rather than repairing them silently.

## Projection

`projectRecord` and `projectRecords` select exact top-level fields. Required
identity or concurrency fields are always emitted first. Missing fields refuse
by default; callers may explicitly omit unknown optional fields. Accessors,
class instances, and prototype-sensitive field names refuse so projection does
not execute caller code.

## Serialization

`serializeJson` produces deterministic strict JSON:

- object keys are sorted recursively;
- arrays preserve order;
- only finite numbers are accepted;
- sparse arrays, `undefined`, `bigint`, functions, symbols, accessors,
  `toJSON`-bearing class instances, and circular structures refuse;
- compact output is the default; pretty output is explicit;
- a trailing newline is explicit.

`serializeJsonLines` emits one compact JSON value per line with exactly one LF
per record. `serializePageJsonLines` structurally revalidates its envelope,
emits typed `item` rows, and always emits a final typed `page_receipt`. The
receipt is mandatory because otherwise pagination, completeness, totals, and
truncation cannot be proven from the JSONL stream.

## Byte budgets

`utf8ByteLength`, `measureJson`, and `measureJsonLines` count UTF-8 bytes rather
than JavaScript UTF-16 code units. `fitPageToByteBudget` measures the complete
serialized envelope, including metadata and framing, and keeps the largest
ordered prefix that fits. It never skips an oversized first item to include
later items. Numeric-offset continuation is derived as `offset + emitted count`;
an opaque cursor requires a caller-provided continuation function. Whole-query
pages refuse clipping because doing so would change their cursor semantics. The
returned envelope includes stable `byte_length` and `max_bytes` metadata.

## Advisory fleet declaration

The report-only census reads static package and service-contract metadata. It
never executes package code or scripts and never contacts a hosted service.
Members can declare adoption under `hasna.contract.json`:

```json
{
  "metadata": {
    "outputEfficiency": {
      "version": 1,
      "cli": {
        "defaultMaxItems": 25,
        "defaultMaxBytes": 32768,
        "machineJson": "compact",
        "exhaustiveRequiresExplicit": true
      },
      "mcp": {
        "defaultProfile": "standard",
        "toolsListMaxBytes": 16384,
        "defaultResponseMaxBytes": 32768,
        "machineJson": "compact"
      }
    }
  }
}
```

The initial gate is report-only. Missing or unsafe declarations are findings,
not CI failures. Scanner failure, malformed required JSON, or a broken self-test
still fails because inability to measure is not a clean result.

### Trusted callback boundary

The module does not perform ambient I/O or invoke object accessors, `toJSON`, or
arbitrary iterators. For opaque cursors, `fitPageToByteBudget` invokes the
explicit `nextCursorForIndex` callback supplied by the adapter. That callback
must be deterministic, side-effect-free, and return the cursor for the first
omitted item. Numeric offset cursors are derived internally and never trust the
callback. The budget applies to the serialized JSON envelope produced by this
module; adapters that add an MCP wrapper or other framing must reserve or
measure those wrapper bytes separately.

Page envelopes and their metadata arrays are branded and frozen after
validation (item objects remain caller-owned). JSONL always carries its final
page receipt; structural JavaScript inputs are revalidated before emission.
