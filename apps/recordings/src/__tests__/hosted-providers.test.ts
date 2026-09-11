import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HostedRecordingsClient, RecordingsSDKError, type HostedProvidersResponse } from "../sdk/index.js";
import { providersResponseParser } from "../contracts/hosted-v1.js";
import { PROVIDER_SELECTION_CAPABILITY, REQUIRED_CAPABILITIES, streamControlParser, wireMetadataParser } from "../contracts/stream-v1.js";
import { runHostedCLI } from "../cli/hosted.js";
import { buildHostedServer } from "../mcp/hosted.js";
import { buildHostedFetch } from "../server/hosted.js";
import vectors from "../../contracts/v1/fixtures.json";

const base = "https://fictional.example.test/prefix/v1/";
const catalog = providersResponseParser.parse(vectors.cases.find(value => value.name === "provider catalog with explicit defaults")!.value);
const fakeFetch = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => handler(new URL(String(url)), init ?? {})) as typeof fetch;
function fixture(response: unknown = catalog, apiBase = base) {
  let calls = 0, credentials = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => { credentials++; return "fictional-session"; },
    fetch: fakeFetch((url, init) => {
      expect(url.href).toBe(apiBase + "providers"); expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fictional-session");
      calls++; return Response.json(response);
    }) });
  return { client, calls: () => calls, credentials: () => credentials };
}

test("SDK provider catalogs retain legacy absence and strip unknown configuration at every level", async () => {
  const provider = catalog.providers[0]!;
  const response = { ...catalog, serverConfig: "hidden fictional config", providers: [{ ...provider,
    upstreamURL: "https://fictional-private.example.test", modelDetails: [{ ...provider.modelDetails![0], endpoint: "hidden" }],
    formats: [{ ...provider.formats[0], privateFormat: "hidden" }] }] };
  for (const authority of [base, "https://fictional-second.example.test/other/v1/"]) {
    const f = fixture(response, authority);
    const result: HostedProvidersResponse = await f.client.providers();
    expect(result).toEqual(catalog); expect(f.calls()).toBe(1); expect(f.credentials()).toBe(1);
  }
  const legacy = vectors.cases.find(value => value.name === "legacy provider catalog")!.value;
  expect(await fixture(legacy).client.providers()).toEqual(legacy);
});

test("provider selection is optional and leaves the four mandatory capabilities unchanged", () => {
  expect(REQUIRED_CAPABILITIES).toHaveLength(4);
  expect(wireMetadataParser.parse({ wireVersion: "1.0", capabilities: [...REQUIRED_CAPABILITIES] }).capabilities).not.toContain(PROVIDER_SELECTION_CAPABILITY);
  expect(wireMetadataParser.parse({ wireVersion: "1.0", capabilities: [...REQUIRED_CAPABILITIES, PROVIDER_SELECTION_CAPABILITY] }).capabilities).toContain("provider-selection");
  const start = { type: "session.start", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  expect(streamControlParser.parse(start)).toEqual(start);
  expect(streamControlParser.parse({ ...start, provider: "fictional", model: "fictional/audio-model" })).toMatchObject({ provider: "fictional", model: "fictional/audio-model" });
});

test("malformed and oversized catalogs fail with fixed errors without retaining upstream configuration", async () => {
  for (const response of [null, { providers: [null] },
    { providers: Array.from({ length: 17 }, (_, index) => ({ ...catalog.providers[0], id: `fictional-${index}` })) },
    { providers: [{ ...catalog.providers[0], models: Array.from({ length: 65 }, (_, index) => `fictional-${index}`), defaultModel: undefined, modelDetails: undefined }] },
    { ...catalog, defaultProvider: "fictional\n" }, { providers: [{ ...catalog.providers[0], ready: "hidden-fictional" }] }]) {
    await expect(fixture(response).client.providers()).rejects.toMatchObject({ code: "invalid_response" });
  }
});

test("catalog bounds match native discovery while preserving the existing streaming model contract", () => {
  const provider = catalog.providers[0]!;
  expect(providersResponseParser.safeParse({ providers: Array.from({ length: 16 }, (_, index) => ({ ...provider, id: `fictional-${index}` })) }).success).toBe(true);
  expect(providersResponseParser.safeParse({ providers: [{ ...provider, models: Array.from({ length: 64 }, (_, index) => `fictional-${index}`), defaultModel: undefined, modelDetails: undefined }] }).success).toBe(true);
  for (const value of [{ ...provider, cancellation: false }, { ...provider, formats: [{ ...provider.formats[0], sampleRateHz: 48_000 }] },
    { ...provider, name: "a".repeat(121) }, { ...provider, name: "Fictional\u202e" },
    { ...provider, models: ["fictional model"], defaultModel: undefined, modelDetails: undefined },
    { ...provider, models: ["é-model"], defaultModel: undefined, modelDetails: undefined }]) {
    expect(providersResponseParser.safeParse({ providers: [value] }).success).toBe(false);
  }
  const start = { type: "session.start", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", model: "legacy model" };
  expect(streamControlParser.parse(start)).toEqual(start);
});

test("catalogs refuse ambiguous selections, phantom defaults, incomplete details and unsafe labels", () => {
  const provider = catalog.providers[0]!, detail = provider.modelDetails![0]!;
  const invalidProviders = [{ ...provider, models: [], defaultModel: undefined, modelDetails: undefined }, { ...provider, formats: [] },
    { ...provider, models: [provider.models[0], provider.models[0]], modelDetails: undefined },
    { ...provider, defaultModel: "fictional-phantom" }, { ...provider, modelDetails: [] },
    { ...provider, models: [detail.id, "fictional-second"], modelDetails: [detail, detail] }, { ...provider, modelDetails: [{ ...detail, id: "fictional-phantom" }] },
    { ...provider, models: [...provider.models, "fictional-second"], modelDetails: [detail] },
    { ...provider, name: "   " }, { ...provider, name: "Fictional\u001b" },
    { ...provider, modelDetails: [{ ...detail, name: "   " }] }, { ...provider, modelDetails: [{ ...detail, name: "Fictional\u007f" }] },
    { ...provider, models: ["fictional\n"], defaultModel: undefined, modelDetails: undefined },
    { ...provider, models: ["   "], defaultModel: undefined, modelDetails: undefined }];
  for (const value of [{ providers: [] }, { ...catalog, providers: [provider, provider] },
    { ...catalog, defaultProvider: "fictional-phantom" }, ...invalidProviders.map(value => ({ providers: [value] }))]) {
    expect(providersResponseParser.safeParse(value)).toEqual({ success: false, error: { code: "invalid_contract" } });
  }
  const secondModel = { ...detail, id: "fictional-second" };
  expect(providersResponseParser.safeParse({ providers: [{ ...provider, models: [detail.id, secondModel.id], modelDetails: [secondModel, detail] }] }).success).toBe(true);
});

test("actual CLI parser exposes catalog reads and refuses request credential or provider overrides", async () => {
  const f = fixture(), output: string[] = [];
  const connection = ["--api-base", base, "--credential-env", "SELECTED_SESSION", "providers"];
  const options = { client: f.client, write: (value: string) => { output.push(value); } };
  expect(await runHostedCLI(connection, options)).toBe(0); expect(JSON.parse(output.pop()!)).toEqual(catalog);
  for (const args of [["--provider", "fictional"], ["--token", "fictional-hidden"], ["extra"]]) {
    expect(await runHostedCLI([...connection, ...args], options)).toBe(1);
    expect(output.pop()).not.toContain("fictional-hidden");
  }
  expect(f.calls()).toBe(1);
});

test("MCP discovery stays inert and provider tool refuses all request options before credentials", async () => {
  const f = fixture(), server = buildHostedServer(f.client), client = new Client({ name: "fictional-catalog", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  try {
    const { tools } = await client.listTools(), tool = tools.find(value => value.name === "recordings_hosted_providers")!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(f.credentials()).toBe(0); expect(f.calls()).toBe(0);
    for (const args of [{ apiBase: base }, { token: "fictional-hidden" }, { provider: "fictional" }]) {
      const result = await client.callTool({ name: tool.name, arguments: args });
      expect(result.isError).toBe(true); expect(f.calls()).toBe(0); expect(f.credentials()).toBe(0);
    }
    const result = await client.callTool({ name: tool.name, arguments: {} });
    expect(result.structuredContent).toEqual(catalog); expect(f.calls()).toBe(1);
  } finally { await client.close(); await server.close(); }
});

test("actual HTTP catalogs isolate simultaneous credentials and reject browser or routing overrides", async () => {
  const seen: string[] = [];
  const handler = buildHostedFetch({ apiBase: base, fetch: fakeFetch((url, init) => {
    const bearer = new Headers(init.headers).get("authorization")!; seen.push(bearer);
    expect(url.href).toBe(base + "providers");
    return Response.json({ ...catalog, providers: [{ ...catalog.providers[0], name: bearer.endsWith("A") ? "Catalog A" : "Catalog B" }] });
  }) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  const endpoint = `http://127.0.0.1:${server.port}/v1/providers`;
  try {
    const replies = await Promise.all(["A", "B"].map(name => fetch(endpoint, { headers: { authorization: "Bearer fictional-" + name } })));
    const bodies = await Promise.all(replies.map(reply => reply.json()));
    expect(bodies.map(body => body.providers[0].name)).toEqual(["Catalog A", "Catalog B"]);
    expect([...seen].sort()).toEqual(["Bearer fictional-A", "Bearer fictional-B"]);
    expect(replies.every(reply => reply.headers.get("cache-control") === "no-store")).toBe(true);
    for (const [suffix, init, status] of [["?provider=fictional", {}, 400], ["?apiBase=" + base, {}, 400],
      ["?limit=1", {}, 400], ["", { method: "POST" }, 405], ["", { method: "DELETE" }, 405],
      ["", { headers: { cookie: "fictional=value" } }, 403], ["", { headers: { origin: base } }, 403]] as const) {
      const headers = new Headers("headers" in init ? init.headers : {}); headers.set("authorization", "Bearer fictional-A");
      expect((await fetch(endpoint + suffix, { ...init, headers })).status).toBe(status);
    }
    expect((await fetch(endpoint)).status).toBe(401); expect(seen).toHaveLength(2);
  } finally { await server.stop(true); }
});

test("catalog failures and redirects never retry, follow provider origins or fall back locally", async () => {
  for (const status of [401, 403, 429, 500, 302]) {
    let calls = 0;
    const client = new HostedRecordingsClient({ apiBase: base, credentialProvider: () => "fictional-session",
      fetch: fakeFetch(() => { calls++; return new Response("hidden-fictional-body", { status, headers: { location: "https://fictional-provider.example.test" } }); }) });
    const operation = client.providers();
    await expect(operation).rejects.toBeInstanceOf(RecordingsSDKError);
    await operation.catch(error => { expect(String(error)).not.toContain("hidden-fictional"); });
    expect(calls).toBe(1);
  }
});
