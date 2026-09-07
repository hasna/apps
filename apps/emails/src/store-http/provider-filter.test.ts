import { expect, it } from "bun:test";
import { createMessagesRepository } from "./messages.js";
import type { Transport } from "./wire.js";

it("does not silently query an older API without provider filtering", async () => {
  const paths: string[] = [];
  const transport = {
    safeBaseUrl: "http://127.0.0.1",
    request: async (_method: string, path: string) => {
      paths.push(path);
      return { status: 200, body: { paths: { "/v1/messages": { get: { parameters: [] } } } } };
    },
  } as unknown as Transport;
  await expect(createMessagesRepository(transport).listMessages({ provider_id: "alpha" })).rejects.toThrow("API needs an update");
  expect(paths).toEqual(["/openapi.json"]);
});
