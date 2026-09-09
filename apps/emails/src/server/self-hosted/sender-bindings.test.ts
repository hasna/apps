import { expect, it } from "bun:test";
import { buildSenderResolver, type SelfHostedSender } from "./sender.js";
const fallback: SelfHostedSender = { provider: "ses", send: async () => { throw new Error("no real sends in tests"); } };
it("binds the default sender only to the explicitly configured tenant/provider", () => {
  const resolve = buildSenderResolver(fallback, { EMAILS_SENDER_BINDINGS: JSON.stringify([{ tenant_id: "one", provider_id: "p1", sender: "default" }]) });
  expect(resolve("one", "p1")).toBe(fallback);
  expect(resolve("two", "p1")).toBeNull();
  expect(resolve("one", "p2")).toBeNull();
});
it("builds distinct senders from server-only credential references", () => {
  const configs: NodeJS.ProcessEnv[] = [];
  const resolve = buildSenderResolver(fallback, {
    EMAILS_SENDER_BINDINGS: JSON.stringify([
      { tenant_id: "one", provider_id: "r1", type: "resend", api_key_env: "TEST_RESEND_A" },
      { tenant_id: "one", provider_id: "r2", type: "resend", api_key_env: "TEST_RESEND_B" },
    ]),
    TEST_RESEND_A: crypto.randomUUID(), TEST_RESEND_B: crypto.randomUUID(),
  }, (config) => { configs.push(config); return { provider: "resend", send: async () => "fixture" }; });
  expect(resolve("one", "r1")).not.toBe(resolve("one", "r2"));
  expect(configs).toHaveLength(2);
  expect(configs[0]?.RESEND_API_KEY === configs[1]?.RESEND_API_KEY).toBe(false);
  expect(Object.keys(configs[0]!).sort()).toEqual(["EMAILS_SEND_PROVIDER", "RESEND_API_KEY"]);
});
it("fails boot for missing references, literal credentials, or duplicate bindings", () => {
  const bind = (entries: unknown[]) => () => buildSenderResolver(fallback, { EMAILS_SENDER_BINDINGS: JSON.stringify(entries) });
  expect(bind([{ tenant_id: "t", provider_id: "p", type: "resend", api_key_env: "MISSING_REF" }])).toThrow("MISSING_REF is not set");
  expect(bind([{ tenant_id: "t", provider_id: "p", type: "resend", api_key: crypto.randomUUID() }])).toThrow("environment names only");
  expect(bind([{ tenant_id: "t", provider_id: "p", sender: "default" }, { tenant_id: "t", provider_id: "p", sender: "default" }])).toThrow("Duplicate");
});
