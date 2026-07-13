import { beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spec } from "../fixtures.js";
import { handleRequest, type RouteDeps } from "../../src/http/routes.js";
import { InMemoryControlPlaneStore } from "../../src/http/store-memory.js";
import { MemoryBlobStore } from "../../src/http/blobstore.js";
import { SandboxesClient } from "../../src/sdk.js";
import { createMcpServer } from "../../src/mcp.js";
import type { AdapterId } from "../../src/http/store.js";

const BOOTSTRAP = "boot-secret-key";

async function makeDeps(): Promise<RouteDeps> {
  const store = new InMemoryControlPlaneStore();
  await store.migrate();
  return {
    store,
    blobStore: new MemoryBlobStore(),
    auth: { bootstrapKey: BOOTSTRAP },
    version: "test",
    liveAdapters: new Set<AdapterId>(),
  };
}

/** A fetch that routes straight into the in-process handler (no sockets). */
function localFetch(deps: RouteDeps): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handleRequest(new Request(url, init), deps);
  }) as typeof fetch;
}

describe("SDK client over /v1", () => {
  let deps: RouteDeps;
  beforeEach(async () => {
    deps = await makeDeps();
  });

  test("SDK: health, allocate (fake -> active), get, list, checkpoint round-trip", async () => {
    const client = new SandboxesClient({
      apiUrl: "http://sandboxes.test",
      apiKey: BOOTSTRAP,
      fetch: localFetch(deps),
    });
    const health = await client.health();
    expect(health.status).toBe("ok");

    const who = await client.whoami();
    expect(who.via).toBe("bootstrap");

    const { allocation } = await client.allocate({ adapter: "fake", spec: spec() });
    expect(allocation.state).toBe("active");

    const got = await client.getSandbox(allocation.allocation_id);
    expect(got.allocation.allocation_id).toBe(allocation.allocation_id);

    const list = await client.listSandboxes();
    expect(list.count).toBe(1);

    const { checkpoint } = await client.createCheckpoint(allocation.allocation_id, { label: "s1" });
    expect(checkpoint.allocation_id).toBe(allocation.allocation_id);
    const ckpts = await client.listCheckpoints(allocation.allocation_id);
    expect(ckpts.count).toBe(1);
  });

  test("SDK surfaces a typed error on cross-tenant / not-found (404)", async () => {
    const client = new SandboxesClient({ apiUrl: "http://sandboxes.test/v1", apiKey: BOOTSTRAP, fetch: localFetch(deps) });
    await expect(client.getSandbox("sbx_00000000000000000000000000000000")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  test("SDK apiUrl accepts a base with or without a trailing /v1", async () => {
    const withV1 = new SandboxesClient({ apiUrl: "http://sandboxes.test/v1", apiKey: BOOTSTRAP, fetch: localFetch(deps) });
    const withoutV1 = new SandboxesClient({ apiUrl: "http://sandboxes.test", apiKey: BOOTSTRAP, fetch: localFetch(deps) });
    expect((await withV1.health()).status).toBe("ok");
    expect((await withoutV1.health()).status).toBe("ok");
  });
});

describe("MCP server over /v1 (in-memory transport)", () => {
  let deps: RouteDeps;
  beforeEach(async () => {
    deps = await makeDeps();
  });

  test("lists tools and allocates via a tool call, tenant-scoped", async () => {
    const apiClient = new SandboxesClient({ apiUrl: "http://sandboxes.test", apiKey: BOOTSTRAP, fetch: localFetch(deps) });
    const server = createMcpServer(apiClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("sandboxes_allocate");
    expect(names).toContain("sandboxes_whoami");

    const allocated = await client.callTool({
      name: "sandboxes_allocate",
      arguments: { adapter: "fake", spec: spec() },
    });
    const content = allocated.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0]!.text) as { allocation: { state: string } };
    expect(payload.allocation.state).toBe("active");

    const listed = await client.callTool({ name: "sandboxes_list", arguments: {} });
    const listContent = listed.content as Array<{ type: string; text: string }>;
    const listPayload = JSON.parse(listContent[0]!.text) as { count: number };
    expect(listPayload.count).toBe(1);

    await client.close();
    await server.close();
  });

  test("MCP tool call surfaces isError on a not-found id", async () => {
    const apiClient = new SandboxesClient({ apiUrl: "http://sandboxes.test", apiKey: BOOTSTRAP, fetch: localFetch(deps) });
    const server = createMcpServer(apiClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "sandboxes_get",
      arguments: { allocation_id: "sbx_00000000000000000000000000000000" },
    });
    expect(result.isError).toBe(true);

    await client.close();
    await server.close();
  });
});
