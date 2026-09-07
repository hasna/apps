import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import { resourceSpecForPath } from "./resources.js";
const signingSecret = crypto.randomUUID();
const client = {
  query: async () => ({ rows: [], rowCount: 0 }),
  many: async () => [],
  get: async () => null,
  one: async () => ({}),
  execute: async () => {},
} as TypedQueryClient;
function deps() {
  const store = selfScopedStore(client);
  let claims = 0;
  Object.assign(store, {
    claimDueScheduled: async () => {
      claims++;
      return [];
    },
  });
  return {
    d: {
      client,
      store,
      verifier: verifyApiKey({
        app: "emails",
        signingSecret,
        keyStatus: async () => "active",
      }),
      sender: {
        provider: "ses",
        send: async () => {
          throw new Error("No real sends in route fixture");
        },
      },
      migrations: [],
      version: "fixture",
      ...testAuthDeps(client, signingSecret),
    } as SelfHostedServiceDeps,
    claims: () => claims,
  };
}
function request(scopes: string[] | null, body: unknown = { limit: 1 }) {
  const token = scopes
    ? mintApiKey({ app: "emails", scopes, signingSecret }).token
    : null;
  return new Request("http://fixture/v1/scheduled/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-api-key": token } : {}),
    },
    body: JSON.stringify(body),
  });
}
test("scheduler requires authentication and operator authority before claiming work", async () => {
  const f = deps();
  expect((await handleSelfHostedRequest(f.d, request(null)))!.status).toBe(401);
  expect(
    (await handleSelfHostedRequest(f.d, request(["emails:write"])))!.status,
  ).toBe(403);
  expect(f.claims()).toBe(0);
  expect(resourceSpecForPath("scheduled")!.writeRequiresOperator).toBe(true);
});
test("operator executes bounded batch and invalid input claims nothing", async () => {
  const f = deps();
  expect(
    (await handleSelfHostedRequest(f.d, request(["emails:*"], { limit: 101 })))!
      .status,
  ).toBe(400);
  expect(f.claims()).toBe(0);
  const response = await handleSelfHostedRequest(f.d, request(["emails:*"]));
  expect(response!.status).toBe(200);
  expect(await response!.json()).toMatchObject({
    scheduled: { attempted: 0, sent: 0 },
    sequence_execution: "not_requested",
  });
  expect(f.claims()).toBe(1);
});
