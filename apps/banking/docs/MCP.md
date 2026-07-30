# MCP reference

The package contains an MCP-shaped descriptor and local dispatch module, not an
MCP protocol server.

## Binary

```bash
banking-mcp --help
banking-mcp --version
banking-mcp --list-tools
```

`-h` and `-v` are aliases. These commands exit with status 0.
`--list-tools` prints tool descriptors and provider capability cards as JSON.
Invoking the binary without an implemented flag prints an error and exits 1;
it does not start a stdio, HTTP, or SSE MCP transport.

## Library dispatch

The MCP module exports `listMcpTools`, `listMcpToolDescriptors`,
`listPlannedMcpTools`, and `runMcpTool`. `runMcpTool(name, input)` is a local
function call and does not perform MCP transport or schema negotiation.

| Tool | Status | Input |
| --- | --- | --- |
| `banking_ops_list` | implemented | optional `providerId`, `includeUnsupported` |
| `banking_ops_describe` | implemented | `operationId` |
| `banking_ops_plan` | implemented | `operationId`, `environment`; optional `grantedScopes`, `envKeys` |
| `banking_providers_list` | implemented | none |
| `banking_provider_get` | implemented | `providerId` |
| `banking_accounts_list` | provider-backed pending | `providerId` |
| `banking_balance_get` | provider-backed pending | `providerId`, `accountId` |
| `banking_transactions_list` | provider-backed pending | `providerId`, `accountId` |
| `banking_cards_list` | provider-backed pending | `providerId` |
| `banking_payment_quote` | implemented locally | payment input |
| `banking_payment_request` | implemented locally | payment input |
| `banking_payment_status` | implemented locally | `providerId`, `paymentRequestId`; optional `providerPaymentId` |
| `banking_card_request` | implemented locally | `providerId`, `accountId`, `label` |
| `banking_card_update_request` | implemented locally | `providerId`, `cardId`; optional `label` |
| `banking_card_freeze_request` | implemented locally | `providerId`, `cardId` |
| `banking_card_unfreeze_request` | implemented locally | `providerId`, `cardId` |
| `banking_card_terminate_request` | implemented locally | `providerId`, `cardId` |
| `banking_admin_provider_verify_operation` | admin gated | none |

Payment input requires `providerId`, `sourceAccountId`, `counterpartyName`,
`amount`, and `currency`; `providerRecipientId`, `rail`, `actorId`, `reason`,
`liveMode`, and `environment` are optional. The default rail is `ach`, actor is
`agent-mcp`, and environment is `sandbox`.

Card and payment tools create local intent envelopes only. `liveMode: true`
changes policy evaluation but does not submit the intent. Generic read tools
return `provider_backed_pending` and do not use the Mercury network adapter.
The admin tool returns `admin_approval_required`. Unknown names return
`not_implemented` rather than throwing.

`grantedScopes` and `envKeys` accept either a comma-separated string or a string
array. Provider ids and environments are validated. Missing required string
fields throw an error to the direct caller.
