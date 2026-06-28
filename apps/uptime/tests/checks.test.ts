import { expect, test } from "bun:test";
import net from "node:net";
import { runBrowserPageCheck, runHostedHttpCheck, runHttpCheck, runMonitorCheck, runTcpCheck } from "../src/checks.js";
import type { BrowserPageEvidence, CheckAttemptResult, Monitor } from "../src/types.js";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "mon_test",
    workspaceId: "local",
    name: "test",
    kind: "http",
    url: "https://example.com",
    host: null,
    port: null,
    method: "GET",
    expectedStatus: null,
    intervalSeconds: 60,
    timeoutMs: 5000,
    retryCount: 0,
    enabled: true,
    status: "unknown",
    lastCheckedAt: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expectBrowserEvidence(result: CheckAttemptResult): BrowserPageEvidence {
  if (result.evidence?.kind !== "browser_page") throw new Error("expected browser page evidence");
  return result.evidence;
}

test("HTTP check accepts 2xx and 3xx by default", async () => {
  const result = await runHttpCheck(monitor(), async () => ({ status: 302 }));
  expect(result.status).toBe("up");
  expect(result.statusCode).toBe(302);
  expect(result.error).toBeNull();
});

test("HTTP check enforces exact expected status when configured", async () => {
  const result = await runHttpCheck(monitor({ expectedStatus: 204 }), async () => ({ status: 200 }));
  expect(result.status).toBe("down");
  expect(result.statusCode).toBe(200);
  expect(result.error).toBe("unexpected status 200");
});

test("hosted HTTP check resolves and pins the allowed address used for the request", async () => {
  const pinnedAddresses: string[] = [];
  const result = await runHostedHttpCheck(monitor({
    url: "https://example.com/status",
    expectedStatus: 204,
  }), {
    resolveHost: async (hostname) => {
      expect(hostname).toBe("example.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    request: async (context) => {
      pinnedAddresses.push(context.address.address);
      expect(context.url.hostname).toBe("example.com");
      expect(context.address.family).toBe(4);
      return { status: 204 };
    },
  });

  expect(result.status).toBe("up");
  expect(result.statusCode).toBe(204);
  expect(pinnedAddresses).toEqual(["93.184.216.34"]);
  expect(result.evidence?.kind).toBe("http_target_policy");
  if (result.evidence?.kind !== "http_target_policy") throw new Error("expected HTTP target-policy evidence");
  expect(result.evidence.decisions[0]).toMatchObject({
    decision: "allowed",
    host: "example.com",
    targetClass: "public_http",
    probeClass: "public",
    resolvedAddresses: [{ address: "93.184.216.34", family: 4 }],
  });
});

test("hosted HTTP check rejects DNS answers to denied ranges before making a request", async () => {
  let requested = false;
  const result = await runHostedHttpCheck(monitor({
    url: "https://metadata-proxy.example/status",
  }), {
    resolveHost: async () => [{ address: "169.254.169.254", family: 4 }],
    request: async () => {
      requested = true;
      return { status: 200 };
    },
  });

  expect(requested).toBe(false);
  expect(result.status).toBe("down");
  expect(result.error).toContain("private or reserved IPv4");
  expect(result.evidence?.kind).toBe("http_target_policy");
  if (result.evidence?.kind !== "http_target_policy") throw new Error("expected HTTP target-policy evidence");
  expect(result.evidence.decisions[0].decision).toBe("blocked");
  expect(result.evidence.decisions[0].resolvedAddresses).toEqual([{ address: "169.254.169.254", family: 4 }]);
});

test("hosted HTTP check validates redirect targets and blocks redirect rebinding", async () => {
  const requestedHosts: string[] = [];
  const result = await runHostedHttpCheck(monitor({
    url: "https://example.com/start",
  }), {
    resolveHost: async (hostname) => hostname === "example.com"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "10.0.0.5", family: 4 }],
    request: async (context) => {
      requestedHosts.push(context.url.hostname);
      return { status: 302, headers: { location: "https://rebind.example/health" } };
    },
  });

  expect(requestedHosts).toEqual(["example.com"]);
  expect(result.status).toBe("down");
  expect(result.error).toContain("private or reserved IPv4");
  expect(result.evidence?.kind).toBe("http_target_policy");
  if (result.evidence?.kind !== "http_target_policy") throw new Error("expected HTTP target-policy evidence");
  expect(result.evidence.redirectCount).toBe(1);
  expect(result.evidence.decisions.map((decision) => decision.decision)).toEqual(["allowed", "blocked"]);
  expect(result.evidence.decisions[1].host).toBe("rebind.example");
});

test("hosted HTTP check rejects redirect targets resolving to IPv4-translated IPv6", async () => {
  const requestedHosts: string[] = [];
  const result = await runHostedHttpCheck(monitor({
    url: "https://example.com/start",
  }), {
    resolveHost: async (hostname) => hostname === "example.com"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "64:ff9b::a9fe:a9fe", family: 6 }],
    request: async (context) => {
      requestedHosts.push(context.url.hostname);
      return { status: 301, headers: { location: "https://nat64.example/metadata" } };
    },
  });

  expect(requestedHosts).toEqual(["example.com"]);
  expect(result.status).toBe("down");
  expect(result.error).toContain("private or reserved IPv6");
  expect(result.evidence?.kind).toBe("http_target_policy");
  if (result.evidence?.kind !== "http_target_policy") throw new Error("expected HTTP target-policy evidence");
  expect(result.evidence.decisions.map((decision) => decision.decision)).toEqual(["allowed", "blocked"]);
  expect(result.evidence.decisions[1]).toMatchObject({
    host: "nat64.example",
    targetClass: "public_http",
    probeClass: "public",
    resolvedAddresses: [{ address: "64:ff9b::a9fe:a9fe", family: 6 }],
  });
});

test("disabled monitors are not probed", async () => {
  let called = false;
  const result = await runMonitorCheck(monitor({ enabled: false }), {
    fetch: async () => {
      called = true;
      return { status: 200 };
    },
  });
  expect(called).toBe(false);
  expect(result.status).toBe("down");
  expect(result.error).toBe("monitor is disabled");
});

test("TCP check succeeds against a listening local server", async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const result = await runTcpCheck(monitor({
      kind: "tcp",
      url: null,
      host: "127.0.0.1",
      port: address.port,
    }));
    expect(result.status).toBe("up");
    expect(result.error).toBeNull();
  } finally {
    server.close();
  }
});

test("TCP check records connection failures", async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const result = await runTcpCheck(monitor({
    kind: "tcp",
    url: null,
    host: "127.0.0.1",
    port: address.port,
    timeoutMs: 50,
  }));

  expect(result.status).toBe("down");
  expect(result.error).toBeTruthy();
});

test("browser_page checks fail closed without an explicit browser runner", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }));

  expect(result.status).toBe("down");
  expect(result.error).toContain("browser runner");
  expect(result.evidence?.kind).toBe("browser_page");
  expect(result.evidence?.redacted).toBe(true);
});

test("browser_page checks capture only redacted evidence metadata", async () => {
  const result = await runMonitorCheck(monitor({
    kind: "browser_page",
    url: "https://example.com/app?api_key=secret",
  }), {
    browserPage: async () => ({
      finalUrl: "https://example.com/app?token=secret",
      navigationStatus: 200,
      consoleErrors: ["Bearer abc.def"],
      pageErrors: ["password=hunter2 at /Users/example/private/file"],
      failedRequests: [{ url: "https://example.com/api?access_token=secret", statusCode: 500, error: "secret=leaked" }],
      screenshot: {
        ref: "artifact://screenshots/one",
        sha256: "a".repeat(64),
        bytes: 42,
        contentType: "image/png",
      },
    }),
  });

  expect(result.status).toBe("down");
  expect(result.evidence).toMatchObject({
    finalUrl: "https://example.com/app?token=%5Bredacted%5D",
    redactionStatus: "redacted",
    retentionClass: "short",
  });
  const evidence = expectBrowserEvidence(result);
  expect(evidence.consoleErrors[0]).toBe("Bearer [redacted]");
  expect(evidence.pageErrors[0]).toBe("password=[redacted] at [local-path]");
  expect(evidence.failedRequests[0].url).toBe("https://example.com/api?access_token=%5Bredacted%5D");
  expect(evidence.failedRequests[0].error).toBe("secret=[redacted]");
  expect(evidence.screenshot?.retentionClass).toBe("short");
});

test("browser_page evidence redacts artifact content types", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => ({
      finalUrl: "https://example.com",
      navigationStatus: 200,
      screenshot: {
        ref: "artifact://screenshots/one",
        sha256: "a".repeat(64),
        bytes: 42,
        contentType: "image/png; token=secret /Users/example/private",
      },
      artifacts: [{
        ref: "artifact://trace/one",
        sha256: "b".repeat(64),
        bytes: 84,
        contentType: "application/json; Bearer abc /Users/hasna/private",
        retentionClass: "short",
      }],
    }),
  });

  const evidence = expectBrowserEvidence(result);
  expect(evidence.screenshot?.contentType).toBe("image/png; token=[redacted] [local-path]");
  expect(evidence.artifacts[0].contentType).toBe("application/json; Bearer [redacted] [local-path]");
});

test("browser_page evidence rejects raw local artifact paths", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => ({
      finalUrl: "https://example.com",
      navigationStatus: 200,
      screenshot: {
        ref: "/tmp/screenshot.png",
        sha256: "a".repeat(64),
        bytes: 10,
      },
    }),
  });

  expect(result.status).toBe("down");
  expect(result.error).toContain("local paths");
});

test("browser_page evidence blocks non-http evidence URLs and file artifact refs", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => ({
      finalUrl: "file:///Users/hasna/private.html",
      navigationStatus: 200,
      failedRequests: [{ url: "data:text/plain,token=secret", statusCode: null, error: null }],
    }),
  });

  const evidence = expectBrowserEvidence(result);
  expect(evidence.finalUrl).toBe("[blocked-url]");
  expect(evidence.failedRequests[0].url).toBe("[blocked-url]");

  const artifact = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => ({
      finalUrl: "https://example.com",
      navigationStatus: 200,
      screenshot: {
        ref: "File:///Users/hasna/private.png",
        sha256: "a".repeat(64),
        bytes: 10,
      },
    }),
  });
  expect(artifact.status).toBe("down");
  expect(artifact.error).toContain("local paths");
});

test("browser_page evidence strips URL fragments", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => ({
      finalUrl: "https://example.com/callback#access_token=secret",
      navigationStatus: 200,
      failedRequests: [{ url: "https://example.com/api#token=secret", statusCode: 500, error: null }],
    }),
  });

  const evidence = expectBrowserEvidence(result);
  expect(evidence.finalUrl).toBe("https://example.com/callback");
  expect(evidence.failedRequests[0].url).toBe("https://example.com/api");
});

test("browser_page runner exceptions redact top-level errors", async () => {
  const result = await runBrowserPageCheck(monitor({ kind: "browser_page" }), {
    runner: async () => {
      throw new Error("Bearer abc apiToken=secret at /Users/example/private/file");
    },
  });

  expect(result.status).toBe("down");
  expect(result.error).toBe("Bearer [redacted] apiToken=[redacted] at [local-path]");
  expect(expectBrowserEvidence(result).pageErrors[0]).toBe("Bearer [redacted] apiToken=[redacted] at [local-path]");
});
