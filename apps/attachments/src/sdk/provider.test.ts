import { expect, test } from "bun:test";
import { AttachmentsApiClient, type AttachmentsApiClientOptions } from "./generated";

test("an async SDK provider is deferred until each request and refreshes without exposing its value", async () => {
  let lookups = 0;
  const received: string[] = [];
  const values = ["fixture-first", "fixture-second"];
  const client = new AttachmentsApiClient({
    baseUrl: "https://attachments.example.test",
    apiKey: async () => values[lookups++]!,
    fetch: (async (_url, init) => {
      received.push(new Headers(init?.headers).get("x-api-key")!);
      return Response.json([]);
    }) as typeof fetch,
  });
  expect(lookups).toBe(0);
  await client.listAttachments();
  await client.listAttachments();
  expect(lookups).toBe(2);
  expect(received).toEqual(values);
  expect(JSON.stringify(client)).not.toContain(values[0]!);
});

for (const failure of ["reject", "empty", "malformed"] as const) {
  test(`a ${failure} async provider result cannot dispatch a request`, async () => {
    let requests = 0;
    const client = new AttachmentsApiClient({
      baseUrl: "https://attachments.example.test",
      apiKey: async () => {
        if (failure === "reject") throw new Error("Fixture lookup refused");
        return failure === "empty" ? "" : "fixture with whitespace";
      },
      fetch: (async () => { requests++; return Response.json([]); }) as typeof fetch,
    });
    await expect(client.listAttachments()).rejects.toThrow();
    expect(requests).toBe(0);
  });
}

test("authority mutation while the SDK provider is pending is refused", async () => {
  let requests = 0;
  const options: AttachmentsApiClientOptions = {
    baseUrl: "https://first.example.test",
    apiKey: async () => { options.baseUrl = "https://second.example.test"; return "fixture-key"; },
    fetch: (async () => { requests++; return Response.json([]); }) as typeof fetch,
  };
  const client = new AttachmentsApiClient(options);
  await expect(client.listAttachments()).rejects.toThrow(/authority changed/i);
  expect(requests).toBe(0);
});
