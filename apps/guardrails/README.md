# open-guardrails

Reusable guardrail and policy decisions for agentic systems.

This project is intended to evaluate whether actions, prompts, shell commands,
MCP tool calls, browser/computer use, model routing, source access, secrets
access, and business operations should be allowed, denied, warned, redacted, or
approval-gated.

## Status

First useful OSS version: local-first TypeScript SDK, policy evaluator, CLI,
examples, and integration helper shapes for sibling open-* tools.

## Install

```bash
bun install
bun run typecheck
bun test
```

## CLI

Default terminal output is intentionally compact for humans and agents:

```bash
guardrails evaluate \
  --policy examples/policies/starter.guardrails.json \
  --input examples/requests/destructive-shell-command.json
```

Example compact output:

```text
APPROVAL approval_required: Destructive shell commands require a human approval checkpoint.
1 policy | 1 evidence item | 0 obligations | 0 redactions | 1 approval
matched: destructive-shell-command-approval:approval_required
details: use --verbose or guardrails inspect --input <file> for evidence, obligations, redactions, approvals, and audit metadata.
```

Use gradual disclosure when you need more:

```bash
guardrails evaluate --input examples/requests/destructive-shell-command.json --verbose
guardrails inspect --input examples/requests/destructive-shell-command.json --limit 10
guardrails show --input examples/requests/secret-redaction.json --limit 1
guardrails evaluate --input examples/requests/destructive-shell-command.json --json
guardrails validate --policy examples/policies/starter.guardrails.json --verbose
```

Exit codes:

- `0`: allowed, warned, or redacted.
- `1`: denied or invalid input.
- `2`: approval required.

`--json` remains the full stable machine-readable decision object. Human output
uses `--limit` and `--cursor` only for displayed sections, so agents can page
through details without flooding context.

## SDK

```ts
import {
  defaultGuardrailPolicySet,
  evaluateGuardrail,
  openTerminalCommandGuardrailInput,
} from "@hasna/guardrails";

const input = openTerminalCommandGuardrailInput({
  command: "rm -rf ./tmp/generated-output",
  cwd: "/workspace/project",
  targetKind: "shell",
});

const decision = evaluateGuardrail(input, defaultGuardrailPolicySet);
```

## Decision Shape

Every decision includes:

- `status`: `allow`, `deny`, `warn`, `redact`, or `approval_required`.
- `reason` and `matchedPolicies`.
- `evidence`, `obligations`, `redactions`, and `approvalRequirements`.
- `audit` metadata with decision id, evaluated time, policy set, operation type,
  actor, trace id, and labels.

## Examples

The starter policy covers:

- Secret redaction.
- Destructive shell command approval.
- Remote content piped to shell denial.
- Expensive model routing warnings.
- External-source trust warnings.
- High-impact business-action approval.

## Boundaries

Guardrails evaluate and decide. They do not execute actions, dispatch prompts,
run commands, call MCP tools, route models, or scan repositories.

- `open-actions` defines executable action contracts and previews.
- `open-security` owns security scanning and vulnerability/secret exposure
  workflows.
- `open-terminal`, `open-dispatch`, `open-mcps`, `open-gateway`, and
  `open-router` own their runtime mechanics and can call this package before
  execution.

See [docs/boundaries.md](docs/boundaries.md) and
[docs/integrations.md](docs/integrations.md). See
[docs/cli-output.md](docs/cli-output.md) for compact-output conventions.
