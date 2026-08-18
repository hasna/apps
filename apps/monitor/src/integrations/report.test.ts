import { afterEach, describe, expect, it } from "bun:test";
import { inspectCloudRuntimeHealth } from "../cloud-runtime.js";
import type { FleetHealthReport } from "../report.js";
import { runReportIntegrations } from "./index.js";

function makeReport(): FleetHealthReport {
  return {
    period: "weekly",
    label: "Weekly",
    generatedAt: Date.parse("2026-04-10T10:00:00.000Z"),
    windowStart: Math.floor(Date.parse("2026-04-03T10:00:00.000Z") / 1000),
    overallStatus: "critical",
    cloudRuntime: inspectCloudRuntimeHealth({
      config: {
        machines: [
          {
            id: "local",
            label: "Local",
            type: "local",
          },
        ],
      },
      env: {},
    }),
    machineCount: 1,
    reachableMachineCount: 1,
    recentAlerts: 5,
    unresolvedAlerts: 2,
    machines: [
      {
        machineId: "linux-node-a",
        hostname: "linux-node-a.local",
        status: "critical",
        cpuPercent: 98.2,
        memPercent: 91.4,
        processCount: 200,
        zombieCount: 0,
        recentAlerts: 5,
        unresolvedAlerts: 2,
        diskDeltaGb: 6.8,
        topProcesses: [{ pid: 999, name: "python", memMb: 2048, cpuPercent: 44.3 }],
      },
    ],
  };
}

const servers: Array<{ stop: () => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop();
  }
});

describe("runReportIntegrations", () => {
  it("delivers fleet reports to conversations and emails integrations", async () => {
    const requests: Array<{ path: string; body: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        requests.push({
          path,
          body: await request.text(),
        });
        // The conversations integration posts through the package-owned SDK
        // (ConversationsClient.sendMessage -> POST /v1/messages), which expects
        // the server's {message: {id, uuid}} pointer contract.
        if (path === "/v1/messages") {
          return new Response(
            JSON.stringify({
              message: { id: 1, uuid: "0f0a1b2c-3d4e-5f6a-8b9c-0d1e2f3a4b5c", channel: "monitor" },
            }),
            { status: 201, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const delivered = await runReportIntegrations(
      makeReport(),
      {
        conversations: {
          enabled: true,
          space_id: "monitor",
          base_url: baseUrl,
        },
        emails: {
          enabled: true,
          to: "ops@example.com",
          base_url: baseUrl,
        },
      }
    );

    expect(delivered).toEqual(["conversations", "emails"]);
    expect(requests.some((entry) => entry.path === "/v1/messages")).toBe(true);
    expect(requests.some((entry) => entry.path === "/api/emails/send")).toBe(true);
  });
});
