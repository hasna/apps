import { EventsClient, getEventsDataDir, sanitizeChannelsForOutput } from "@hasna/events";
import { resolve } from "node:path";
import { diffApps, getAppsStatus } from "./apps.js";
import { runDoctor } from "./doctor.js";
import { diffClaudeCli, getClaudeCliStatus } from "./install-claude.js";
import { getAgentStatus } from "../agent/runtime.js";
import { PRIVATE_OUTPUT_DENIED_WARNING, isPrivateOutputEnabled } from "../redaction.js";
import { discoverMachineTopology, redactRouteForOutput, redactTopologyForOutput, resolveMachineRoute } from "../topology.js";
import { createTrustedNotificationApproval, listNotificationChannels, testNotificationChannel } from "./notifications.js";
import { manifestList } from "./manifest.js";
import { runSelfTest } from "./self-test.js";
import { getStatus } from "./status.js";
import { MUTATION_APPROVAL_CALLER_ENV, MUTATION_APPROVAL_RUN_ENV, mutationArgsSha256, verifyMutationApprovalToken } from "./mutation-approval.js";

export interface ServeOptions {
  host?: string;
  port?: number;
}

export interface ServeInfo {
  host: string;
  port: number;
  url: string;
  routes: string[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getServeInfo(options: ServeOptions = {}): ServeInfo {
  const host = options.host || "127.0.0.1";
  const port = options.port || 7676;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    routes: [
      "/",
      "/health",
      "/api/status",
      "/api/topology",
      "/api/routes",
      "/api/daemon/status",
      "/api/manifest",
      "/api/notifications",
      "/api/webhooks",
      "/api/events",
      "/api/doctor",
      "/api/self-test",
      "/api/apps/status",
      "/api/apps/diff",
      "/api/install-claude/status",
      "/api/install-claude/diff",
      "/api/notifications/test",
      "/api/webhooks/test",
    ],
  };
}

export function renderDashboardHtml(): string {
  const status = getStatus();
  const topology = discoverMachineTopology();
  const manifest = manifestList();
  const notifications = listNotificationChannels();
  const doctor = runDoctor();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Machines Dashboard</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; background: #0b1020; color: #e5ecff; }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
      h1, h2 { margin: 0 0 16px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .card { background: #121933; border: 1px solid #243057; border-radius: 16px; padding: 20px; }
      .stat { font-size: 32px; font-weight: 700; margin-top: 8px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #243057; vertical-align: top; }
      code { color: #9ed0ff; }
      .badge { display: inline-block; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
      .online, .ok { background: #12351f; color: #74f0a7; }
      .offline, .fail { background: #3b1a1a; color: #ff8c8c; }
      .unknown, .warn { background: #2f2b16; color: #ffd76a; }
      ul { margin: 8px 0 0; padding-left: 18px; }
      .muted { color: #9fb0d9; }
      .refresh { font-size: 12px; color: #6b7fa3; margin-left: auto; }
      .updated { transition: opacity 0.3s; }
    </style>
  </head>
  <body>
    <main>
      <h1>Machines Dashboard <span class="refresh" id="last-updated"></span></h1>
      <div class="grid">
        <section class="card"><div>Manifest machines</div><div class="stat">${status.manifestMachineCount}</div></section>
        <section class="card"><div>Heartbeats</div><div class="stat">${status.heartbeatCount}</div></section>
        <section class="card"><div>Notification channels</div><div class="stat">${notifications.channels.length}</div></section>
        <section class="card"><div>Doctor warnings</div><div class="stat">${doctor.checks.filter((entry) => entry.status !== "ok").length}</div></section>
        <section class="card"><div>Tailscale routes</div><div class="stat">${topology.machines.filter((machine) => machine.ssh.route === "tailscale").length}</div></section>
      </div>

      <section class="card" style="margin-top:16px">
        <h2>Machines</h2>
        <table>
          <thead><tr><th>ID</th><th>Platform</th><th>Status</th><th>Agent</th><th>Storage</th><th>Last heartbeat</th></tr></thead>
          <tbody>
            ${status.machines
              .map(
                (machine) => `<tr>
              <td><code>${escapeHtml(machine.machineId)}</code></td>
              <td>${escapeHtml(machine.platform || "unknown")}</td>
              <td><span class="badge ${escapeHtml(machine.heartbeatStatus)}">${escapeHtml(machine.heartbeatStatus)}</span></td>
              <td>${escapeHtml(machine.agentMode || "unknown")} ${escapeHtml(machine.daemonVersion || "")}</td>
              <td>${escapeHtml(machine.storageSyncStatus || "unknown")}</td>
              <td>${escapeHtml(machine.lastHeartbeatAt || "—")}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>Doctor</h2>
        <table>
          <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody id="doctor-tbody">
            ${doctor.checks
              .map(
                (entry) => `<tr>
              <td>${escapeHtml(entry.summary)}</td>
              <td><span class="badge ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></td>
              <td class="muted">${escapeHtml(entry.detail)}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>Apps</h2>
        <p class="muted">Use <code>/api/apps/status</code> for the full app inventory payload.</p>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>AI CLIs</h2>
        <p class="muted">Use <code>/api/install-claude/status</code> for the full CLI inventory payload.</p>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>Self Test</h2>
        <p class="muted">Use <code>/api/self-test</code> for the full smoke-check payload.</p>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>Manifest</h2>
        <pre id="manifest-json">${escapeHtml(JSON.stringify(manifest, null, 2))}</pre>
      </section>
    </main>
    <script>
      // Auto-refresh dashboard data every 15s
      const REFRESH_INTERVAL = 15000;
      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }
      async function refreshData() {
        try {
          const [statusRes, doctorRes] = await Promise.all([
            fetch("/api/status"),
            fetch("/api/doctor"),
          ]);
          const status = await statusRes.json();
          const doctor = await doctorRes.json();

          // Update stat cards
          const stats = document.querySelectorAll(".stat");
          if (stats[0]) stats[0].textContent = status.manifestMachineCount;
          if (stats[1]) stats[1].textContent = status.heartbeatCount;

          // Update machine table
          const tbody = document.querySelector("tbody");
          if (tbody && status.machines) {
            tbody.innerHTML = status.machines
              .map((m) =>
                "<tr>" +
                "<td><code>" + escapeHtml(m.machineId) + "</code></td>" +
                "<td>" + escapeHtml(m.platform || "unknown") + "</td>" +
                '<td><span class="badge ' + escapeHtml(m.heartbeatStatus) + '">' + escapeHtml(m.heartbeatStatus) + '</span></td>' +
                "<td>" + escapeHtml(m.agentMode || "unknown") + " " + escapeHtml(m.daemonVersion || "") + "</td>" +
                "<td>" + escapeHtml(m.storageSyncStatus || "unknown") + "</td>" +
                "<td>" + escapeHtml(m.lastHeartbeatAt || "\\u2014") + "</td>" +
                "</tr>"
              )
              .join("");
          }

          // Update doctor table
          const doctorTbody = document.getElementById("doctor-tbody");
          if (doctorTbody && doctor.checks) {
            doctorTbody.innerHTML = doctor.checks
              .map((c) =>
                "<tr>" +
                "<td>" + escapeHtml(c.summary) + "</td>" +
                '<td><span class="badge ' + escapeHtml(c.status) + '">' + escapeHtml(c.status) + '</span></td>' +
                '<td class="muted">' + escapeHtml(c.detail) + "</td>" +
                "</tr>"
              )
              .join("");
          }

          // Update timestamp
          document.getElementById("last-updated").textContent =
            "updated " + new Date().toLocaleTimeString();
        } catch (e) {
          // Silently ignore fetch errors during page unload
        }
      }
      document.getElementById("last-updated").textContent =
        "updated " + new Date().toLocaleTimeString();
      setInterval(refreshData, REFRESH_INTERVAL);
    </script>
  </body>
</html>`;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function dashboardResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = parts
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return values ? `${kind}:${values}` : kind;
}

function eventStoreDir(): string {
  return resolve(getEventsDataDir());
}

function eventStoreScope(): { event_store_dir: string } {
  return { event_store_dir: eventStoreDir() };
}

function eventStoreResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  return dashboardResourceId(kind, mutationArgsSha256(eventStoreScope()), ...parts);
}

function withEventStoreScope<T extends Record<string, unknown>>(args: T): T & { event_store_dir: string } {
  return { event_store_dir: eventStoreDir(), ...args };
}

function dashboardMutationCallerId(): string {
  return process.env[MUTATION_APPROVAL_CALLER_ENV]?.trim() || "dashboard";
}

function dashboardMutationRunId(): string {
  return process.env[MUTATION_APPROVAL_RUN_ENV]?.trim() || "dashboard";
}

function approvalTokenFromRequest(request: Request, body: Record<string, unknown>): string | undefined {
  const bodyToken = typeof body["approval_token"] === "string"
    ? body["approval_token"]
    : typeof body["approvalToken"] === "string"
      ? body["approvalToken"]
      : undefined;
  if (bodyToken?.trim()) return bodyToken;

  const headerToken = request.headers.get("x-hasna-approval-token")?.trim();
  if (headerToken) return headerToken;

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return undefined;
}

function requireDashboardMutation(
  operation: string,
  request: Request,
  body: Record<string, unknown>,
  scope: { resourceId?: string; args?: unknown } = {},
): Response | undefined {
  const decision = verifyMutationApprovalToken({
    surface: "dashboard",
    operation,
    transport: "dashboard:http",
    callerId: dashboardMutationCallerId(),
    runId: dashboardMutationRunId(),
    resourceId: scope.resourceId,
    args: scope.args,
    approvalToken: approvalTokenFromRequest(request, body),
  });
  if (decision.approved) return undefined;
  return jsonError(`Mutation approval denied: ${decision.reason ?? "approval_token is invalid."}`, 403);
}

function objectBodyValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function privateOutputWarnings(requested: boolean, allowed: boolean): string[] {
  return requested && !allowed ? [PRIVATE_OUTPUT_DENIED_WARNING] : [];
}

function appendWarnings<T extends { warnings?: string[] }>(payload: T, warnings: string[]): T {
  if (warnings.length === 0) return payload;
  return { ...payload, warnings: [...(payload.warnings ?? []), ...warnings] };
}

export function startDashboardServer(options: ServeOptions = {}): ReturnType<typeof Bun.serve> {
  const info = getServeInfo(options);
  const events = new EventsClient();
  const trustedNotificationApproval = createTrustedNotificationApproval();
  return Bun.serve({
    hostname: info.host,
    port: info.port,
    async fetch(request) {
      const url = new URL(request.url);
      const machineId = url.searchParams.get("machine") || undefined;
      const tools = url.searchParams.get("tools")?.split(",").map((value) => value.trim()).filter(Boolean);
      const privateMetadataRequested = url.searchParams.get("privateMetadata") === "true" || url.searchParams.get("private_metadata") === "true";
      const privateMetadata = privateMetadataRequested && isPrivateOutputEnabled();
      const privateWarnings = privateOutputWarnings(privateMetadataRequested, privateMetadata);

      if (url.pathname === "/health") {
        return Response.json({ ok: true, ...getServeInfo(options) });
      }
      if (url.pathname === "/api/status") {
        return Response.json(appendWarnings(getStatus({ privateMetadata }), privateWarnings));
      }
      if (url.pathname === "/api/topology") {
        const topology = discoverMachineTopology({ includeTailscale: url.searchParams.get("tailscale") !== "false" });
        return Response.json(appendWarnings(redactTopologyForOutput(topology, { privateMetadata }), privateWarnings));
      }
      if (url.pathname === "/api/routes") {
        const topology = discoverMachineTopology({ includeTailscale: url.searchParams.get("tailscale") !== "false" });
        return Response.json({
          generated_at: topology.generated_at,
          routes: topology.machines.map((machine) => redactRouteForOutput(resolveMachineRoute(machine.machine_id, { topology }), { privateMetadata })),
          ...(privateWarnings.length > 0 ? { warnings: privateWarnings } : {}),
        });
      }
      if (url.pathname === "/api/daemon/status") {
        return Response.json({
          generated_at: new Date().toISOString(),
          agents: getAgentStatus(machineId, { privateMetadata }),
          ...(privateWarnings.length > 0 ? { warnings: privateWarnings } : {}),
        });
      }
      if (url.pathname === "/api/manifest") {
        return Response.json(manifestList());
      }
      if (url.pathname === "/api/notifications") {
        return Response.json(listNotificationChannels());
      }
      if (url.pathname === "/api/webhooks") {
        if (request.method !== "GET") {
          return jsonError("Use GET for webhook channel listing.", 405);
        }
        return Response.json(sanitizeChannelsForOutput(await events.listChannels()));
      }
      if (url.pathname === "/api/events") {
        if (request.method === "GET") {
          return Response.json(await events.listEvents());
        }
        if (request.method !== "POST") {
          return jsonError("Use GET or POST for events.", 405);
        }
        const body = await parseJsonBody(request);
        const type = typeof body["type"] === "string" ? body["type"] : undefined;
        if (!type) {
          return jsonError("type is required.");
        }
        const source = typeof body["source"] === "string" ? body["source"] : "machines";
        const subject = typeof body["subject"] === "string" ? body["subject"] : undefined;
        const severity = typeof body["severity"] === "string" ? body["severity"] : undefined;
        const message = typeof body["message"] === "string" ? body["message"] : undefined;
        const dedupeKey = typeof body["dedupeKey"] === "string" ? body["dedupeKey"] : undefined;
        const data = objectBodyValue(body["data"]);
        const metadata = objectBodyValue(body["metadata"]);
        const denied = requireDashboardMutation("machines_events_emit", request, body, {
          resourceId: eventStoreResourceId("event", type, subject, dedupeKey),
          args: withEventStoreScope({
            event_type: type,
            source,
            subject,
            severity,
            message,
            data,
            metadata,
            dedupe_key: dedupeKey,
            deliver: true,
            dedupe: true,
          }),
        });
        if (denied) return denied;
        return Response.json(await events.emit({
          source,
          type,
          subject,
          severity: severity as never,
          message,
          dedupeKey,
          data,
          metadata,
        }));
      }
      if (url.pathname === "/api/doctor") {
        return Response.json(runDoctor(machineId));
      }
      if (url.pathname === "/api/self-test") {
        return Response.json(runSelfTest());
      }
      if (url.pathname === "/api/apps/status") {
        return Response.json(getAppsStatus(machineId));
      }
      if (url.pathname === "/api/apps/diff") {
        return Response.json(diffApps(machineId));
      }
      if (url.pathname === "/api/install-claude/status") {
        return Response.json(getClaudeCliStatus(machineId, tools));
      }
      if (url.pathname === "/api/install-claude/diff") {
        return Response.json(diffClaudeCli(machineId, tools));
      }
      if (url.pathname === "/api/notifications/test") {
        if (request.method !== "POST") {
          return jsonError("Use POST for notification tests.", 405);
        }
        const body = await parseJsonBody(request);
        const channelId = typeof body["channelId"] === "string" ? body["channelId"] : undefined;
        if (!channelId) {
          return jsonError("channelId is required.");
        }
        const event = typeof body["event"] === "string" ? body["event"] : undefined;
        const message = typeof body["message"] === "string" ? body["message"] : undefined;
        const apply = body["apply"] === true;
        const yes = body["yes"] === true;
        const resolvedEvent = event ?? "manual.test";
        const resolvedMessage = message ?? "machines notification test";
        const denied = requireDashboardMutation("machines_notifications_test", request, body, {
          resourceId: dashboardResourceId("notification-test", channelId, resolvedEvent),
          args: { channel_id: channelId, event: resolvedEvent, message: resolvedMessage, apply, yes },
        });
        if (denied) return denied;
        try {
          return Response.json(await testNotificationChannel(channelId, resolvedEvent, resolvedMessage, {
            apply,
            yes,
            trustedApproval: apply ? trustedNotificationApproval : undefined,
          }));
        } catch (error) {
          return jsonError(error instanceof Error ? error.message : String(error));
        }
      }
      if (url.pathname === "/api/webhooks/test") {
        if (request.method !== "POST") {
          return jsonError("Use POST for webhook tests.", 405);
        }
        const body = await parseJsonBody(request);
        const channelId = typeof body["channelId"] === "string" ? body["channelId"] : undefined;
        if (!channelId) {
          return jsonError("channelId is required.");
        }
        const type = typeof body["type"] === "string" ? body["type"] : "events.test";
        const subject = channelId;
        const message = typeof body["message"] === "string" ? body["message"] : "Hasna events test delivery";
        const data = objectBodyValue(body["data"]);
        const denied = requireDashboardMutation("machines_webhooks_test", request, body, {
          resourceId: eventStoreResourceId("webhook-test", channelId, type),
          args: withEventStoreScope({ channel_id: channelId, event_type: type, subject, message, data }),
        });
        if (denied) return denied;
        try {
          return Response.json(await events.testChannel(channelId, {
            source: "machines",
            type,
            subject,
            message,
            data,
          }));
        } catch (error) {
          return jsonError(error instanceof Error ? error.message : String(error));
        }
      }
      return new Response(renderDashboardHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
  });
}
