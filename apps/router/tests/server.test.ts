import { describe, expect, test } from "bun:test";
import { createRouterHandler } from "../src/server";
import { testConfig } from "./helpers";

describe("router service handler", () => {
  test("routes POST /v1/route", async () => {
    const handler = createRouterHandler({ config: testConfig() });
    const response = await handler(
      new Request("http://127.0.0.1/v1/route", {
        method: "POST",
        body: JSON.stringify({
          model: "auto",
          messages: [{ role: "user", content: "Implement a TypeScript parser." }],
          gateway: { priority: "quality" },
        }),
      }),
    );
    const body = (await response.json()) as { status: string; selectedId?: string };
    expect(response.status).toBe(200);
    expect(body.status).toBe("selected");
    expect(body.selectedId).toBe("openai/coding");
  });

  test("does not leak provider secrets or endpoint details", async () => {
    const handler = createRouterHandler({ config: testConfig() });
    const response = await handler(
      new Request("http://127.0.0.1/v1/route", {
        method: "POST",
        body: JSON.stringify({
          model: "auto",
          messages: [{ role: "user", content: "Implement a TypeScript parser." }],
          gateway: { priority: "quality" },
        }),
      }),
    );
    const text = await response.text();
    expect(text).not.toContain("OPENAI_API_KEY");
    expect(text).not.toContain("https://api.openai.test/v1");
    expect(text).not.toContain("baseUrl");
    expect(text).not.toContain("apiKeyEnv");
    expect(text).not.toContain("\"headers\"");
    expect(text).not.toContain("\"auth\"");
  });
});
