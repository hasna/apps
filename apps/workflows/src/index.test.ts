import { describe, expect, test } from "bun:test";
import { createRequestHandler } from "./handlers.js";
import { createWorkflowsService, packageVersion, resolveWorkflowsConfig } from "./index.js";
import { workflowsTools } from "./index.js";

describe("workflows sdk surface (src/index.ts)", () => {
  test("exports the service factory and config resolver", () => {
    const svc = createWorkflowsService();
    expect(svc.name).toBe("workflows");
    expect(svc.health().ok).toBe(true);
    expect(resolveWorkflowsConfig().port).toBe(8790);
  });

  test("exports the request handler (serve surface)", async () => {
    const handler = createRequestHandler(createWorkflowsService());
    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
  });

  test("exports the MCP tool registry (agent surface)", () => {
    const tools = workflowsTools(createWorkflowsService());
    const names = tools.map((t) => t.name);
    expect(names).toContain("workflows_version");
    expect(names).toContain("workflows_health");
    expect(names).toContain("workflows_ready");
  });

  test("packageVersion is stable across surfaces", () => {
    expect(packageVersion()).toBe(createWorkflowsService().version);
  });
});
