# CLI audit

This audit was derived from the Commander registrations in
`src/cli/index.ts`, not from the README or the manual command. The registration
tree exposes 23 leaf commands. Every leaf has an action handler, and tracing
each handler found no references to removed code, placeholders, or commands
that unconditionally fail.

## Backend scope

API-backend parity is not applicable to this repository. The checked runtime
configuration in `src/paths.ts` only selects local home, SQLite, cache, and
install paths. There is no models API URL/key, backend selector, cloud-router,
or stage-A client. `src/huggingface.ts` does make HTTP requests, but those are
provider operations against the upstream Hugging Face service; `HF_ENDPOINT`
only replaces that provider endpoint and does not select a remote models
backend. Local persistence and install management use `ModelsStore` and
`bun:sqlite` directly.

## Command inventory

The “works locally” verdict means the command has a complete on-box execution
path, including valid empty/not-found or upstream-provider error behavior where
appropriate. “Changed” refers to command behavior, not this audit and its
regression guard.

| command | works locally? | works against the API backend (or N/A)? | dead? | changed in this PR? |
| --- | --- | --- | --- | --- |
| `models providers list` | Yes | N/A | No | No |
| `models providers status` | Yes | N/A | No | No |
| `models providers auth` | Yes | N/A | No | No |
| `models search` | Yes | N/A | No | No |
| `models info` | Yes | N/A | No | No |
| `models files` | Yes | N/A | No | No |
| `models plan` | Yes | N/A | No | No |
| `models install` | Yes | N/A | No | No |
| `models index hf` | Yes | N/A | No | No |
| `models index best` | Yes | N/A | No | No |
| `models list` | Yes | N/A | No | No |
| `models capabilities seed-fixtures` | Yes | N/A | No | No |
| `models capabilities list` | Yes | N/A | No | No |
| `models capabilities get` | Yes | N/A | No | No |
| `models where` | Yes | N/A | No | No |
| `models remove` | Yes | N/A | No | No |
| `models datasets search` | Yes | N/A | No | No |
| `models datasets info` | Yes | N/A | No | No |
| `models datasets files` | Yes | N/A | No | No |
| `models datasets install` | Yes | N/A | No | No |
| `models doctor` | Yes | N/A | No | No |
| `models manual` | Yes | N/A | No | No |
| `models goals` | Yes | N/A | No | No |

## Conclusion

No dead commands or local/API parity gaps require a behavior change. The test
suite imports the actual Commander tree and checks that this table remains an
exact inventory of registered, actionable leaf commands.
