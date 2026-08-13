# Provider References

Docs rechecked on 2026-06-23.

## OpenRouter

- Provider routing: https://openrouter.ai/docs/guides/routing/provider-selection
- Auto Router: https://openrouter.ai/docs/guides/routing/routers/auto-router
- Relevant request controls: `provider.order`, `allow_fallbacks`, `only`,
  `ignore`, `sort`, `max_price`, `zdr`, `data_collection`, performance
  preferences, and Auto Router plugin fields `allowed_models` and
  `cost_quality_tradeoff`.

## Vercel AI Gateway

- Provider options:
  https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
- Relevant request shape: `providerOptions.gateway` with `order`, `only`,
  `caching`, and `providerTimeouts`.

## LiteLLM

- Router: https://docs.litellm.ai/docs/routing
- Proxy load balancing: https://docs.litellm.ai/docs/proxy/load_balancing
- Auto routing: https://docs.litellm.ai/docs/proxy/auto_routing
- LiteLLM owns its internal deployment routing. `open-router` treats LiteLLM
  Proxy as one upstream candidate unless config lists more local candidates.

## Portkey

- Configs: https://portkey.ai/docs/product/ai-gateway/configs
- Load balancing: https://portkey.ai/docs/product/ai-gateway/load-balancing
- Portkey supports weighted and sticky load balancing through gateway configs.
  `open-router` represents Portkey as a normal OpenAI-compatible upstream with
  config/header metadata.

## Cloudflare AI Gateway

- REST API: https://developers.cloudflare.com/ai-gateway/usage/rest-api/
- OpenAI-compatible path: `/ai/v1/chat/completions`.
- A specific gateway can be selected with `cf-aig-gateway-id`; `cf-aig-*`
  headers control cache/log/retry behavior.

## Kong AI Gateway

- Overview: https://developer.konghq.com/ai-gateway/
- Load balancing:
  https://developer.konghq.com/ai-gateway/load-balancing/
- Kong supports weighted round-robin, consistent hashing, least connections,
  usage, latency, semantic, and priority routing. `open-router` treats Kong as
  one upstream candidate unless config exposes individual models separately.

## Smart Routing References

- RouteLLM: https://github.com/lm-sys/RouteLLM
- Not Diamond model routing:
  https://docs.notdiamond.ai/docs/what-is-model-routing
- Microsoft Foundry Model Router:
  https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router

These references support the local design choices: route only among eligible
models, expose cost/quality/latency modes, allow model subsets, use sticky
session behavior for conversation consistency, and keep routing decisions
auditable.
