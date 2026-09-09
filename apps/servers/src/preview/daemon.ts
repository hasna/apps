import { spawn } from "node:child_process";
import { PreviewCloudflare } from "./cloudflare.js";
import { createPreviewGateway, renewGatewayRoutes } from "./gateway.js";
import { loadPreviewSettings, loadPreviewStation, requiredSecret } from "./state.js";

export async function runPreviewStation(): Promise<void> {
  const settings = loadPreviewSettings();
  const station = loadPreviewStation();
  const token = await new PreviewCloudflare(settings).api<string>("GET", `/cfd_tunnel/${station.tunnelId}/token`);
  const gateway = createPreviewGateway({ port: station.gatewayPort, controlToken: requiredSecret(settings.controlTokenEnv), gatewayToken: requiredSecret(settings.gatewayTokenEnv) });
  // cloudflared supports TUNNEL_TOKEN; never place the token in argv, config or logs.
  const connector = spawn("cloudflared", ["tunnel", "--no-autoupdate", "run"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TUNNEL_TOKEN: token }, stdio: "ignore" });
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { await renewGatewayRoutes(gateway, settings, station); } finally { renewing = false; }
  }, 20_000);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true; clearInterval(heartbeat); gateway.stop(); connector.kill("SIGTERM");
  };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  await new Promise<void>((resolve, reject) => {
    connector.once("error", () => { shutdown(); reject(new Error("cloudflared could not start; install it and retry station start")); });
    connector.once("exit", (code) => { const expected = closing; shutdown(); if (!expected && code !== 0) reject(new Error("cloudflared exited; check tunnel registration and connectivity")); else resolve(); });
  });
}
if (import.meta.main) runPreviewStation().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Preview station failed"); process.exitCode = 1; });
