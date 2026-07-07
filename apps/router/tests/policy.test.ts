import { describe, expect, test } from "bun:test";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("policy filtering", () => {
  test("skips Chinese providers unless policy allows them", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "coding",
        messages: [{ role: "user", content: "Implement a parser." }],
      },
    });
    expect(decision.selectedId).toBe("openai/coding");
    expect(decision.skipped[0]?.reason).toContain("china provider");
  });

  test("allows Chinese providers when route opts in", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "china-coding",
        messages: [{ role: "user", content: "Implement a parser." }],
      },
    });
    expect(decision.selectedId).toBe("deepseek/coder");
  });

  test("request policy cannot expand operator policy by default", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "deepseek/coder",
        messages: [{ role: "user", content: "Implement a parser." }],
        gateway: {
          allow_chinese_providers: true,
          allow_logging: true,
          allowed_regions: ["cn"],
        },
      },
    });
    expect(decision.status).toBe("no_route");
    expect(decision.skipped[0]?.reason).toContain("china provider");
  });

  test("empty provider allowlist intersection fails closed", () => {
    const config = testConfig();
    config.policy.allowedProviders = ["openai"];
    const decision = routePrompt({
      config,
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Hello." }],
        gateway: {
          provider_ignore: ["openai"],
        },
      },
    });
    expect(decision.status).toBe("no_route");
    expect(decision.policy.allowedProviders).toEqual([]);
    expect(decision.skipped.every((skip) => skip.reason === "provider is not in allowed_providers")).toBe(true);
  });

  test("empty region allowlist intersection fails closed", () => {
    const config = testConfig();
    config.policy.allowedRegions = ["us"];
    const decision = routePrompt({
      config,
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Hello." }],
        gateway: {
          allowed_regions: ["eu"],
        },
      },
    });
    expect(decision.status).toBe("no_route");
    expect(decision.policy.allowedRegions).toEqual([]);
    expect(decision.skipped.some((skip) => skip.reason === "provider region is not allowed")).toBe(true);
  });
});
