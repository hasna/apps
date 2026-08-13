# CLI reference

The `banking` binary exposes provider descriptors, four Mercury live-read
operations, and local payment/card intent builders. It does not execute
provider-side mutations.

```bash
banking --help
banking --version
```

`-h` and `-v` are aliases. Options accept either `--key value` or
`--key=value`. `--json` requests JSON output where a command can otherwise emit
plain text.

## Provider operation registry

| Command | Required input | Optional input | Result |
| --- | --- | --- | --- |
| `ops list` | none | `--provider`, `--safety`, `--include-unsupported true`, `--json` | Matching operation descriptors. Unsupported descriptors are omitted by default. |
| `ops describe <provider.operation>` | operation id | `--json` | One operation descriptor or an invalid-request error. |
| `ops plan <provider.operation>` | operation id, `--environment` | `--scopes <scope,...>`, `--env-keys <KEY,...>`, `--json` | A non-executing environment, credential, scope, and conformance plan. |
| `providers list` | none | `--json` | All provider capability cards. |
| `providers show <provider>` | provider id | `--json` | One provider capability card. |

Valid providers are `mercury`, `bunq`, `revolut-business`, and `erste-bcr`.
Valid environments are `sandbox` and `production`. Valid `--safety` values are
`read`, `metadata_write`, `money_movement`, `card_lifecycle`,
`sensitive_read`, `webhook_mutation`, and `auth_flow`.

`--scopes` and `--env-keys` are comma-separated. The singular aliases
`--scope` and `--env-key` are also accepted. Supplying environment key names to
`ops plan` marks them present for preflight; never put credential values on the
command line.

## Live reads

Live reads require `--live true`, `--provider mercury`, and an explicit
`--environment sandbox|production`. Without `--live true`, read commands fail
closed with exit status 2. Other providers also fail closed with status 2.

| Command | Required input | Pagination and filters |
| --- | --- | --- |
| `accounts list` | `--provider` | `--limit 1..1000`, `--order asc|desc`, one of `--start-after` or `--end-before` |
| `balances get` | `--provider`, `--account` | none |
| `transactions list` | `--provider` | optional `--account`, `--limit 1..1000`, `--order asc|desc`, one of `--start-after`, `--end-before`, or `--start-at` |
| `cards list` | `--provider` | optional `--account`, `--limit 1..1000`, `--order asc|desc`, one of `--start-after` or `--end-before` |

Credentials resolve in this order: the environment-specific
`MERCURY_SANDBOX_API_KEY` or `MERCURY_PRODUCTION_API_KEY`, then
`MERCURY_API_KEY`, then the optional `--secret-key <reference>`. A secret
reference is resolved by running `secrets get <reference>` locally; it is not a
raw token argument.

The client sends Bearer authentication to the environment-specific Mercury API
base URL. Responses are normalized and sensitive account/routing/card fields
are reduced to summaries; raw credentials are never returned.

## Local intent envelopes

These commands return an intent, its idempotency fingerprint, and a policy
decision. They never submit the intent to a provider.

| Command | Required input | Optional input |
| --- | --- | --- |
| `payments quote` | `--provider`, `--account`, `--amount`, `--currency`, `--to` | `--recipient`, `--rail` |
| `payments request` | `--provider`, `--account`, `--amount`, `--currency`, `--to` | `--recipient`, `--rail` |
| `payments status` | `--provider`, `--request` | `--provider-payment` |
| `cards request` | `--provider`, `--account`, `--label` | `--limit-month` with required `--currency` |
| `cards update` | `--provider`, `--card` | `--label` |
| `cards freeze` | `--provider`, `--card` | none |
| `cards unfreeze` | `--provider`, `--card` | none |
| `cards terminate` | `--provider`, `--card` | none |

All envelope commands accept `--actor <id>` (default `agent-cli`),
`--reason <text>` (a command-specific default), `--live true`, and
`--environment sandbox|production` (default `sandbox`). `--live true` changes
policy evaluation only; it does not enable provider submission. Payment rails
default to `ach`. Currency codes are uppercased before money parsing.

## Admin gate

`banking admin --help` reports the planned administrative surface. Any other
`admin` command returns `admin_approval_required`; provider verification is not
implemented.

## Output and exit status

| Status | Meaning |
| --- | --- |
| `0` | Help/version or a command completed successfully. A successful local envelope may still contain a denied policy decision. |
| `1` | Unknown command, missing/invalid input, invalid provider/environment, or provider/API error caught as `invalid_request`. |
| `2` | A requested read adapter is not implemented, live mode was omitted, or the provider has no live adapter. |
| `3` | An administrative command is gated. |

Structured errors are written to stderr. Unknown commands are plain text unless
`--json` is set; validation and adapter errors are JSON objects in either mode.
