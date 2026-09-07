import { expect, it } from "bun:test";
import { fetchProviderServerHealth } from "./provider-server-health.js";
it("old servers fail explicitly and never trigger a provider mutation", async () => {
  const paths: string[] = [];
  const server = Bun.serve({ port: 0, fetch(req) { paths.push(`${req.method} ${new URL(req.url).pathname}`); return new Response("missing", { status: 404 }); } });
  try {
    await expect(fetchProviderServerHealth("fixture", true, { baseUrl: server.url.origin + "/v1", credentials: ["fixture"] })).rejects.toThrow("API needs an update");
    expect(paths).toEqual(["GET /v1/providers/fixture/health"]);
  } finally { server.stop(true); }
});
it("reports server binding status with API credential fallback", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return calls === 1 ? new Response("expired", { status: 401 }) : Response.json({ provider_id: "fixture", checked: false, status: "unconfigured", message: "Configure a server binding" }); } });
  try {
    expect((await fetchProviderServerHealth("fixture", true, { baseUrl: server.url.origin + "/v1", credentials: ["first", "second"] })).status).toBe("unconfigured");
    expect(calls).toBe(2);
  } finally { server.stop(true); }
});
