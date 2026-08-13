import { describe, expect, test } from "bun:test";
import { toOpenGatewayRouteDecision } from "../src/open-gateway";
import { routePrompt } from "../src/router";
import type { RouterCandidate } from "../src/types";
import { testConfig } from "./helpers";

describe("open-gateway contract compatibility", () => {
  test("accepts gateway-shaped candidates and emits snake_case decision metadata", () => {
    const config = testConfig();
    const candidates: RouterCandidate[] = [
      {
        provider: config.providers[1]!,
        model: config.models[2]!,
      },
      {
        provider: config.providers[0]!,
        model: config.models[1]!,
      },
    ];

    const decision = routePrompt({
      config,
      candidates,
      request: {
        model: "coding",
        messages: [{ role: "user", content: "Implement a parser." }],
      },
    });

    const gatewayDecision = toOpenGatewayRouteDecision(decision);
    expect(gatewayDecision.requested_model).toBe("coding");
    expect(gatewayDecision.resolved_candidates).toEqual(["deepseek/coder", "openai/coding"]);
    expect(gatewayDecision.selected).toBe("openai/coding");
    expect(gatewayDecision.policy.allow_training).toBe(false);
    expect(gatewayDecision.policy.allow_chinese_providers).toBe(false);
    expect(gatewayDecision.attempts[0]).toEqual({
      provider: "deepseek",
      model: "deepseek/coder",
      providerModel: "coder",
      status: "skipped",
      reason: "china provider requires allow_chinese_providers or allowed_regions including cn",
    });
    expect(gatewayDecision.scores?.[0]?.providerModel).toBe("coding");
  });
});
