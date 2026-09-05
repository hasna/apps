import { describe, expect, test } from "bun:test";
import { emailsSelfHostedOpenApi } from "../server/self-hosted/openapi.js";
import { RESOURCE_PATHS, ROUTES } from "./routes.js";

describe("HTTP priority sender rule routes", () => {
  test("keeps immutable priority rules off the PATCH surface", () => {
    expect(
      ROUTES.some(
        (route) => route.method === "PATCH" && route.template === "/v1/priority-sender-rules/{id}",
      ),
    ).toBe(false);
    const priorityPath = emailsSelfHostedOpenApi.paths!["/v1/priority-sender-rules/{id}"] as
      | Record<string, unknown>
      | undefined;
    expect(priorityPath?.patch).toBeUndefined();
  });
});

describe("HTTP source inventory routes", () => {
  test("advertises only the existing authenticated collection GET, not source management", () => {
    expect(ROUTES.filter(route => route.template.startsWith("/v1/sources"))).toEqual([
      { method: "GET", template: "/v1/sources", operations: ["sourceInventory.list"] },
    ]);
    expect(Object.values(RESOURCE_PATHS).includes("sources")).toBe(false);
    const document = emailsSelfHostedOpenApi as {
      paths?: Record<string, { get?: { operationId?: string; security?: unknown } }>;
      security?: unknown;
    };
    expect(document.paths?.["/v1/sources"]?.get?.operationId).toBe("listResourceSources");
    expect(document.paths?.["/v1/sources"]?.get?.security ?? document.security).toEqual([{ apiKeyAuth: [] }, { bearerAuth: [] }]);
  });
});
