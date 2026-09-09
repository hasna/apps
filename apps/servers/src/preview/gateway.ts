import { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { hasOwnedListener } from "../runtime/process-tree.js";
import { getServer } from "../db/servers.js";
import { getLocalServerSnapshot } from "../runtime/local-server.js";
import type { LocalPreviewRoute, PreviewLease, PreviewSettings, PreviewStation } from "./state.js";
import { previewControl, requiredSecret } from "./state.js";

interface SocketData { upstream: WebSocket; key: string; fence: number; pending: (string | Uint8Array)[]; downstream?: ServerWebSocket<SocketData> }
// lib.dom hides Bun's documented custom-header constructor overload.
const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
interface GatewayOptions {
  port: number;
  gatewayToken: string;
  controlToken: string;
  now?: () => number;
}
const internalPrefix = "x-servers-";
function equal(a: string | null, b: string): boolean {
  if (!a) return false;
  const actual = Buffer.from(a); const expected = Buffer.from(b);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
export function createPreviewGateway(options: GatewayOptions) {
  const routes = new Map<string, LocalPreviewRoute>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const now = options.now ?? Date.now;
  const remove = (key: string) => {
    routes.delete(key);
    for (const socket of sockets) if (socket.data.key === key) { socket.close(1012, "Preview destination changed"); socket.data.upstream.close(); }
  };
  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: options.port, idleTimeout: 0,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/__servers/local/")) {
        if (request.headers.has("x-servers-preview") || !equal(request.headers.get("x-servers-control-token"), options.controlToken)) return new Response("Forbidden", { status: 403 });
        if (url.pathname === "/__servers/local/status" && request.method === "GET") return Response.json({ ready: true, pid: process.pid, routes: [...routes.values()] });
        if (request.method !== "POST" || Number(request.headers.get("content-length") ?? 0) > 16_384) return new Response("Invalid control request", { status: 400 });
        let input: Record<string, unknown>;
        try { const body = await request.text(); if (body.length > 16_384) throw new Error(); input = JSON.parse(body); }
        catch { return new Response("Invalid control request", { status: 400 }); }
        if (url.pathname === "/__servers/local/remove" && typeof input.key === "string") { remove(input.key); return Response.json({ removed: true }); }
        if (url.pathname === "/__servers/local/route") {
          const route = input as unknown as LocalPreviewRoute;
          if (!validRoute(route, options.port)) return new Response("Invalid loopback route", { status: 400 });
          const existing = routes.get(route.key);
          if (existing && existing.instanceId !== route.instanceId && existing.expiresAt > now()) return new Response("Local preview instance already exists", { status: 409 });
          if (existing && route.fence < existing.fence) return new Response("Stale fence", { status: 409 });
          if (existing && route.fence !== existing.fence) remove(route.key);
          routes.set(route.key, { ...route }); return Response.json({ ready: true });
        }
        return new Response("Not found", { status: 404 });
      }
      if (!equal(request.headers.get("x-servers-gateway-token"), options.gatewayToken)) return new Response("Forbidden", { status: 403 });
      if (url.pathname === "/__servers/ready") return Response.json({ ready: true });
      if (url.pathname.startsWith("/__servers/")) return new Response("Not found", { status: 404 });
      const key = request.headers.get("x-servers-preview") ?? "";
      const route = routes.get(key);
      if (!route || !hasOwnedListener(route.pid, route.port) || route.expiresAt <= now() || request.headers.get("x-servers-instance") !== route.instanceId || request.headers.get("x-servers-fence") !== String(route.fence)) return new Response("Preview offline", { status: 503, headers: { "cache-control": "no-store" } });
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (name.startsWith(internalPrefix) || name.startsWith("cf-access-") || name.startsWith("x-forwarded-") || name === "x-real-ip" || name === "forwarded") headers.delete(name);
      headers.set("host", route.hostname);
      headers.set("x-forwarded-host", route.hostname);
      headers.set("x-forwarded-proto", "https");
      headers.set("x-forwarded-port", "443");
      headers.delete("x-forwarded-for");
      const target = `http://127.0.0.1:${route.port}${url.pathname}${url.search}`;
      if (headers.get("upgrade")?.toLowerCase() === "websocket") {
        try {
          headers.delete("sec-websocket-key"); headers.delete("sec-websocket-version"); headers.delete("sec-websocket-extensions");
          const protocols = (headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
          headers.delete("sec-websocket-protocol"); headers.delete("connection"); headers.delete("upgrade");
          const upstream = new BunWebSocket(target.replace(/^http:/, "ws:"), { headers: Object.fromEntries(headers), protocols });
          upstream.binaryType = "arraybuffer";
          const data: SocketData = { upstream, key, fence: route.fence, pending: [] };
          let bufferedBytes = 0;
          upstream.addEventListener("message", (event) => {
            const message = typeof event.data === "string" ? event.data : new Uint8Array(event.data);
            if (data.downstream) {
              if (data.downstream.send(message) === 0) { data.downstream.close(1013, "Backpressure limit"); upstream.close(); }
            } else {
              bufferedBytes += typeof message === "string" ? Buffer.byteLength(message) : message.byteLength;
              if (bufferedBytes > 4 * 1024 * 1024) upstream.close(1009, "Backpressure limit");
              else data.pending.push(message);
            }
          });
          upstream.addEventListener("close", () => data.downstream?.close());
          upstream.addEventListener("error", () => data.downstream?.close(1011, "Upstream unavailable"));
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { upstream.close(); reject(new Error("WebSocket connection timeout")); }, 5000);
            upstream.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
            upstream.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WebSocket unavailable")); }, { once: true });
          });
          const responseHeaders = new Headers();
          if (upstream.protocol) responseHeaders.set("sec-websocket-protocol", upstream.protocol);
          if (server.upgrade(request, { headers: responseHeaders, data })) return undefined;
          upstream.close();
        } catch {}
        return new Response("Preview WebSocket unavailable", { status: 502 });
      }
      headers.delete("connection"); headers.delete("upgrade");
      try {
        return await fetch(target, { method: request.method, headers, body: request.body, redirect: "manual", signal: request.signal, decompress: false });
      } catch { return new Response("Preview app unavailable", { status: 502 }); }
    },
    websocket: {
      maxPayloadLength: 16 * 1024 * 1024,
      backpressureLimit: 4 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(socket) {
        sockets.add(socket);
        socket.data.downstream = socket;
        for (const message of socket.data.pending) socket.send(message);
        socket.data.pending.length = 0;
      },
      message(socket, message) {
        if (socket.data.upstream.bufferedAmount > 4 * 1024 * 1024) { socket.close(1013, "Backpressure limit"); return; }
        socket.data.upstream.send(message);
      },
      close(socket) { sockets.delete(socket); socket.data.upstream.close(); },
    },
  });
  const expiryTimer = setInterval(() => { for (const [key, route] of routes) if (route.expiresAt > 0 && route.expiresAt <= now()) remove(key); }, 1000);
  expiryTimer.unref();
  return { server, routes, remove, stop: () => { clearInterval(expiryTimer); for (const key of routes.keys()) remove(key); server.stop(true); } };
}
function validRoute(route: LocalPreviewRoute, gatewayPort: number): boolean {
  return Object.keys(route).every((name) => ["key", "instanceId", "serverId", "databasePath", "pid", "port", "hostname", "fence", "expiresAt", "readinessPath"].includes(name))
    && typeof route.key === "string" && /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/.test(route.key)
    && typeof route.instanceId === "string" && /^[a-f0-9]{32}$/.test(route.instanceId)
    && typeof route.serverId === "string" && /^[a-zA-Z0-9-]+$/.test(route.serverId)
    && typeof route.databasePath === "string" && isAbsolute(route.databasePath) && !route.databasePath.includes("\0")
    && Number.isSafeInteger(route.pid) && route.pid > 1
    && Number.isInteger(route.port) && route.port >= 1024 && route.port <= 65535 && route.port !== gatewayPort
    && typeof route.hostname === "string" && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(route.hostname)
    && Number.isSafeInteger(route.fence) && route.fence >= 0 && Number.isSafeInteger(route.expiresAt) && route.expiresAt >= 0
    && typeof route.readinessPath === "string" && /^\/(?!\/)[^?#\\\s]*$/.test(route.readinessPath);
}
export async function localGatewayControl<T>(settings: PreviewSettings, station: PreviewStation, action: "status" | "route" | "remove", body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${station.gatewayPort}/__servers/local/${action}`, { method: action === "status" ? "GET" : "POST", headers: { "x-servers-control-token": requiredSecret(settings.controlTokenEnv), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) throw new Error(`Local preview gateway rejected ${action} (HTTP ${response.status})`);
  return await response.json() as T;
}
export async function renewGatewayRoutes(gateway: ReturnType<typeof createPreviewGateway>, settings: PreviewSettings, station: PreviewStation): Promise<void> {
  await Promise.all([...gateway.routes.values()].filter((route) => route.fence > 0).map(async (route) => {
    try {
      const database = new Database(route.databasePath, { readonly: true });
      let server;
      try { server = getServer(route.serverId, database); } finally { database.close(); }
      const observed = server ? await getLocalServerSnapshot(server, { timeoutMs: 3000 }) : undefined;
      if (!observed?.ready || !observed.running || observed.pid !== route.pid) { gateway.remove(route.key); return; }
      const lease = await previewControl<PreviewLease>(settings, { action: "heartbeat", key: route.key, stationId: station.id, instanceId: route.instanceId, fence: route.fence });
      // A replaced route cannot be renewed by an earlier in-flight heartbeat.
      if (gateway.routes.get(route.key) === route) route.expiresAt = lease.expiresAt;
    } catch { gateway.remove(route.key); }
  }));
}
