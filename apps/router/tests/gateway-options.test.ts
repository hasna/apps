import { describe, expect, test } from "bun:test";
import { buildOpenRouterGatewayHints, buildVercelGatewayHints } from "../src/gateways";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("gateway option shapes", () => {
  test("builds OpenRouter provider and Auto Router hints", () => {
    const hints = buildOpenRouterGatewayHints({
      model: "gateway-auto",
      messages: [{ role: "user", content: "Summarize this." }],
      gateway: {
        provider_order: ["anthropic", "openai"],
        provider_only: ["anthropic", "openai"],
        allow_fallbacks: false,
        zero_data_retention_required: true,
        allow_logging: false,
        cost_quality_tradeoff: 3,
      },
      provider_options: {
        openrouter: {
          allowed_models: ["anthropic/*", "openai/gpt-5*"],
        },
      },
      session_id: "s1",
    });
    expect(hints).toEqual({
      provider: {
        order: ["anthropic", "openai"],
        only: ["anthropic", "openai"],
        allow_fallbacks: false,
        zdr: true,
        data_collection: "deny",
      },
      plugins: [
        {
          id: "auto-router",
          allowed_models: ["anthropic/*", "openai/gpt-5*"],
          cost_quality_tradeoff: 3,
        },
      ],
      session_id: "s1",
    });
  });

  test("builds Vercel AI Gateway providerOptions hint shape", () => {
    const hints = buildVercelGatewayHints({
      messages: [{ role: "user", content: "Hi" }],
      gateway: {
        provider_order: ["bedrock", "anthropic"],
        provider_only: ["bedrock", "anthropic"],
        caching: "auto",
        provider_timeouts: { anthropic: 1000 },
      },
    });
    expect(hints).toEqual({
      providerOptions: {
        gateway: {
          order: ["bedrock", "anthropic"],
          only: ["bedrock", "anthropic"],
          caching: "auto",
          providerTimeouts: { anthropic: 1000 },
        },
      },
    });
  });

  test("returns selected gateway hints in route decision", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "gateway-auto",
        messages: [{ role: "user", content: "Do hard reasoning." }],
        gateway: {
          provider_order: ["anthropic", "openai"],
          allow_logging: true,
          cost_quality_tradeoff: 4,
        },
      },
    });
    expect(decision.selectedId).toBe("openrouter/auto");
    expect(decision.gatewayHints).toEqual({
      provider: { order: ["anthropic", "openai"] },
      plugins: [{ id: "auto-router", cost_quality_tradeoff: 4 }],
    });
  });

  test("derives OpenRouter gateway hints from effective policy", () => {
    const config = testConfig();
    config.providers = config.providers.map((provider) =>
      provider.id === "openrouter"
        ? {
            ...provider,
            dataPolicy: {
              ...provider.dataPolicy,
              allowLogging: false,
              zeroDataRetentionAvailable: true,
            },
          }
        : provider,
    );
    config.routes = config.routes.map((route) =>
      route.id === "gateway-auto"
        ? {
            ...route,
            dataPolicy: {
              ...route.dataPolicy,
              allowLogging: false,
              zeroDataRetentionRequired: true,
            },
          }
        : route,
    );

    const decision = routePrompt({
      config,
      request: {
        model: "gateway-auto",
        messages: [{ role: "user", content: "Route this through OpenRouter." }],
        gateway: {
          data_collection: "allow",
          zdr: false,
          allow_logging: true,
        },
      },
    });

    expect(decision.selectedId).toBe("openrouter/auto");
    expect(decision.gatewayHints).toEqual({
      provider: {
        data_collection: "deny",
        zdr: true,
      },
    });
  });
});
