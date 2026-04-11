import { diffApps, getAppsStatus } from "./apps.js";
import { runDoctor } from "./doctor.js";
import { diffClaudeCli, getClaudeCliStatus } from "./install-claude.js";
import { listNotificationChannels, testNotificationChannel } from "./notifications.js";
import { manifestList } from "./manifest.js";
import { runSelfTest } from "./self-test.js";
import { getStatus } from "./status.js";

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
  const host = options.host || "0.0.0.0";
  const port = options.port || 7676;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    routes: [
      "/",
      "/health",
      "/api/status",
      "/api/manifest",
      "/api/notifications",
      "/api/doctor",
      "/api/self-test",
      "/api/apps/status",
      "/api/apps/diff",
      "/api/install-claude/status",
      "/api/install-claude/diff",
      "/api/notifications/test",
    ],
  };
}

export function renderDashboardHtml(): string {
  const status = getStatus();
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
    </style>
  </head>
  <body>
    <main>
      <h1>Machines Dashboard</h1>
      <div class="grid">
        <section class="card"><div>Manifest machines</div><div class="stat">${status.manifestMachineCount}</div></section>
        <section class="card"><div>Heartbeats</div><div class="stat">${status.heartbeatCount}</div></section>
        <section class="card"><div>Notification channels</div><div class="stat">${notifications.channels.length}</div></section>
        <section class="card"><div>Doctor warnings</div><div class="stat">${doctor.checks.filter((entry) => entry.status !== "ok").length}</div></section>
      </div>

      <section class="card" style="margin-top:16px">
        <h2>Machines</h2>
        <table>
          <thead><tr><th>ID</th><th>Platform</th><th>Status</th><th>Last heartbeat</th></tr></thead>
          <tbody>
            ${status.machines
              .map(
                (machine) => `<tr>
              <td><code>${escapeHtml(machine.machineId)}</code></td>
              <td>${escapeHtml(machine.platform || "unknown")}</td>
              <td><span class="badge ${escapeHtml(machine.heartbeatStatus)}">${escapeHtml(machine.heartbeatStatus)}</span></td>
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
          <tbody>
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
        <h2>Self Test</h2>
        <p class="muted">Use <code>/api/self-test</code> for the full smoke-check payload.</p>
      </section>

      <section class="card" style="margin-top:16px">
        <h2>Manifest</h2>
        <pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre>
      </section>
    </main>
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

export function startDashboardServer(options: ServeOptions = {}): ReturnType<typeof Bun.serve> {
  const info = getServeInfo(options);
  return Bun.serve({
    hostname: info.host,
    port: info.port,
    async fetch(request) {
      const url = new URL(request.url);
      const machineId = url.searchParams.get("machine") || undefined;
      const tools = url.searchParams.get("tools")?.split(",").map((value) => value.trim()).filter(Boolean);

      if (url.pathname === "/health") {
        return Response.json({ ok: true, ...getServeInfo(options) });
      }
      if (url.pathname === "/api/status") {
        return Response.json(getStatus());
      }
      if (url.pathname === "/api/manifest") {
        return Response.json(manifestList());
      }
      if (url.pathname === "/api/notifications") {
        return Response.json(listNotificationChannels());
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
        try {
          return Response.json(await testNotificationChannel(channelId, event, message, { apply, yes }));
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
