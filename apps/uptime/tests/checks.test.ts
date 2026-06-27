import { expect, test } from "bun:test";
import net from "node:net";
import { runHttpCheck, runMonitorCheck, runTcpCheck } from "../src/checks.js";
import type { Monitor } from "../src/types.js";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "mon_test",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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
