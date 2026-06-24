# CLI Output

`open-guardrails` defaults to compact terminal output. This keeps agent
contexts usable and avoids dumping complete decision records unless the caller
asks for them.

## Default

`guardrails evaluate` prints:

- status and a truncated reason,
- counts for policies, evidence, obligations, redactions, and approvals,
- a small matched-policy preview,
- a hint for the detail path.

It does not print full evidence records, redaction hashes, approval fields, or
audit metadata by default.

## Detail Paths

Use these when a human or agent needs more:

```bash
guardrails evaluate --input request.json --verbose
guardrails inspect --input request.json --limit 10 --cursor 0
guardrails show --input request.json --limit 10 --cursor 10
```

`inspect` and `show` are verbose aliases. They display sectioned details and
honor `--limit` and `--cursor` for human output. Use `--cursor` values copied
from emitted `more:` hints; out-of-range sections are omitted instead of
printing empty records.

## Machine Output

`--json` is the stable machine-readable path and returns the full
`GuardrailDecision` object. Existing automation should prefer `--json` rather
than parsing compact terminal output.

## Before And After

Before this compact-output pass, `guardrails evaluate --json` for the secret
redaction example printed about 60 pretty-printed lines by default when users
followed the README example. The compact terminal path now prints four lines:

```text
REDACT redact: Input contains secret-looking material that must be redacted before logging, dispatch, model routing, or tool execution.
1 policy | 1 evidence item | 1 obligation | 2 redactions | 0 approvals
matched: secret-redaction:redact
details: use --verbose or guardrails inspect --input <file> for evidence, obligations, redactions, approvals, and audit metadata.
```

Use `--json` only when the full object is required.
