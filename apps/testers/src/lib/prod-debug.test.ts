import { describe, expect, test } from "bun:test";
import {
  createProdDebugPlan,
  formatProdDebugPlan,
  parseProdDebugTarget,
  redactProdDebugText,
} from "./prod-debug.js";

describe("prod-debug", () => {
  test("parses Alumia-style project URLs without exposing sensitive params", () => {
    const target = parseProdDebugTarget(
      "https://alumia.com/andrei/projects/prkps88yh4ky?agent=8510a9f7-9d91-41e7-ba0f-cecb17b9b929&code=oauth-secret&session=9a99fab1-d63a-44f3-8a4c-d63c53ae3971",
    );

    expect(target.origin).toBe("https://alumia.com");
    expect(target.orgSlug).toBe("andrei");
    expect(target.projectRef).toBe("prkps88yh4ky");
    expect(target.agentId).toBe("8510a9f7-9d91-41e7-ba0f-cecb17b9b929");
    expect(target.sessionId).toBe("9a99fab1-d63a-44f3-8a4c-d63c53ae3971");
    expect(target.url).toContain("code=%5Bredacted%5D");
    expect(target.url).toContain("agent=8510a9f7-9d91-41e7-ba0f-cecb17b9b929");
    expect(target.url).not.toContain("oauth-secret");
  });

  test("redacts bearer tokens and common key-like values", () => {
    expect(
      redactProdDebugText(
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345 and api_key sk-abcdefghijklmnopqrstuvwxyz",
      ),
    ).toBe("Authorization: Bearer [redacted] and api_key [redacted]");
  });

  test("redacts sensitive params inside embedded URLs", () => {
    expect(
      redactProdDebugText("open https://support.example.com/session?token=secret-token&grant=grant-secret now"),
    ).toBe("open https://support.example.com/session?token=%5Bredacted%5D&grant=%5Bredacted%5D now");
  });

  test("blocks user-scoped browser debugging without audited support access", () => {
    const plan = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1",
      reason: "customer reports connector auth error",
    });

    const supportCheck = plan.checks.find((check) => check.id === "support-browser-repro");
    expect(supportCheck?.status).toBe("blocked");
    expect(plan.blocked.join("\n")).toContain("No audited support browser/session grant");
    expect(formatProdDebugPlan(plan)).toContain("browser ready: no");
  });

  test("records support grants but waits for a support URL or adapter before running browser repro", () => {
    const plan = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1",
      supportGrantId: "support-grant-123",
      ttlMinutes: 90,
      actor: "octavia",
    });

    expect(plan.ttlMinutes).toBe(60);
    expect(plan.supportAccess.browserReady).toBe(false);
    expect(plan.supportAccess.grantId).toBe("support-grant-123");
    const supportCheck = plan.checks.find((check) => check.id === "support-browser-repro");
    expect(supportCheck?.status).toBe("blocked");
    expect(supportCheck?.reason).toContain("needs supportUrl/supportUrlRef/supportUrlTemplate or an app adapter");
  });

  test("redacts support URLs before embedding runnable browser commands", () => {
    const plan = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1",
      supportUrl: "https://support.example.com/session/start?token=secret-token&grant=support-grant-123",
      supportGrantId: "support-grant-123",
    });

    const supportCheck = plan.checks.find((check) => check.id === "support-browser-repro");
    expect(plan.supportAccess.browserReady).toBe(true);
    expect(supportCheck?.status).toBe("ready");
    expect(supportCheck?.command).toContain("token=%5Bredacted%5D");
    expect(supportCheck?.command).not.toContain("secret-token");
  });

  test("uses generic app profiles for support URLs, PII origins, and log commands", () => {
    process.env.TESTERS_SUPPORT_GRANT = "grant-secret-value";
    try {
      const plan = createProdDebugPlan(
        {
          target: "https://demo.example.com/acme/projects/proj-1?request_id=req_123",
          reason: "connector OAuth callback failed",
          includeLogs: true,
        },
        {
          apps: {
            demo: {
              name: "Demo App",
              origins: ["https://demo.example.com", "*.demo.example.org"],
              supportGrantRef: "$TESTERS_SUPPORT_GRANT",
              supportUrlTemplate:
                "https://support.demo.example.com/scoped/session?grant={supportGrant}&target={targetUrlEncoded}",
              piiOrigin: "https://api.demo.example.com",
              logCommand:
                "demo logs --project {project} --request {request} --url https://logs.demo.example.com/search?token=log-secret",
            },
          },
        },
      );

      expect(plan.app).toBe("Demo App");
      expect(plan.setup.profile).toBe("demo");
      expect(plan.setup.configured.supportGrant).toBe(true);
      expect(plan.setup.configured.supportUrl).toBe(true);
      expect(plan.supportAccess.grantId).toBe("[configured]");

      const piiCheck = plan.checks.find((check) => check.id === "pii-redaction-scan");
      expect(piiCheck?.command).toContain("https://api.demo.example.com");

      const supportCheck = plan.checks.find((check) => check.id === "support-browser-repro");
      expect(supportCheck?.status).toBe("ready");
      expect(supportCheck?.command).toContain("testers run");
      expect(supportCheck?.command).toContain("grant=%5Bredacted%5D");
      expect(supportCheck?.command).not.toContain("grant-secret-value");

      const logCheck = plan.checks.find((check) => check.id === "log-timeline");
      expect(logCheck?.status).toBe("ready");
      expect(logCheck?.command).toContain("demo logs --project proj-1 --request req_123");
      expect(logCheck?.command).toContain("token=%5Bredacted%5D");
      expect(logCheck?.command).not.toContain("log-secret");
    } finally {
      delete process.env.TESTERS_SUPPORT_GRANT;
    }
  });
});
