import { afterEach, describe, expect, it } from "bun:test";
import { createPreviewGateway } from "./gateway.js";
import type { LocalPreviewRoute } from "./state.js";
const active: (() => void)[] = [];
afterEach(() => { for (const stop of active.splice(0)) stop(); });
const gatewayToken = "g".repeat(40), controlToken = "c".repeat(40);
const key = "studio/web/dev/main";
const BunWebSocket = WebSocket as unknown as { new(url: string, options?: Bun.WebSocketOptions): WebSocket };
function gateway(port: number, pid = process.pid, now?: () => number) {
  const gateway = createPreviewGateway({ port: 0, gatewayToken, controlToken, now }); active.push(() => gateway.stop());
  const route: LocalPreviewRoute = { key, instanceId: "a".repeat(32), serverId: "server-1", databasePath: "/tmp/preview-gateway-test.db", pid, port, hostname: "studio-web.example.workers.dev", fence: 1, expiresAt: Date.now() + 60_000, readinessPath: "/" };
  gateway.routes.set(key, route);
  const headers = { "x-servers-gateway-token": gatewayToken, "x-servers-preview": key, "x-servers-instance": route.instanceId, "x-servers-fence": "1" };
  return { gateway, route, headers, url: `http://127.0.0.1:${gateway.server.port}` };
}
async function spawnApp(source: string): Promise<{ pid: number; port: number }> {
  const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "ignore" });
  active.push(() => { child.kill(); });
  const reader = child.stdout.getReader();
  const { value } = await reader.read(); reader.releaseLock();
  const port = Number(new TextDecoder().decode(value).trim());
  if (!Number.isInteger(port) || port < 1) throw new Error("Test app failed to start");
  return { pid: child.pid, port };
}
describe("station loopback gateway", () => {
  it("passes bodies, cookies and app Authorization while replacing proxy metadata and preserving redirects", async () => {
    const app = await spawnApp(`const app = Bun.serve({port:0,hostname:"127.0.0.1",fetch:async(request)=>{
      if(new URL(request.url).pathname==="/redirect")return new Response(null,{status:302,headers:{location:"https://studio-web.example.workers.dev/callback"}});
      return Response.json({body:await request.text(),headers:Object.fromEntries(request.headers)},{headers:[["set-cookie","one=1; Secure; HttpOnly"],["set-cookie","two=2; Secure"]]});
    }}); console.log(app.port);`);
    const { headers, url } = gateway(app.port, app.pid);
    const response = await fetch(`${url}/echo`, { method: "POST", headers: { ...headers, authorization: "Bearer app-session", cookie: "app=1", "x-forwarded-host": "spoof.example", "x-forwarded-client-cert": "spoof", "cf-access-client-secret": "spoof", "x-real-ip": "spoof" }, body: "upload-body" });
    expect(response.headers.getSetCookie()).toHaveLength(2);
    const result = await response.json() as { body: string; headers: Record<string, string> };
    expect(result.body).toBe("upload-body"); expect(result.headers.authorization).toBe("Bearer app-session"); expect(result.headers.cookie).toBe("app=1");
    expect(result.headers.host).toBe("studio-web.example.workers.dev"); expect(result.headers["x-forwarded-proto"]).toBe("https");
    expect(result.headers["x-servers-gateway-token"]).toBeUndefined(); expect(result.headers["x-forwarded-client-cert"]).toBeUndefined(); expect(result.headers["cf-access-client-secret"]).toBeUndefined(); expect(result.headers["x-real-ip"]).toBeUndefined();
    expect((await fetch(`${url}/redirect`, { headers, redirect: "manual" })).status).toBe(302);
  });
  it("streams early chunks without waiting for response completion", async () => {
    const app = await spawnApp(`let finish; const app=Bun.serve({port:0,hostname:"127.0.0.1",fetch(request){
      if(new URL(request.url).pathname==="/finish"){finish();return new Response("closed");}
      return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("data: first\\n\\n"));finish=()=>controller.close();}}),{headers:{"content-type":"text/event-stream"}});
    }}); console.log(app.port);`);
    const { url, headers } = gateway(app.port, app.pid);
    const response = await fetch(url, { headers }); const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    await fetch(`http://127.0.0.1:${app.port}/finish`); expect((await reader.read()).done).toBe(true);
  });
  it("rejects expired/stale instances, forged auth and remote daemon control", async () => {
    const { gateway: gw, route, url, headers } = gateway(34000);
    expect((await fetch(url)).status).toBe(403);
    expect((await fetch(url, { headers: { ...headers, "x-servers-gateway-token": "é".repeat(40) } })).status).toBe(403);
    expect((await fetch(url, { headers: { ...headers, "x-servers-fence": "2" } })).status).toBe(503);
    expect((await fetch(`${url}/__servers/local/status`, { headers: { ...headers, "x-servers-control-token": controlToken } })).status).toBe(403);
    route.expiresAt = 1;
    expect((await fetch(url, { headers })).status).toBe(503);
    expect(gw.routes.size).toBe(1);
  });
  it("refuses a port reused by an unrelated app while the recorded launcher is alive", async () => {
    const sleeper = Bun.spawn([process.execPath, "-e", "setInterval(()=>{},1000)"], { stdout: "ignore", stderr: "ignore" }); active.push(() => { sleeper.kill(); });
    const app = await spawnApp('const app=Bun.serve({port:0,fetch(){return new Response("unrelated")}});console.log(app.port);');
    const { url, headers } = gateway(app.port, sleeper.pid);
    const response = await fetch(url, { headers });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("unrelated");
  });
  it("only accepts explicit loopback ports in local route control", async () => {
    const { url, route } = gateway(34000);
    const response = await fetch(`${url}/__servers/local/route`, { method: "POST", headers: { "x-servers-control-token": controlToken }, body: JSON.stringify({ ...route, port: 443, target: "https://external.example" }) });
    expect(response.status).toBe(400);
  });
  it("preserves initial HMR messages, protocols, bidirectional frames and closes on handoff", async () => {
    const app = await spawnApp(`let receivedHeaders; const app=Bun.serve({port:0,hostname:"127.0.0.1",fetch(request,server){
      if(new URL(request.url).pathname==="/headers")return Response.json(receivedHeaders);
      receivedHeaders=Object.fromEntries(request.headers);
      if(server.upgrade(request,{headers:{"sec-websocket-protocol":"vite-hmr"}}))return undefined;
      return new Response("No upgrade",{status:400});
    },websocket:{open(socket){socket.send("connected");},message(socket,data){socket.send(data);}}}); console.log(app.port);`);
    const { gateway: gw, url, headers } = gateway(app.port, app.pid);
    const socket = new BunWebSocket(url.replace("http:", "ws:"), { headers: { ...headers, cookie: "app=1" }, protocols: ["vite-hmr"] }); active.push(() => socket.close());
    const events: string[] = [];
    const connected = new Promise<void>((resolve, reject) => { socket.addEventListener("message", (event) => { events.push(String(event.data)); if (event.data === "connected") resolve(); }); socket.addEventListener("error", () => reject(new Error("WebSocket failed"))); });
    await connected; expect(socket.protocol).toBe("vite-hmr");
    const receivedHeaders = await (await fetch(`http://127.0.0.1:${app.port}/headers`)).json() as Record<string, string>;
    expect(receivedHeaders.cookie).toBe("app=1"); expect(receivedHeaders.host).toBe("studio-web.example.workers.dev");
    const echo = new Promise<void>((resolve) => socket.addEventListener("message", (event) => { if (event.data === "ping") resolve(); })); socket.send("ping"); await echo;
    const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve())); gw.remove(key); await closed;
    expect(events).toEqual(["connected", "ping"]);
  });
});
