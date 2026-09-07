---
"@hasna/recordings": patch
---

`recordings check` no longer renders the unresolved-credential state as a
green sqlite store (hasna/apps#1720 validation).

- With no resolvable credential the client fails closed, so no store is active.
  `describeActiveStore` now reports `transport: "none"` / `mode_source:
  "unresolved"` and does not open the on-box file to count it; `recordings
  check` prints `✗ Active store: none — fail-closed (REMOTE_API_CONFIG_MISSING
  …)` and exits 1 (also under `--json`, where `active_store.transport` is
  `"none"`). The local opt-in (`HASNA_RECORDINGS_LOCAL=1`) still renders as
  `✓ Active store: sqlite → <path>`.
- `recordings-mcp` fails closed at STARTUP: with no resolvable credential and
  no local opt-in it exits 1 with `ERROR: REMOTE_API_CONFIG_MISSING …` before
  connecting any transport — `initialize` is never answered over stdio and the
  HTTP transport never listens (it used to answer `initialize` and listen, and
  only refuse per tool call). The `HASNA_RECORDINGS_LOCAL=1` opt-in prints one
  `LOCAL mode` line on stderr, like the CLI and the SDK.
- The retired `~/.secrets` folder is no longer read for the OpenAI
  transcription key, and the hint now points at `OPENAI_API_KEY` /
  `secrets exec <key> --as OPENAI_API_KEY -- recordings …`.
