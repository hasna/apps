import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createHasnaHttpTransport, HasnaHttpError } from "@hasna/contracts/client";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { ApiStore } from "./api-store.js";

async function withApi(body: unknown, status: number, run: (store: ApiStore, requests: URL[]) => Promise<void>) {
  const key = randomUUID();
  const requests: URL[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    if (req.headers.get("x-api-key") !== key) return new Response(null, { status: 401 });
    requests.push(new URL(req.url));
    return Response.json(body, { status });
  } });
  try {
    const transport = createHasnaHttpTransport({ name: "conversations", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: key, retry: false });
    await run(new ApiStore(createHasnaStorageClient("conversations", transport)), requests);
  } finally { server.stop(true); }
}

test("API preview reads preserve newest selection and chronological presentation only for implicit order", async () => {
  const messages = [3,2,1].map(id => ({ id, preview: `fixture-${id}` }));
  await withApi({ messages, has_more: true, next_cursor: 3, count: 3 }, 200, async (store, requests) => {
    const page = await store.readMessagePreviews({ limit: 3 });
    expect(page.messages.map(m=>m.id)).toEqual([1,2,3]);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(3);
    expect(requests[0]!.searchParams.get("order")).toBe("desc");
    const descending = await store.readMessagePreviews({ limit: 3, order: "desc" });
    expect(descending.messages.map(m=>m.id)).toEqual([3,2,1]);
  });
});

test("recognized sensitive-content response becomes a fixed value-free diagnostic retaining HTTP status", async () => {
  const marker = randomUUID();
  await withApi({error: `Message content blocked: sensitive content detected (${marker}). Remove secrets before sending.`}, 400, async store => {
    try { await store.sendMessage({from:"alice",to:"fixture",content:"ordinary synthetic body",channel:"fixture"}); throw new Error("expected refusal"); }
    catch(error) {
      expect(error).toBeInstanceOf(HasnaHttpError);
      expect((error as HasnaHttpError).status).toBe(400);
      expect((error as Error).message).toContain("sensitive content detected");
      expect(JSON.stringify(error)).not.toContain(marker);
      expect((error as HasnaHttpError).body).toMatchObject({code:"SENSITIVE_CONTENT"});
    }
  });
});

for (const status of [400,401,403]) test(`unrecognized ${status} response never promotes arbitrary body to display text`, async () => {
  const marker = randomUUID();
  await withApi({error: `arbitrary response ${marker}`}, status, async store => {
    try { await store.sendMessage({from:"alice",to:"fixture",content:"ordinary synthetic body",channel:"fixture"}); throw new Error("expected refusal"); }
    catch(error) {
      expect((error as HasnaHttpError).status).toBe(status);
      expect((error as Error).message).not.toContain(marker);
      expect((error as Error).message).not.toContain("sensitive content detected");
    }
  });
});

test("project conflict displays fixed diagnostic without reflecting response text", async () => {
  const marker = randomUUID();
  await withApi({error: marker},409,async store=> {
    try { await store.createProject({name:"fixture",created_by:"alice"}); throw new Error("expected refusal"); }
    catch(error) {
      expect((error as HasnaHttpError).status).toBe(409);
      expect((error as Error).message).toBe("Project name already exists");
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });
});

test("raw sensitive channel is rejected before an HTTP request can normalize or reflect it", async () => {
  await withApi({error:"unexpected request"},400,async (store,requests)=> {
    const channel=["postgres","://","fixture-user:fixture-password","@example.invalid/app"].join("");
    await expect(store.sendMessage({from:"alice",to:"fixture",content:"ordinary content",channel})).rejects.toThrow("sensitive content detected");
    expect(requests).toHaveLength(0);
  });
});
