# Hasna Gateway Docs

Use these pages as the current operator and API reference:

1. [CLI reference](cli.md)
2. [Configuration reference](configuration.md)
3. [API contract](api-contract.md)
4. [Architecture](architecture.md)
5. [Provider adapters](provider-adapters.md)
6. [2026 provider references](provider-references.md)
7. [Routing and policy](routing-and-policy.md)
8. [Gateway MCP server](mcp.md)
9. [Security and compliance](security-compliance.md)
10. [Open-core boundary](open-core-boundary.md)

The [product requirements](product-requirements.md), [implementation plan](implementation-plan.md), [publishing and release checklist](publishing-and-release.md), [Hasna app migration plan](migration-plan.md), and [agent handoff prompt](handoff-prompt.md) record product intent and project history. When they describe future work, the current reference pages and implementation take precedence.

## Current Decision

The gateway should be open source as a self-hostable core. The commercial Hasna product should be a hosted wrapper that adds one Hasna API key, billing, pooled provider keys, discounts, dashboards, and enterprise controls.

## Build Contract

The implemented gateway surface includes:

- A working CLI server.
- A stdio MCP server for safe local gateway inspection, route explanation, budget maintenance, and ledger summaries.
- OpenAI-compatible chat completions.
- OpenAI-compatible embeddings.
- OpenAI-compatible and Anthropic provider adapters.
- Config validation.
- Model aliases.
- Fallback routing.
- Smart cost/quality/latency routing.
- Explicit provider policy.
- Config-driven provider auth and headers.
- Streaming.
- Optional in-memory response caching and per-key rate limits.
- Hard and soft budgets backed by local JSONL, SQLite, or Postgres usage storage.
- Usage normalization.
- Tests.

Provider breadth should stay on the generic OpenAI-compatible adapter when the upstream gateway uses standard chat completions plus headers or documented request-body provider options.

## Gateway Examples

- [OpenRouter Auto Router](../examples/openrouter-auto/README.md)
- [Vercel AI Gateway](../examples/vercel-ai-gateway/README.md)
- [Portkey AI Gateway](../examples/portkey/README.md)
- [Cloudflare AI Gateway](../examples/cloudflare-ai-gateway/README.md)
- [LiteLLM Proxy](../examples/litellm-proxy/README.md)
- [Helicone AI Gateway](../examples/helicone-ai-gateway/README.md)
- [Kong AI Gateway](../examples/kong-ai-gateway/README.md)
