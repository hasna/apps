# Results Format

The first result format will normalize external benchmark outputs into stable records:

- suite id, schema version, and immutable manifest version
- run id and attempt id
- model/provider/route metadata
- metrics and score values
- latency, token, and cost fields when available
- artifact references and checksums
- safety/license/sandbox/source metadata
- evidence manifests with redacted fixture payload hashes and safety gate results
- parser warnings and raw-output pointers

Large raw outputs should live outside SQLite. SQLite stores metadata, indexes, hashes, and artifact pointers.

Raw segment records are append-only JSONL. Each indexed segment stores the byte offset, byte length, and SHA-256 of the exact JSONL line. A single segment event is capped at 1 MiB by default so oversized raw output is forced into artifact storage instead of SQLite-indexed event payloads.

Fixture-safe wrapper runs write two evidence events: a redacted `fixture-result` event and a `bench.evidence.v1` manifest. Credential values are never accepted on the command line; callers pass environment variable names with `--secret-ref`.

`bench.evidence.v1` includes:

- run, attempt, benchmark, manifest, model, and provider ids
- stable metric and redacted payload hashes
- manifest, source, and adapter command hashes
- package version
- explicit policy acknowledgements for `secretRefs`, network, sandbox, and limits
- safety gate result
- artifact manifest entries
- cleanup status
- redaction findings

The evidence manifest stores safe environment variable names, such as `OPENAI_API_KEY`, but never raw credential values.
