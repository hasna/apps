import { expect, test } from "bun:test";
import { normalizeSendMetadata } from "./send-metadata.js";
test("normalizes safe metadata and preserves absent metadata identity", () => {
  expect(normalizeSendMetadata(undefined, undefined)).toEqual({});
  expect(normalizeSendMetadata({}, {})).toEqual({});
  expect(normalizeSendMetadata({ "X-Campaign": "Spring" }, { campaign: "spring" })).toEqual({ headers: { "x-campaign": "Spring" }, tags: { campaign: "spring" } });
});
test("refuses authority headers, case collisions, controls and unbounded metadata", () => {
  for (const name of ["From", "To", "Bcc", "Content-Type", "List-Unsubscribe", "X-Hasna-Forwarded-For", "X-SES-SOURCE-ARN", "X-Resend-Idempotency-Key", "X-Emails-Send-Key", "X-Tracking-Id", "X-Auth-Token", "X-Api-Key", "X-Access-Token", "X-Session-Token", "X-Test\r\nBcc"]) expect(() => normalizeSendMetadata({ [name]: "fixture" }, undefined)).toThrow();
  for (const headers of [{ "X-Test": "a", "x-test": "b" }, { "X-Test": "bad\r\nvalue" }, { "X-Test": "bad\0value" }, { "X-Test": "a".repeat(901) }, Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-Fixture-${i}`, "x"]))]) expect(() => normalizeSendMetadata(headers, undefined)).toThrow();
  for (const tags of [null, [], { bad: "with space" }, { ["k".repeat(257)]: "x" }, { valid: 1 }, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`tag${i}`, "x"]))]) expect(() => normalizeSendMetadata(undefined, tags)).toThrow();
});

test("publishes metadata inputs only on implemented send and enqueue routes", async () => {
  const { emailsSelfHostedOpenApi } = await import("../server/self-hosted/openapi.js");
  const properties = (path: string) => (emailsSelfHostedOpenApi.paths![path]!.post as any).requestBody.content["application/json"].schema.properties;
  for (const path of ["/v1/messages/send", "/v1/scheduled/enqueue"]) {
    expect(properties(path).tags).toBeDefined();
    expect(properties(path).headers).toBeDefined();
  }
  for (const path of ["/v1/messages", "/v1/messages/record"]) expect(properties(path).tags).toBeUndefined();
});
