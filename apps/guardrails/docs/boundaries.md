# Boundaries

`@hasna/guardrails` decides whether a proposed operation is allowed, denied,
warned, redacted, or approval-gated. It does not execute the operation.

## Relationship To @hasna/actions

`@hasna/actions` should own typed executable contracts: action manifests,
previews, idempotency, execution bindings, rollback shape, and action audit
events.

`@hasna/guardrails` should evaluate an action preview or execution request before
the action runs. The guardrail input may reference an action id, action kind,
phase, resource, preview, and idempotency key, but the action package remains
the source of truth for what the action means and how it executes.

## Relationship To @hasna/security

`@hasna/security` should own repository scans, dependency checks, secret exposure
scanning, vulnerability triage, SARIF/report output, and security dashboards.

`@hasna/guardrails` may reuse findings from security scanners as input evidence,
but it should not become a full scanner. The starter policy includes lightweight
inline redaction patterns for prompts, tool calls, and audit surfaces because
that is required at decision time.

## Relationship To Routing And Runtime Tools

`@hasna/gateway` owns provider catalogs, routing, credentials,
budgets, provider attempts, and HTTP surfaces. Guardrails can evaluate routing
requests before model selection or after a candidate is selected, especially for
cost, data policy, region, or provider warnings.

`@hasna/dispatch` and `@hasna/mcps` own their execution and
delivery mechanics. Guardrails should be called before command execution,
prompt delivery, and MCP tool invocation. The decision output is intentionally
portable so each tool can decide how to display warnings, collect approvals, or
block execution.

## Local First, Cloud Ready

The SDK evaluates local JSON policy files synchronously in process. The
`GuardrailDecisionService` interface and HTTP service client define the future
centralized policy boundary without requiring hosted infrastructure.
