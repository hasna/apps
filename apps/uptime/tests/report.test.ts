import { expect, test } from "bun:test";
import { parseHostedReportChannelRefs, summarizeHostedReportChannelRefs } from "../src/report-channel-refs.js";
import { buildUptimeReport, sendHostedUptimeReport, sendUptimeReport } from "../src/report.js";
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
        workspaceId: "local",
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

test("hosted report channel refs validate service-owned secret refs without raw destinations", () => {
  const catalog = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [
      {
        id: "ops-email",
        channel: "email",
        service: "mailery",
        secretRef: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting-email",
        targetRef: "workspace-ops",
        workspaceId: "wks_123",
      },
      {
        id: "ops-logs",
        channel: "logs",
        service: "logs",
        secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/logs",
        targetRef: "open-uptime-prod",
      },
    ],
  }));
  const summary = summarizeHostedReportChannelRefs(JSON.stringify(catalog));

  expect(catalog.channels.map((channel) => channel.id)).toEqual(["ops-email", "ops-logs"]);
  expect(summary).toMatchObject({
    configured: true,
    valid: true,
    total: 2,
    enabled: 2,
    enabledByChannel: { email: 1, sms: 0, logs: 1 },
  });
});

test("hosted report channel refs summarize workspace scope without exposing refs", () => {
  const secretRef = "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting-email";
  const summary = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [
      { id: "ops-email", channel: "email", service: "mailery", secretRef, workspaceId: "wks_a" },
      { id: "ops-disabled", channel: "email", service: "mailery", secretRef, workspaceId: "wks_b", enabled: false },
      { id: "ops-logs", channel: "logs", service: "logs", secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/logs" },
    ],
  }), { workspaceId: "wks_a" });

  expect(summary).toMatchObject({
    valid: true,
    enabled: 2,
    enabledForWorkspace: 1,
    enabledWithoutWorkspace: 1,
    enabledForOtherWorkspaces: 0,
  });
  expect(JSON.stringify(summary)).not.toContain(secretRef);
});

test("hosted report channel refs reject raw URLs, recipients, and token-shaped fields", () => {
  const rawUrl = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "bad",
      channel: "email",
      service: "mailery",
      secretRef: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting",
      apiUrl: "https://mailery.example",
    }],
  }));
  const rawRecipient = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "bad2",
      channel: "sms",
      service: "telephony",
      secretRef: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting",
      to: "+15550101010",
    }],
  }));
  const topLevelToken = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    apiToken: "esk_test",
    channels: [],
  }));

  expect(rawUrl.valid).toBe(false);
  expect(rawUrl.errors.join("\n")).toContain("must not contain raw URLs");
  expect(rawRecipient.valid).toBe(false);
  expect(rawRecipient.errors.join("\n")).toContain("must not contain raw URLs");
  expect(topLevelToken.valid).toBe(false);
  expect(topLevelToken.errors.join("\n")).toContain("must not contain raw URLs");
});

test("hosted report channel refs reject invalid secret refs and phone-like refs", () => {
  const wrongSecretManagerResource = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "bad-secret",
      channel: "email",
      service: "mailery",
      secretRef: "arn:aws:secretsmanager:us-east-1:123456789012:parameter/open-uptime/prod/reporting",
    }],
  }));
  const wrongSsmResource = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "bad-ssm",
      channel: "logs",
      service: "logs",
      secretRef: "arn:aws:ssm:us-east-1:123456789012:secret:open-uptime/prod/reporting",
    }],
  }));
  const phoneRef = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "15550101010",
      channel: "sms",
      service: "telephony",
      secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/sms",
    }],
  }));
  const phoneTargetRef = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "ops-sms",
      channel: "sms",
      service: "telephony",
      secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/sms",
      targetRef: "15550101010",
    }],
  }));
  const dashedPhoneTargetRef = summarizeHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{
      id: "ops-sms",
      channel: "sms",
      service: "telephony",
      secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/sms",
      targetRef: "155-501-01010",
    }],
  }));

  expect(wrongSecretManagerResource.valid).toBe(false);
  expect(wrongSecretManagerResource.errors.join("\n")).toContain("secretRef must be an AWS Secrets Manager or SSM Parameter ARN");
  expect(wrongSsmResource.valid).toBe(false);
  expect(wrongSsmResource.errors.join("\n")).toContain("secretRef must be an AWS Secrets Manager or SSM Parameter ARN");
  expect(phoneRef.valid).toBe(false);
  expect(phoneRef.errors.join("\n")).toContain("must not look like a raw phone number");
  expect(phoneTargetRef.valid).toBe(false);
  expect(phoneTargetRef.errors.join("\n")).toContain("must not look like a raw phone number");
  expect(dashedPhoneTargetRef.valid).toBe(false);
  expect(dashedPhoneTargetRef.errors.join("\n")).toContain("must not look like a raw phone number");
});

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
  expect(calls[2].body._open_logs_event_id).toBe("open-uptime:report:2026-06-28T12:00:00.000Z");
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
      apiUrl: "http://logs.test",
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

test("sendUptimeReport rejects integration API URLs with embedded credentials", async () => {
  let calls = 0;
  const deliveries = await sendUptimeReport(summary(), {
    logs: {
      apiUrl: "http://user:pass@logs.test",
      apiKey: "logs_secret",
      projectId: "uptime",
    },
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}");
    }) as unknown as typeof fetch,
  });

  expect(calls).toBe(0);
  expect(deliveries).toEqual([
    { channel: "logs", ok: false, error: "Integration API URL must not include username or password" },
  ]);
});

test("sendUptimeReport rejects integration API URLs with secret query parameters", async () => {
  let calls = 0;
  const secretUrls = [
    "http://logs.test/ingest?api_key=secret",
    "http://logs.test/ingest?key=secret",
    "http://logs.test/ingest?signature=secret",
    "http://logs.test/ingest?jwt=secret",
    "http://logs.test/ingest?code=secret",
  ];

  for (const apiUrl of secretUrls) {
    const deliveries = await sendUptimeReport(summary(), {
      logs: {
        apiUrl,
        apiKey: "logs_secret",
        projectId: "uptime",
      },
      fetchImpl: (async () => {
        calls += 1;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });

    expect(deliveries).toEqual([
      { channel: "logs", ok: false, error: "Integration API URL must not include secret query parameters" },
    ]);
  }
  expect(calls).toBe(0);
});

test("sendUptimeReport redacts provider-echoed secret query parameters", async () => {
  const deliveries = await sendUptimeReport(summary(), {
    logs: {
      apiUrl: "http://logs.test",
      apiKey: "logs_secret",
      projectId: "uptime",
    },
    fetchImpl: (async () => new Response(JSON.stringify({
      error: "failed at https://logs.test/ingest?token=raw-token&ok=1&signature=raw-sig&jwt=raw-jwt with key=raw-key code=raw-code and Bearer abc123",
    }), { status: 401 })) as unknown as typeof fetch,
  });

  expect(deliveries[0].ok).toBe(false);
  expect(deliveries[0].error).toBe("failed at https://logs.test/ingest?token=[REDACTED]&ok=1&signature=[REDACTED]&jwt=[REDACTED] with key=[REDACTED] code=[REDACTED] and Bearer [REDACTED]");
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

test("sendUptimeReport reads Open Logs structured ingest event ids", async () => {
  const deliveries = await sendUptimeReport(summary(), {
    logs: {
      apiUrl: "http://logs.test",
      apiKey: "logs_secret",
      projectId: "uptime",
    },
    fetchImpl: (async () => new Response(JSON.stringify({
      events: [{ id: "evt_123" }],
    }), { status: 201 })) as unknown as typeof fetch,
  });

  expect(deliveries).toEqual([
    { channel: "logs", ok: true, status: 201, id: "evt_123" },
  ]);
});

test("sendHostedUptimeReport resolves workspace channel refs through server-owned secrets", async () => {
  const secretRef = (name: string) => `arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting/${name}`;
  const catalog = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [
      { id: "ops-email", channel: "email", service: "mailery", secretRef: secretRef("email"), targetRef: "ops-team", workspaceId: "wks_hosted" },
      { id: "ops-sms", channel: "sms", service: "telephony", secretRef: secretRef("sms"), targetRef: "ops-phone", workspaceId: "wks_hosted" },
      { id: "ops-logs", channel: "logs", service: "logs", secretRef: secretRef("logs"), targetRef: "ops-log-stream", workspaceId: "wks_hosted" },
    ],
  }));
  const secrets = new Map<string, Record<string, unknown>>([
    [secretRef("email"), {
      version: "open-uptime.report-channel-secret.v1",
      service: "mailery",
      targetRef: "ops-team",
      apiUrl: "http://mailery.hosted",
      sendKey: "esk_hosted_secret",
      from: "ops@example.com",
      to: ["team@example.com"],
      providerId: "ses-prod",
    }],
    [secretRef("sms"), {
      version: "open-uptime.report-channel-secret.v1",
      service: "telephony",
      targetRef: "ops-phone",
      apiUrl: "http://telephony.hosted",
      apiKey: "telephony_secret",
      from: "+15550000000",
      to: ["+15550000001"],
    }],
    [secretRef("logs"), {
      version: "open-uptime.report-channel-secret.v1",
      service: "logs",
      targetRef: "ops-log-stream",
      apiUrl: "http://logs.hosted",
      apiKey: "logs_hosted_secret",
      projectId: "open-uptime-prod",
      environment: "prod",
      serviceName: "open-uptime",
    }],
  ]);
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ id: `ok_${calls.length}`, message_id: `msg_${calls.length}` }), { status: 202 });
  };

  const deliveries = await sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog,
    channelRefIds: ["ops-email", "ops-sms", "ops-logs"],
    loadSecret: (ref) => secrets.get(ref) ?? "{}",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  expect(deliveries.map((delivery) => delivery.ok)).toEqual([true, true, true]);
  expect(deliveries.every((delivery) => delivery.redacted)).toBe(true);
  expect(deliveries.map((delivery) => delivery.channelRefId)).toEqual(["ops-email", "ops-sms", "ops-logs"]);
  expect(deliveries.map((delivery) => delivery.provider)).toEqual(["mailery", "telephony", "logs"]);
  expect(deliveries.every((delivery) => delivery.requestHash?.match(/^[a-f0-9]{64}$/))).toBe(true);
  expect(calls.map((call) => call.url)).toEqual([
    "http://mailery.hosted/api/v1/send",
    "http://telephony.hosted/api/sms/send",
    "http://logs.hosted/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=open-uptime-prod&environment=prod",
  ]);
  expect(calls[0].init.headers).toHaveProperty("authorization", "Bearer esk_hosted_secret");
  expect(calls[1].init.headers).toHaveProperty("authorization", "Bearer telephony_secret");
  expect(calls[2].init.headers).toHaveProperty("authorization", "Bearer logs_hosted_secret");
  expect(calls[0].body.provider_id).toBe("ses-prod");
  expect(calls[0].body.to).toEqual(["team@example.com"]);
  expect(calls[1].body.to).toBe("+15550000001");
  expect(calls[2].body.message).toContain("Open Uptime alert");
  expect(calls[0].body.text).not.toContain("https://example.com/health");
  expect(calls[0].body.text).toContain("[REDACTED_TARGET]");
  expect(JSON.stringify(calls[2].body.report)).not.toContain("https://example.com/health");
  expect(JSON.stringify(calls[2].body.report)).toContain("open-uptime.hosted-report-redaction.v1");
  const serialized = JSON.stringify(deliveries);
  expect(serialized).not.toContain("esk_hosted_secret");
  expect(serialized).not.toContain("telephony_secret");
  expect(serialized).not.toContain("logs_hosted_secret");
  expect(serialized).not.toContain("team@example.com");
  expect(serialized).not.toContain("+15550000001");
});

test("sendHostedUptimeReport fails closed for unscoped refs and mismatched secret payloads", async () => {
  const secretRef = "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting/email";
  const unscoped = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{ id: "ops-email", channel: "email", service: "mailery", secretRef }],
  }));
  await expect(sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog: unscoped,
    channelRefIds: ["ops-email"],
    loadSecret: () => ({}),
  })).rejects.toThrow("requires every enabled channel ref to be scoped");

  const scoped = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{ id: "ops-email", channel: "email", service: "mailery", secretRef, workspaceId: "wks_hosted" }],
  }));
  const deliveries = await sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog: scoped,
    channelRefIds: ["ops-email"],
    loadSecret: () => JSON.stringify({
      version: "open-uptime.report-channel-secret.v1",
      service: "logs",
      apiKey: "logs_secret",
    }),
    fetchImpl: (async () => {
      throw new Error("network should not be called");
    }) as unknown as typeof fetch,
  });

  expect(deliveries).toEqual([{
    channel: "email",
    ok: false,
    error: "hosted report channel secret payload service must match the channel ref",
    channelRefId: "ops-email",
    provider: "mailery",
    targetRef: null,
    targetRefHash: null,
    requestHash: null,
    redacted: true,
  }]);
  expect(JSON.stringify(deliveries)).not.toContain("logs_secret");
});

test("sendHostedUptimeReport sends only selected refs and redacts provider echoes", async () => {
  const emailRef = "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting/email";
  const logsRef = "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/logs";
  const catalog = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [
      { id: "ops-email", channel: "email", service: "mailery", secretRef: emailRef, targetRef: "ops-team", workspaceId: "wks_hosted" },
      { id: "ops-logs", channel: "logs", service: "logs", secretRef: logsRef, targetRef: "ops-log-stream", workspaceId: "wks_hosted" },
    ],
  }));
  const calls: string[] = [];
  const deliveries = await sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog,
    channelRefIds: ["ops-email"],
    loadSecret: () => ({
      version: "open-uptime.report-channel-secret.v1",
      service: "mailery",
      targetRef: "ops-team",
      apiUrl: "http://mailery.hosted",
      sendKey: "esk_hosted_secret",
      from: "ops@example.com",
      to: ["team@example.com"],
    }),
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        id: "team@example.com +15550000001 ops-team esk_hosted_secret",
      }), { status: 202 });
    }) as unknown as typeof fetch,
  });

  expect(calls).toEqual(["http://mailery.hosted/api/v1/send"]);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].id).toBe("[REDACTED] [REDACTED_PHONE] [REDACTED] [REDACTED]");
  expect(JSON.stringify(deliveries)).not.toContain("team@example.com");
  expect(JSON.stringify(deliveries)).not.toContain("+15550000001");
  expect(JSON.stringify(deliveries)).not.toContain("ops-team");
  await expect(sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog,
    channelRefIds: [],
    loadSecret: () => ({}),
  })).rejects.toThrow("requires explicit selected channel ref ids");
});

test("sendHostedUptimeReport redacts secret loader failures", async () => {
  const secretRef = "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting/email";
  const catalog = parseHostedReportChannelRefs(JSON.stringify({
    version: "open-uptime.report-channel-refs.v1",
    channels: [{ id: "ops-email", channel: "email", service: "mailery", secretRef, targetRef: "ops-team", workspaceId: "wks_hosted" }],
  }));

  const deliveries = await sendHostedUptimeReport(summary(), {
    workspaceId: "wks_hosted",
    catalog,
    channelRefIds: ["ops-email"],
    loadSecret: () => {
      throw new Error(`failed ${secretRef} with Bearer abc123 and ops@example.com`);
    },
  });

  expect(deliveries[0].ok).toBe(false);
  expect(deliveries[0].error).toBe("failed [REDACTED] with Bearer [REDACTED] and [REDACTED_EMAIL]");
  expect(JSON.stringify(deliveries)).not.toContain(secretRef);
  expect(JSON.stringify(deliveries)).not.toContain("abc123");
  expect(JSON.stringify(deliveries)).not.toContain("ops@example.com");
});
