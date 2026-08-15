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

  test("redacts plain text secret assignments and command options", () => {
    expect(
      redactProdDebugText(
        `password=hunter2 apiKey: "live-api-key" {"refresh_token":"refresh-secret"} code=oauth-secret state=csrf-secret client_secret=client-secret authorization_code=auth-code oauth_code=oauth-code auth=raw-auth access=raw-access --token cli-secret --grant 'support-secret' --code oauth-secret --state csrf-secret`,
      ),
    ).toBe(
      `password=[redacted] apiKey: "[redacted]" {"refresh_token":"[redacted]"} code=[redacted] state=[redacted] client_secret=[redacted] authorization_code=[redacted] oauth_code=[redacted] auth=[redacted] access=[redacted] --token [redacted] --grant '[redacted]' --code [redacted] --state [redacted]`,
    );
  });

  test("redacts URL fragments and key-like path secret segments", () => {
    expect(
      redactProdDebugText(
        "open https://app.example.com/callback#access_token=frag-secret&id_token=jwt-secret&state=csrf-secret",
      ),
    ).toBe(
      "open https://app.example.com/callback#access_token=%5Bredacted%5D&id_token=%5Bredacted%5D&state=%5Bredacted%5D",
    );

    expect(
      redactProdDebugText("open https://support.example.com/session/grant-secret/path?target=ok"),
    ).toBe(
      "open https://support.example.com/session/%5Bredacted%5D/path?target=ok",
    );

    expect(
      redactProdDebugText("open https://support.example.com/grant/opaqueSupportToken12345/session"),
    ).toBe(
      "open https://support.example.com/%5Bredacted%5D/%5Bredacted%5D/session",
    );

    expect(
      redactProdDebugText("open https://support.example.com/support-grant/opaqueSupportToken12345/session"),
    ).toBe(
      "open https://support.example.com/%5Bredacted%5D/%5Bredacted%5D/session",
    );

    expect(
      redactProdDebugText("open https://support.example.com/#/support-grant/opaqueSupportToken12345/session"),
    ).toBe(
      "open https://support.example.com/#/%5Bredacted%5D/%5Bredacted%5D/session",
    );
  });

  test("redacts secret-shaped URL values without rewriting ordinary routes", () => {
    expect(
      redactProdDebugText("open https://example.com/callback?next=sk-abcdefghijklmnopqrstuvwxyz"),
    ).toBe("open https://example.com/callback?next=%5Bredacted%5D");

    expect(
      redactProdDebugText("open https://example.com/callback?next=sk-abcdefghijklmnopqrstuvwxyz."),
    ).toBe("open https://example.com/callback?next=%5Bredacted%5D");

    expect(
      redactProdDebugText("open https://example.com/callback?token=secret-token&next=sk-abcdefghijklmnopqrstuvwxyz"),
    ).toBe("open https://example.com/callback?token=%5Bredacted%5D&next=%5Bredacted%5D");

    expect(redactProdDebugText("open https://example.com/#/state/list")).toBe(
      "open https://example.com/#/state/list",
    );

    expect(redactProdDebugText("open https://example.com/docs/code-review?target=ok")).toBe(
      "open https://example.com/docs/code-review?target=ok",
    );
  });

  test("redacts bearer assignments and reason text before plan output", () => {
    expect(
      redactProdDebugText("auth=Bearer abcdefghijklmnopqrstuvwxyz012345 --token Bearer abcdefghijklmnopqrstuvwxyz012345"),
    ).toBe("auth=[redacted] --token [redacted]");

    expect(
      redactProdDebugText(
        "bearer_token=Bearer abcdefghijklmnopqrstuvwxyz012345 bearer=Bearer abcdefghijklmnopqrstuvwxyz012345 bearerToken=opaqueBearerSecret12345",
      ),
    ).toBe("bearer_token=[redacted] bearer=[redacted] bearerToken=[redacted]");

    const plan = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1",
      supportUrl: "https://support.example.com/session?token=secret-token&next=sk-abcdefghijklmnopqrstuvwxyz.",
      supportGrantId: "support-grant-123",
      reason: "callback failed code=oauth-secret auth=Bearer abcdefghijklmnopqrstuvwxyz012345 bearerToken=opaqueBearerSecret12345",
    });
    const output = `${JSON.stringify(plan)}\n${formatProdDebugPlan(plan)}`;

    expect(output).not.toContain("oauth-secret");
    expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(output).not.toContain("opaqueBearerSecret12345");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(plan.reason).toBe("callback failed code=[redacted] auth=[redacted] bearerToken=[redacted]");
  });

  test("redacts reason before support URL template expansion", () => {
    process.env.TESTERS_SUPPORT_GRANT = "opaqueSupportToken12345";
    try {
      const plan = createProdDebugPlan(
        {
          target: "https://example.com/acme/projects/proj-1",
          reason: "callback failed code=oauth-secret auth=Bearer abcdefghijklmnopqrstuvwxyz012345",
        },
        {
          apps: {
            demo: {
              origins: ["https://example.com"],
              supportGrantRef: "$TESTERS_SUPPORT_GRANT",
              supportUrlTemplate:
                "https://support.example/grant/{supportGrant}/session?context={reasonEncoded}&plain={reason}&grant={supportGrant}",
            },
          },
        },
      );
      const output = `${JSON.stringify(plan)}\n${formatProdDebugPlan(plan)}`;

      expect(output).not.toContain("oauth-secret");
      expect(output).not.toContain("code%3Doauth-secret");
      expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
      expect(output).not.toContain("opaqueSupportToken12345");
      expect(plan.supportAccess.grantId).toBe("[configured]");
    } finally {
      delete process.env.TESTERS_SUPPORT_GRANT;
    }
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
    expect(plan.supportAccess.grantId).toBe("[redacted]");
    expect(JSON.stringify(plan)).not.toContain("support-grant-123");
    const supportCheck = plan.checks.find((check) => check.id === "support-browser-repro");
    expect(supportCheck?.status).toBe("blocked");
    expect(supportCheck?.reason).toContain("needs supportUrl/supportUrlRef/supportUrlTemplate or an app adapter");
  });

  test("redacts opaque target session identifiers while preserving UUID sessions", () => {
    const uuidTarget = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1?session=9a99fab1-d63a-44f3-8a4c-d63c53ae3971",
      includeBrowser: false,
    });
    expect(uuidTarget.target.sessionId).toBe("9a99fab1-d63a-44f3-8a4c-d63c53ae3971");

    const queryPlan = createProdDebugPlan({
      target: "https://example.com/acme/projects/proj-1?session=opaqueTargetSessionLambda12345",
      includeBrowser: false,
    });
    const queryOutput = `${JSON.stringify(queryPlan)}\n${formatProdDebugPlan(queryPlan)}`;
    expect(queryPlan.target.sessionId).toBe("[redacted]");
    expect(queryPlan.target.url).toContain("session=%5Bredacted%5D");
    expect(queryOutput).not.toContain("opaqueTargetSessionLambda12345");

    const pathPlan = createProdDebugPlan({
      target: "https://example.com/acme/sessions/opaqueTargetSessionMu12345",
      includeBrowser: false,
    });
    const pathOutput = `${JSON.stringify(pathPlan)}\n${formatProdDebugPlan(pathPlan)}`;
    expect(pathPlan.target.sessionId).toBe("[redacted]");
    expect(pathPlan.target.url).toContain("/sessions/%5Bredacted%5D");
    expect(pathOutput).not.toContain("opaqueTargetSessionMu12345");
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
