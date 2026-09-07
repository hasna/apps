import { expect, it } from "bun:test";
import { buildManagedSenderResolver } from "./managed-provider-sender.js";
import type { SelfHostedSender } from "./sender.js";

const external: SelfHostedSender = { provider: "ses", send: async () => "external-fixture" };

it("uses fresh tenant provider material for each operation without ambient credential fields", async () => {
  let revision = 1;
  const reads: string[][] = [];
  const configs: NodeJS.ProcessEnv[] = [];
  const resolve = buildManagedSenderResolver(() => external, tenant => ({ read: async provider => {
    reads.push([tenant, provider]);
    return { credentials: { type: "resend", api_key: `synthetic-${revision}` }, revision, region: null };
  } }), config => {
    configs.push(config);
    return { provider: "resend", send: async () => String(config.RESEND_API_KEY) };
  });
  const first = await resolve("tenant-one", "provider-one");
  revision++;
  const second = await resolve("tenant-two", "provider-two");
  expect(first?.credentialSource).toBe("managed_envelope");
  expect(configs.map(config => config.RESEND_API_KEY)).toEqual(["synthetic-1", "synthetic-2"]);
  expect(Object.keys(configs[0]!).sort()).toEqual(["EMAILS_SEND_PROVIDER", "RESEND_API_KEY"]);
  expect(reads).toEqual([["tenant-one", "provider-one"], ["tenant-two", "provider-two"]]);
});

it("uses explicit external bindings only when no managed envelope exists", async () => {
  const resolve = buildManagedSenderResolver((tenant, provider) => tenant === "one" && provider === "p" ? external : null, () => ({read: async () => null}));
  expect(await resolve("one", "p")).toBe(external);
  expect(await resolve("two", "p")).toBeNull();
  let fallbackCalls = 0;
  const failed = buildManagedSenderResolver(() => { fallbackCalls++; return external; }, () => ({read: async () => { throw new Error("Synthetic KMS outage"); }}));
  await expect(failed("one", "p")).rejects.toThrow("Managed provider credentials could not be loaded");
  expect(fallbackCalls).toBe(0);
});

it("requires registered SES region and builds only scoped credential fields", async () => {
  let region: string | null = null;
  const configs: NodeJS.ProcessEnv[] = [];
  const resolve = buildManagedSenderResolver(() => external, () => ({read: async () => ({credentials: {type: "ses", access_key: "synthetic-access", secret_key: "synthetic-secret"}, revision: 1, region})}), config => {configs.push(config);return external;});
  await expect(resolve("one", "p")).rejects.toThrow("registered provider region");
  expect(configs).toHaveLength(0);
  region = "eu-west-1";
  expect((await resolve("one", "p"))?.credentialSource).toBe("managed_envelope");
  expect(Object.keys(configs[0]!).sort()).toEqual(["EMAILS_AWS_REGION", "EMAILS_SEND_PROVIDER", "EMAILS_SES_ACCESS_KEY_ID", "EMAILS_SES_SECRET_ACCESS_KEY"]);
});
