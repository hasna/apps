import { expect, test } from "bun:test";
import { buildUptimeReport, sendUptimeReport } from "../src/report.js";
import type { UptimeSummary } from "../src/types.js";

function summary(): UptimeSummary {
  return {
    generatedAt: "2026-06-28T12:00:00.000Z",
    totals: {
      monitors: 1,
      enabled: 1,
      up: 0,
      down: 1,
      paused: 0,
      unknown: 0,
      openIncidents: 1,
    },
    monitors: [{
      monitor: {
        id: "mon_1",
        name: "api",
        kind: "http",
        url: "https://example.com/health",
        host: null,
        port: null,
        method: "GET",
        expectedStatus: null,
        intervalSeconds: 60,
        timeoutMs: 5000,
        retryCount: 0,
        enabled: true,
        status: "down",
        lastCheckedAt: "2026-06-28T11:59:00.000Z",
        revision: 1,
        createdAt: "2026-06-28T11:00:00.000Z",
        updatedAt: "2026-06-28T11:59:00.000Z",
      },
      totalChecks: 1,
      upChecks: 0,
      downChecks: 1,
      uptimePercent: 0,
      averageLatencyMs: null,
      openIncident: {
        id: "inc_1",
        monitorId: "mon_1",
        status: "open",
        openedAt: "2026-06-28T11:59:00.000Z",
        closedAt: null,
        lastFailureAt: "2026-06-28T11:59:00.000Z",
        failureCount: 1,
        recoveryCheckId: null,
        reason: "unexpected status 500",
      },
    }],
  };
}

test("buildUptimeReport renders text, HTML, and structured JSON", () => {
  const report = buildUptimeReport(summary());

  expect(report.subject).toContain("1 down");
  expect(report.text).toContain("api");
  expect(report.text).toContain("unexpected status 500");
  expect(report.html).toContain("<pre>");
  expect(report.json.kind).toBe("open-uptime.report");
});

test("sendUptimeReport calls Mailery, Telephony, and Open Logs APIs", async () => {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ id: `ok_${calls.length}`, message_id: `msg_${calls.length}` }), { status: 201 });
  };

  const deliveries = await sendUptimeReport(summary(), {
    email: {
      apiUrl: "http://mailery.test",
      sendKey: "esk_test",
      from: "ops@example.com",
      to: ["team@example.com"],
    },
    sms: {
      apiUrl: "http://telephony.test",
      to: ["+15550000001"],
    },
    logs: {
      apiUrl: "http://logs.test",
      apiKey: "logs_secret",
      projectId: "uptime",
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  expect(deliveries.map((delivery) => delivery.ok)).toEqual([true, true, true]);
  expect(calls.map((call) => call.url)).toEqual([
    "http://mailery.test/api/v1/send",
    "http://telephony.test/api/sms/send",
    "http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test",
  ]);
  expect(calls[0].init.headers).toHaveProperty("authorization", "Bearer esk_test");
  expect(calls[0].body.to).toEqual(["team@example.com"]);
  expect(calls[1].body.to).toBe("+15550000001");
  expect(calls[2].body.report.kind).toBe("open-uptime.report");
});

test("sendUptimeReport reports missing channel configuration without network calls", async () => {
  let calls = 0;
  const deliveries = await sendUptimeReport(summary(), {
    email: true,
    sms: true,
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}");
    }) as unknown as typeof fetch,
  });

  expect(calls).toBe(0);
  expect(deliveries).toEqual([
    { channel: "email", ok: false, error: "Mailery send key is required" },
    { channel: "sms", ok: false, error: "SMS recipient phone number is required" },
  ]);
});

test("sendUptimeReport redacts configured secrets echoed by providers", async () => {
  const deliveries = await sendUptimeReport(summary(), {
    logs: {
      apiUrl: "http://user:pass@logs.test",
      apiKey: "logs_secret",
      projectId: "uptime",
    },
    fetchImpl: (async () => new Response(JSON.stringify({
      error: "invalid api key logs_secret at http://user:pass@logs.test with Bearer abc123",
    }), { status: 401 })) as unknown as typeof fetch,
  });

  expect(deliveries[0].ok).toBe(false);
  expect(deliveries[0].error).toBe("invalid api key [REDACTED] at http://[REDACTED]:[REDACTED]@logs.test with Bearer [REDACTED]");
});

test("sendUptimeReport reads Open Logs API token env names and redacts success ids", async () => {
  const previous = process.env.HASNA_LOGS_API_TOKEN;
  process.env.HASNA_LOGS_API_TOKEN = "logs_token_secret";
  try {
    let authorization: string | undefined;
    const deliveries = await sendUptimeReport(summary(), {
      logs: { apiUrl: "http://logs.test", projectId: "uptime" },
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
        return new Response(JSON.stringify({ id: "logs_token_secret" }), { status: 201 });
      }) as unknown as typeof fetch,
    });

    expect(authorization).toBe("Bearer logs_token_secret");
    expect(deliveries[0].id).toBe("[REDACTED]");
  } finally {
    if (previous === undefined) delete process.env.HASNA_LOGS_API_TOKEN;
    else process.env.HASNA_LOGS_API_TOKEN = previous;
  }
});
