import { describe, expect, test } from "bun:test";
import { ROUTE_POLICIES, routePolicy } from "./route-policy.js";
import openApi from "../../../openapi/loops.json" with { type: "json" };

describe("route authorization inventory", () => {
  test.each(["poll", "claim"])("inventories runner %s", (action) => {
    expect(routePolicy("POST", `/v1/runners/${action}`)).toMatchObject({
      risk: "runner",
      scopes: ["loops:runner"],
      tokenKinds: ["machine", "service"],
    });
  });

  test("does not advertise non-durable runner registration or runner heartbeats", () => {
    expect(routePolicy("POST", "/v1/runners/register")).toBeUndefined();
    expect(routePolicy("POST", "/v1/runners/heartbeat")).toBeUndefined();
    expect((openApi.paths as Record<string, unknown>)["/v1/runners/register"]).toBeUndefined();
    expect((openApi.paths as Record<string, unknown>)["/v1/runners/heartbeat"]).toBeUndefined();
  });

  test("keeps machine and worker credentials out of generic CRUD", () => {
    const read = routePolicy("GET", "/v1/loops")!;
    const write = routePolicy("POST", "/v1/loops")!;
    expect(read.tokenKinds).not.toContain("machine");
    expect(read.roles).not.toContain("worker");
    expect(write.tokenKinds).not.toContain("machine");
    expect(write.roles).not.toContain("worker");
  });

  test("limits operator workflow recovery to write-scoped operator principals", () => {
    expect(routePolicy("POST", "/v1/workflow-runs/workflow-run-id/recover")).toMatchObject({
      operationId: "workflowRuns.recover",
      scopes: ["loops:write"],
      roles: ["admin", "operator", "service"],
      tokenKinds: ["api_key", "service"],
      risk: "write",
    });
    const policy = routePolicy("POST", "/v1/workflow-runs/workflow-run-id/recover")!;
    expect(policy.roles).not.toContain("member");
    expect(policy.roles).not.toContain("worker");
    expect(policy.tokenKinds).not.toContain("machine");
  });

  test("fails closed for unregistered methods and non-v1 routes", () => {
    expect(routePolicy("PUT", "/v1/loops/id")).toBeUndefined();
    expect(routePolicy("POST", "/v1/future-admin-action")).toBeUndefined();
    expect(routePolicy("DELETE", "/v1/workflows/id")).toBeUndefined();
    expect(routePolicy("GET", "/internal")).toBeUndefined();
    expect(new Set(ROUTE_POLICIES.map((policy) => policy.operationId)).size).toBe(ROUTE_POLICIES.length);
  });

  test("DELETE /v1/loops/{id} is a destructive admin-scoped route (loops.remove auth parity)", () => {
    const policy = routePolicy("DELETE", "/v1/loops/sample-id");
    expect(policy).toMatchObject({
      operationId: "loops.delete",
      pathTemplate: "/v1/loops/{id}",
      scopes: ["loops:delete"],
      roles: ["admin", "operator", "service"],
      tokenKinds: ["api_key", "service"],
      risk: "destructive",
    });
    expect(policy?.roles).not.toContain("member");
    expect(policy?.roles).not.toContain("readonly");
    expect(policy?.roles).not.toContain("worker");
    expect(policy?.tokenKinds).not.toContain("machine");
  });

  test("keeps the OpenAPI operation inventory and authorization metadata in parity", () => {
    const paths = openApi.paths as Record<string, Record<string, Record<string, unknown>>>;
    for (const policy of ROUTE_POLICIES) {
      const operation = paths[policy.pathTemplate]?.[policy.method.toLowerCase()];
      expect(operation, `${policy.method} ${policy.pathTemplate}`).toBeDefined();
      expect(operation?.["x-authorization-operation"]).toBe(policy.operationId);
      expect(operation?.["x-required-scopes"]).toEqual(policy.scopes);
      expect(operation?.["x-tenant-roles"]).toEqual(policy.roles);
      expect(operation?.["x-token-kinds"]).toEqual(policy.tokenKinds);
      expect(operation?.["x-risk"]).toBe(policy.risk);

      const samplePath = policy.pathTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => name === "action" ? "start" : "sample-id");
      expect(routePolicy(policy.method, samplePath)?.operationId).toBe(policy.operationId);
    }

    for (const path of ["/health", "/healthz", "/ready", "/readyz", "/version", "/v1/version", "/openapi.json"]) {
      expect(paths[path]?.get?.security).toEqual([]);
    }
  });
});
