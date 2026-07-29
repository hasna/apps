# API Contract

## Compatibility Principle

The public API is OpenAI-compatible where possible. Existing OpenAI SDK clients can point `baseURL` at the gateway and use chat completions and embeddings.

Compatibility does not mean hiding provider differences. If a provider cannot support a feature, the gateway should return a clear capability error or route to an allowed provider that can support it.

## Authentication

Self-hosted mode:

```http
Authorization: Bearer <local-gateway-key>
```

Hosted Hasna mode:

```http
Authorization: Bearer <hasna-api-key>
```

Built-in provider credentials are configured through server-side environment variables. Custom provider headers may be static or environment-derived, but client request bodies never supply provider credentials.

## `GET /health`

Returns service status. In `local` runtime mode this is a lightweight liveness check. In `production-cloud` mode with `runtime.health.requireRuntimeSecrets: true`, it is a fail-closed readiness check and returns `503` until the gateway key is present and every configured route has an eligible provider with its key present.

```json
{
  "status": "ok",
  "version": "0.1.6",
  "runtime": {
    "mode": "production-cloud"
  },
  "checks": {
    "runtimeSecrets": "ok"
  }
}
```

Health responses must not include secret values or environment variable names.

## `GET /version`

Returns `{ "name": "@hasna/gateway", "version": "<current version>" }`. This endpoint is public.

## `GET /ready`

Returns authenticated operational checks for runtime config, gateway auth, providers, routes, and usage-ledger availability. The response status is `200` when ready and `503` when runtime validation fails. A missing cumulative ledger is reported as `deferred` because per-request budgets remain usable.

## `GET /v1/models`

Returns configured gateway models and aliases, including provider and capability metadata that is safe to expose.

```json
{
  "object": "list",
  "data": [
    {
      "id": "coding",
      "object": "model",
      "owned_by": "hasna-gateway",
      "providers": ["deepseek", "qwen", "openai"],
      "capabilities": ["chat", "streaming", "tools"]
    }
  ]
}
```

## `POST /v1/chat/completions`

Supports:

- `model`
- `messages`
- `stream`
- `tools`
- `tool_choice`
- `response_format`
- `temperature`
- `top_p`
- `max_tokens`
- `max_completion_tokens`
- `stop`
- `seed` when provider supports it
- `n`, `presence_penalty`, and `frequency_penalty`
- `parallel_tool_calls`, `logprobs`, and `top_logprobs`
- `metadata`, `store`, `reasoning_effort`, `modalities`, `audio`, `prediction`, `service_tier`, and `user`

Example:

```json
{
  "model": "coding",
  "messages": [
    {
      "role": "user",
      "content": "Implement a retry helper in TypeScript."
    }
  ],
  "stream": true,
  "gateway": {
    "routing": "smart",
    "priority": "quality",
    "cost_quality_tradeoff": 3,
    "required_capabilities": ["tools"],
    "min_context_tokens": 128000,
    "allowed_providers": ["deepseek", "qwen", "openai"],
    "blocked_regions": ["cn"],
    "max_output_usd_per_million_tokens": 10
  }
}
```

The optional `gateway` field is a gateway-specific extension. It is ignored before forwarding to direct providers. For gateway providers with documented request-body routing controls, Hasna Gateway maps only supported fields:

- OpenRouter: `provider.order`, `only`, `ignore`, `sort`, `max_price`, `allow_fallbacks`, `zdr`, `data_collection`, and Auto Router plugin options such as `allowed_models` and `cost_quality_tradeoff`.
- Vercel AI Gateway: `providerOptions.gateway.order`, `only`, `caching`, and `providerTimeouts`.

Unsupported gateway-only fields and secrets are stripped.

Smart routing fields include `task`, `priority`, `cost_quality_tradeoff`, `sticky_session_id`, `min_quality`, `min_context_tokens`, `expected_input_tokens`, `required_capabilities`, `provider_order`, `provider_only`, and `provider_ignore`. Policy is applied before scoring.

Successful non-streaming chat responses can use the optional process-local response cache. Streaming responses, embeddings, and errors are not cached. Sending a truthy value in the configured cache bypass header skips lookup.

## `POST /v1/embeddings`

Accepts OpenAI-compatible `model` and `input` fields. `input` may be a string, string array, token array, or array of token arrays. Optional forwarded fields are `encoding_format`, `dimensions`, and `user`. The gateway-only `gateway` field may narrow route policy but is stripped before provider forwarding.

Embedding route candidates must declare the `embeddings` capability. The gateway applies the same auth, policy, budget, fallback, rate-limit, usage-ledger, and metadata rules as non-streaming chat requests. Route filtering checks the model capability only, never the provider adapter, so a candidate whose adapter cannot embed is selected rather than skipped and then fails the whole request with a non-retryable `400 provider_embeddings_unsupported`; remaining fallback candidates are not attempted. Only the OpenAI-compatible adapter implements embeddings today, so order embeddings routes so that every eligible candidate is served by that adapter. Dynamic `provider/model` passthrough ids get the `embeddings` capability synthesized for any provider and fail the same way. Streaming and response caching do not apply.

```json
{
  "model": "embeddings",
  "input": ["first document", "second document"],
  "encoding_format": "float"
}
```

The response preserves the provider's OpenAI-compatible `data` array, rewrites `model` to the configured gateway model id, normalizes usage to `prompt_tokens` and `total_tokens`, and includes `gateway` metadata when enabled.

## Response Shape

Non-streaming responses should match OpenAI chat completion shape:

```json
{
  "id": "chatcmpl_gateway_...",
  "object": "chat.completion",
  "created": 1781590000,
  "model": "deepseek/deepseek-chat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  },
  "gateway": {
    "provider": "deepseek",
    "provider_model": "deepseek-chat",
    "route_mode": "fallback",
    "attempts": 1,
    "estimated_cost_usd": 0.00012,
    "route_decision": {
      "requested_model": "coding",
      "selected": "deepseek/deepseek-chat",
      "scores": [
        {
          "provider": "deepseek",
          "model": "deepseek/deepseek-chat",
          "score": 0.82,
          "reason": "highest cost, quality, latency, and success weighted score among eligible models"
        }
      ]
    }
  }
}
```

The `gateway` response field is non-standard and should be configurable. Some clients may require strict OpenAI compatibility with no extra top-level fields.

## Error Shape

Errors should use OpenAI-compatible error envelopes:

```json
{
  "error": {
    "message": "No allowed provider can satisfy model alias 'coding' with blocked_regions=['cn'].",
    "type": "gateway_policy_error",
    "code": "no_route"
  }
}
```

Recommended error types:

- `gateway_auth_error`
- `gateway_config_error`
- `gateway_policy_error`
- `gateway_routing_error`
- `provider_auth_error`
- `provider_rate_limit`
- `provider_unavailable`
- `provider_bad_request`
- `provider_stream_error`

## Streaming

Streaming should use Server-Sent Events compatible with OpenAI clients:

```text
data: {"id":"...","object":"chat.completion.chunk","choices":[...]}

data: [DONE]
```

When providers expose final usage only at stream end, the gateway should emit usage in the final chunk when OpenAI-compatible clients can accept it, and always record it internally.
