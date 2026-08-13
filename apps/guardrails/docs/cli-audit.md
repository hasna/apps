# CLI audit

Audit date: 2026-07-30

## Conclusion

Every command registered by the CLI works locally and none is dead. API-mode
parity is not applicable because this repository does not ship or configure an
API backend.

## Command inventory

This inventory comes from the command dispatch in `src/cli/index.ts`, not from
the README. The parser defaults to `help`, and the dispatch recognizes `help`,
`version`, `validate`, and `evaluate`. Unknown command names print help and
return a failure exit code; they are not registered commands.

| command | works locally? | works against the API backend (or N/A)? | dead? | changed in this PR? |
| --- | --- | --- | --- | --- |
| `guardrails help` (also no arguments or `--help`) | Yes | N/A | No | No |
| `guardrails version` | Yes | N/A | No | No |
| `guardrails validate --policy <path>` | Yes | N/A | No | No |
| `guardrails evaluate --input <path>` or `--stdin` | Yes | N/A | No | No |

## Backend determination

The API half of the audit is N/A based on all of the following repository
evidence:

- `hasna.contract.json` classifies the repository as a library, describes the
  CLI authentication mode as `local-only`, and waives the API surface because
  the package owns no HTTP service boundary.
- `docs/boundaries.md` describes the HTTP decision-service client as a future
  centralized policy boundary that does not require hosted infrastructure.
- The CLI has no API URL or API key configuration and no cloud-router or
  stage-A dispatch module.
- `HttpGuardrailDecisionService` is an SDK adapter for a caller-supplied
  endpoint; the repository does not provide that endpoint or a second backend.

Adding API flags to the CLI would invent a backend contract that this package
explicitly does not own, rather than implementing parity with an existing API.

## Verification evidence

`tests/cli.test.ts` exercises all four registered commands, including both
input forms for `evaluate`, valid and invalid `validate` results, default and
explicit help, version output, required-argument failures, custom policies,
decision exit codes, and unknown-command failure behavior. Because no dead
command or backend-parity defect exists, no command implementation or
regression test needed to change.

No commands remain to fix.
