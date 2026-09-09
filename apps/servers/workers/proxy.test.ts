import { expect, test } from "bun:test";
import { createAliasWorker, type AliasEnv } from "./alias";
import { PreviewRegistry } from "./registry";
import router from "./router";
import { MemoryStorage } from "./test-storage";
import { CONTROL_PATH, type PreviewRecord, type RouterEnv } from "./shared";

const key = "studio/web/dev/main";
const host = "studio-web-dev.example.workers.dev";
const controlToken = "control".repeat(8);
const routerToken = "router".repeat(8);
const gatewayToken = "gateway".repeat(8);

async function fixture() {
  const registry = new PreviewRegistry({ storage: new MemoryStorage() }, { CONTROL_TOKEN: controlToken });
  const seen: Request[] = [];
  let result = new Response("app response", { headers: { "content-type": "text/event-stream" } });
  const env: RouterEnv = {
    CONTROL_TOKEN: controlToken, ROUTER_TOKEN: routerToken, GATEWAY_TOKEN: gatewayToken,
    PREVIEWS: { idFromName: (name) => name, get: () => registry },
    STATION_A: { fetch: async (request: Request) => { seen.push(request); return result; } },
  };
  const aliasEnv: AliasEnv = {
    ROUTER: { fetch: (request) => router.fetch(request, env) }, ROUTER_TOKEN: routerToken,
    PREVIEW_KEY: key, PREVIEW_HOST: host,
    ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com", ACCESS_AUD: "example-audience",
  };
  await registry.execute({ action: "register-station", station: { id: "station-a", binding: "STATION_A" } });
  await registry.execute({ action: "register-preview", preview: { key, hostname: host } });
  const lease = await registry.execute({ action: "claim", key, stationId: "station-a", instanceId: "instance-a" }) as PreviewRecord;
  const alias = createAliasWorker(async () => true);
  return { env, aliasEnv, registry, seen, lease, alias, getResult: () => result, setResult: (value: Response) => { result = value; } };
}

test("alias and router replace spoofed metadata and preserve app origin, body and credentials", async () => {
  const { alias, aliasEnv, seen, lease, getResult } = await fixture();
  const response = await alias.fetch(new Request(`https://${host}/api/upload?name=hello`, {
    method: "POST", body: "upload payload",
    headers: {
      authorization: "Bearer application-credential", cookie: "session=app; CF_Authorization=access-session",
      "cf-access-jwt-assertion": "verified-by-test", "cf-access-client-secret": "client-input",
      "x-servers-preview": "other/app/dev/main", "x-servers-instance": "bad", "x-servers-fence": "999",
      "x-servers-gateway-token": "bad", "x-servers-router-token": "bad",
      "x-forwarded-host": "evil.example", forwarded: "host=evil.example", "x-real-ip": "spoofed",
    },
  }), aliasEnv);
  expect(response).toBe(getResult());
  expect(seen).toHaveLength(1);
  const forwarded = seen[0]!;
  expect(forwarded.url).toBe(`http://${host}/api/upload?name=hello`);
  expect(await forwarded.text()).toBe("upload payload");
  expect(forwarded.headers.get("authorization")).toBe("Bearer application-credential");
  expect(forwarded.headers.get("cookie")).toBe("session=app");
  expect(forwarded.headers.get("host")).toBe(host);
  expect(forwarded.headers.get("x-forwarded-host")).toBe(host);
  expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
  expect(forwarded.headers.get("x-servers-preview")).toBe(key);
  expect(forwarded.headers.get("x-servers-instance")).toBe(lease.instanceId!);
  expect(forwarded.headers.get("x-servers-fence")).toBe(String(lease.fence));
  expect(forwarded.headers.get("x-servers-gateway-token")).toBe(gatewayToken);
  expect(forwarded.headers.has("x-servers-router-token")).toBe(false);
  expect(forwarded.headers.has("cf-access-jwt-assertion")).toBe(false);
  expect(forwarded.headers.has("cf-access-client-secret")).toBe(false);
  expect(forwarded.headers.has("forwarded")).toBe(false);
  expect(forwarded.redirect).toBe("manual");
});

test("direct router requests cannot impersonate an alias", async () => {
  const { env, seen } = await fixture();
  const response = await router.fetch(new Request(`https://${host}/`, {
    headers: { "x-servers-preview": key, "x-servers-preview-host": host, "x-servers-router-token": "forged" },
  }), env);
  expect(response.status).toBe(403);
  expect(seen).toHaveLength(0);
});

test("alias refuses missing Access authentication and deployment preview hosts", async () => {
  const { alias, aliasEnv, seen } = await fixture();
  expect((await createAliasWorker().fetch(new Request(`https://${host}/`), aliasEnv)).status).toBe(403);
  expect((await alias.fetch(new Request("https://version-studio-web.example.workers.dev/"), aliasEnv)).status).toBe(403);
  expect((await alias.fetch(new Request(`https://${host}/`), { ...aliasEnv, ACCESS_AUD: "" })).status).toBe(503);
  expect(seen).toHaveLength(0);
});

test("offline previews never contact a workstation", async () => {
  const { alias, aliasEnv, registry, lease, seen } = await fixture();
  await registry.execute({ action: "release", ...lease });
  expect((await alias.fetch(new Request(`https://${host}/`), aliasEnv)).status).toBe(503);
  expect(seen).toHaveLength(0);
});

test("public app requests cannot enter control or daemon APIs through an alias", async () => {
  const { alias, aliasEnv, seen } = await fixture();
  const response = await alias.fetch(new Request(`https://${host}${CONTROL_PATH}`, {
    method: "POST", headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  }), aliasEnv);
  expect(response.status).toBe(403);
  expect((await alias.fetch(new Request(`https://${host}/%5f%5fservers/local/status`), aliasEnv)).status).toBe(403);
  expect(seen).toHaveLength(0);
});

test("router returns WebSocket and streamed responses without wrapping or consuming them", async () => {
  const { alias, aliasEnv, setResult, seen } = await fixture();
  const upgraded = { status: 101, webSocket: { protocol: "hmr" } } as unknown as Response;
  setResult(upgraded);
  const response = await alias.fetch(new Request(`https://${host}/hmr`, { headers: { upgrade: "websocket" } }), aliasEnv);
  expect(response).toBe(upgraded);
  expect(seen[0]!.headers.get("upgrade")).toBe("websocket");
  const streamed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: live\n\n")); } }));
  setResult(streamed);
  expect(await alias.fetch(new Request(`https://${host}/events`), aliasEnv)).toBe(streamed);
  expect(streamed.bodyUsed).toBe(false);
  await streamed.body!.cancel();
});

test("authenticated probe verifies station reachability without disclosing gateway body", async () => {
  const { env, seen, setResult } = await fixture();
  setResult(new Response("private local information"));
  const request = (input: unknown) => new Request(`https://router.example.workers.dev${CONTROL_PATH}`, {
    method: "POST", headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" }, body: JSON.stringify(input),
  });
  const response = await router.fetch(request({ action: "probe-station", stationId: "station-a" }), env);
  expect(await response.json()).toEqual({ ready: true });
  expect(seen[0]!.headers.get("x-servers-gateway-token")).toBe(gatewayToken);
  expect(new URL(seen[0]!.url).pathname).toBe("/__servers/ready");
  const bad = await router.fetch(request({ action: "register-station", station: { id: "unknown", binding: "STATION_UNKNOWN" } }), env);
  expect(bad.status).toBe(503);
});

test("gateway exceptions produce a safe unavailable response", async () => {
  const { alias, aliasEnv, env } = await fixture();
  env.STATION_A = { fetch: async () => { throw new Error("private tunnel detail"); } };
  const response = await alias.fetch(new Request(`https://${host}/`), aliasEnv);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private tunnel");
});
