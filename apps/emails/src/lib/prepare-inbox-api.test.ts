import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { prepareInbox } from "./prepare-inbox-api.js";
let stub: V1Stub;
let proxy: ReturnType<typeof Bun.spawn>;
let origin: string;
const provider = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  stub = await startV1Stub({ openapi: true, apiKey: crypto.randomUUID(), seed: { providers: [{ id: provider, name: "fixture", type: "ses", active: true }] } });
  proxy = Bun.spawn({ cmd: [process.execPath, "--eval", `
    let submissions = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      if (request.headers.get("authorization") !== "Bearer " + process.env.FIXTURE_KEY) return new Response("unauthorized", {status:401});
      const url = new URL(request.url);
      if (url.pathname === "/submissions") return Response.json(submissions);
      if (url.pathname === "/v1/provision/address" && request.method === "POST") {
        const body = await request.json(); submissions.push(body); const { idempotency_key, dry_run, ...input } = body;
        return Response.json({job:{id:"22222222-2222-4222-8222-222222222222",kind:"address",status:"blocked",input,receipt:{ready:false,code:"mx_pending",message:"DNS pending",checked_at:new Date().toISOString()},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
      }
      return fetch(new Request(process.env.FIXTURE_ORIGIN + url.pathname + url.search, request));
    }}); console.log(server.url.origin);
  `], env: { ...process.env, FIXTURE_KEY: stub.apiKey, FIXTURE_ORIGIN: stub.baseUrl }, stdout: "pipe", stderr: "inherit" });
  const reader = proxy.stdout.getReader();
  const chunk = await reader.read(); reader.releaseLock();
  origin = new TextDecoder().decode(chunk.value).trim();
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});
beforeEach(async () => { await stub.reset(); stub.applyEnv(); process.env.HASNA_EMAILS_API_URL = origin; });
afterEach(() => stub.clearEnv());
afterAll(async () => { proxy?.kill(); if (proxy) await proxy.exited; stub?.stop(); });
const submissions = async () => await (await fetch(`${origin}/submissions`, {headers:{authorization:`Bearer ${stub.apiKey}`}})).json() as Record<string,unknown>[];
test("explicit preparation forwards all provisioning options and preserves a blocked receipt", async () => {
  const result = await prepareInbox({ email: "Ops@Example.com", provider_id: provider, receive_strategy: "cf-routing", forward_to: "target@example.net", owner: "person", administrator: "agent", create_missing: true, idempotency_key: "prepare-once" });
  expect(result).toMatchObject({job:{id:"22222222-2222-4222-8222-222222222222",status:"blocked",receipt:{ready:false,code:"mx_pending"}}});
  expect((await submissions()).at(-1)).toMatchObject({email:"ops@example.com",provider_id:provider,receive_strategy:"cf-routing",forward_to:"target@example.net",owner:"person",administrator:"agent",idempotency_key:"prepare-once"});
  expect(await stub.list("addresses")).toHaveLength(0);
});
test("invalid input and missing creation authorization never submit jobs", async () => {
  const before = (await submissions()).length;
  for (const input of [{email:"not-an-email"}, {email:"new@example.com"}, {email:"new@example.com",administrator:"agent"}, {email:"new@example.com",forward_to:"target@example.net"}]) await expect(prepareInbox(input)).rejects.toThrow();
  expect(await submissions()).toHaveLength(before);
});
test("an existing inbox supplies its provider when preparation is explicit", async () => {
  await stub.seed({providers:[{id:provider,name:"fixture",type:"ses",active:true}],addresses:[{id:"address-1",email:"existing@example.com",provider_id:provider,status:"active",receive_strategy:"cf-routing",forward_to:"keep@example.net"}]});
  await prepareInbox({email:"existing@example.com",create_missing:true,idempotency_key:"existing"});
  expect((await submissions()).at(-1)).toMatchObject({email:"existing@example.com",provider_id:provider,idempotency_key:"existing",receive_strategy:"cf-routing",forward_to:"keep@example.net"});
});
