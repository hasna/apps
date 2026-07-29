# Datasets and Assertions

## File formats

`loadDataset` accepts:

- JSONL: one case per non-empty line; lines beginning with `//` are ignored.
- JSON: one array of case objects.
- Glob patterns containing `*` or `?`; matched files are combined.

Malformed cases produce warnings and are skipped by default. The SDK's `{ strict: true }` loader option throws instead. A case must have a non-empty string `id` and either `input` or a `turns` array. Tag filters use OR matching: a case is included when any case tag appears in the requested tags.

## Case fields

| Field | Required | Behavior |
|---|---|---|
| `id` | yes | Non-empty case identifier |
| `input` | one of `input`/`turns` | Single-turn input string |
| `turns` | one of `input`/`turns` | Conversation transcript; takes precedence over `input` |
| `expected` | no | Natural-language expected behavior passed to the judge |
| `adapter` | no | Per-case adapter override |
| `assertions` | no | Ordered checks; the runner reorders them cheapest-first |
| `judge` | no | Rubric and optional model/provider/key |
| `repeat` | no | Per-case repeat count |
| `passThreshold` | no | Passing repeat fraction; default `1.0` |
| `tags` | no | Strings used for filtering |
| `metadata` | no | Arbitrary metadata; calibration reads `gold_verdict` |

## Multi-turn transcripts

Every turn has `role` (`user` or `assistant`) and `content`. Assistant turns may also carry `expected` metadata.

```json
{
  "id": "refund-flow",
  "turns": [
    { "role": "user", "content": "I need a refund." },
    { "role": "assistant", "content": "What is your order ID?", "expected": "asks for order ID" },
    { "role": "user", "content": "Order #1234" }
  ],
  "judge": { "rubric": "The response should explain the next refund step." }
}
```

The runner sends the complete transcript in one adapter call; it does not execute an interactive turn-by-turn loop. HTTP, Anthropic, and OpenAI adapters preserve the transcript. Other adapters receive the first input string.

## Pass^k and repeats

`repeat` runs copies concurrently. A case-level value overrides the run-level `--repeat` value. The result contains `repeatVerdicts` and `passRate`:

- `PASS` when `passRate >= passThreshold`.
- `FAIL` when no repeat passes.
- `UNKNOWN` when some repeats pass but the threshold is not met.

The default threshold is `1.0`, so every repeat must pass unless configured otherwise. Duration is the longest repeated call; cost is summed.

## Assertion execution

Assertions run cheapest-first and short-circuit after the first failure. Remaining assertions are returned as failed with the reason `Skipped — earlier assertion failed`. If all assertions pass, a configured judge runs next. Cases with no assertions and no judge pass when the adapter succeeds.

| Type | Configuration and behavior |
|---|---|
| `equals` | Exact string equality using `value` |
| `contains` / `not_contains` | Case-sensitive substring checks using `value` |
| `starts_with` / `ends_with` | Case-sensitive prefix/suffix checks |
| `regex` / `not_regex` | JavaScript regular expression from `value` |
| `max_length` / `min_length` | Character count using `value`, or `max`/`min` |
| `json_valid` | `JSON.parse` succeeds |
| `json_schema` | Parsed output validates against the AJV schema in `value` |
| `tool_called` / `tool_not_called` | Tool name in `value` is present/absent |
| `tool_call_count` | Total tool calls are within optional `min`/`max` |
| `tool_args_match` | `value` is `{ "tool": "name", "args": { ... } }`; expected top-level arguments match strictly |
| `response_time_ms` | Adapter duration is at most `max` or `value` |
| `token_count` | Input plus output tokens are within `min`/`max` |
| `cost_usd` | Adapter cost is at most `max` or `value` |
| `semantic_similarity` | Similarity to string `value` meets `threshold` (default `0.8`) |

`semantic_similarity` uses OpenAI `text-embedding-3-small` when `OPENAI_API_KEY` is set. If the request fails or no key exists, it uses Jaccard similarity over lowercase word tokens.

## Judge behavior

Judges return only `PASS`, `FAIL`, or `UNKNOWN`. The default provider is Anthropic and the default model is `claude-sonnet-4-6`. OpenAI is supported with `provider: "openai"`. Provider temperature is fixed at `0`; API keys come from the case config, provider environment variables, or the supported local secrets files.
