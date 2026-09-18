import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleV1Request } from "./v1.js";

test("an authenticated key without a tenant cannot access any domain store", async () => {
  const signingSecret = "calendar-synthetic-boundary-test";
  const key = mintApiKey({ app: "calendar", scopes: ["calendar:*"], signingSecret });
  const verifier = verifyApiKey({ app: "calendar", signingSecret, keyStatus: async () => "active" });
  let storeCalls = 0;
  const req = new Request("https://calendar.example.test/v1/orgs", { headers: { "x-api-key": key.token } });
  const response = await handleV1Request(req, new URL(req.url), {
    getCloudVerifier: () => verifier,
    getCloudStore: (() => { storeCalls++; return { listOrgs: async () => [] }; }) as never,
  });
  expect(response?.status).toBe(403);
  expect(storeCalls).toBe(0);
});
