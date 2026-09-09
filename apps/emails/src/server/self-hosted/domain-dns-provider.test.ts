import { expect, test } from "bun:test";
import {
  buildDnsPlan,
  resolveDnsBinding,
  createBoundDnsClient,
} from "./domain-dns-provider.js";
import { sameDomainDnsSender } from "./domain-dns.js";

test("managed sender generations support fresh instances while changed credentials or external bindings are fenced", () => {
  const binding = {
    provider: "ses",
    region: "eu-west-1",
    credentialSource: "managed_envelope",
    credentialRevision: 7,
  };
  expect(sameDomainDnsSender(binding, { ...binding })).toBe(true);
  for (const change of [
    { credentialRevision: 8 },
    { credentialRevision: undefined },
    { provider: "resend" },
    { region: "eu-west-2" },
    { credentialSource: "environment" },
  ])
    expect(sameDomainDnsSender(binding, { ...binding, ...change })).toBe(false);
  const external = { provider: "ses", credentialSource: "environment" };
  expect(sameDomainDnsSender(external, external)).toBe(true);
  expect(sameDomainDnsSender(external, { ...external })).toBe(false);
});

const binding = {
  tenant_id: "00000000-0000-0000-0000-000000000001",
  provider_id: "provider",
  domain: "example.test",
  zone_id: "a".repeat(32),
  zone_name: "example.test",
  token_env: "FIXTURE_DNS_TOKEN",
  inbound_mx: "inbound-smtp.eu-west-1.amazonaws.com",
};
const task = {
  type: "CNAME" as const,
  name: "selector._domainkey.example.test",
  value: "selector.dkim.amazonses.com",
  purpose: "DKIM" as const,
  status: "pending" as const,
};
const old = (
  id: string,
  type: string,
  name: string,
  content: string,
  priority?: number,
) => ({
  id,
  type,
  name,
  content,
  ...(priority === undefined ? {} : { priority }),
});
test("server DNS bindings are exact tenant/provider/domain references without client credentials", () => {
  const env = {
    EMAILS_DNS_BINDINGS: JSON.stringify([binding]),
    FIXTURE_DNS_TOKEN: crypto.randomUUID(),
  };
  expect(
    resolveDnsBinding(env, binding.tenant_id, "provider", "example.test"),
  ).toEqual(binding);
  for (const [tenant, provider, domain] of [
    ["foreign", "provider", "example.test"],
    [binding.tenant_id, "foreign", "example.test"],
    [binding.tenant_id, "provider", "foreign.test"],
  ])
    expect(() => resolveDnsBinding(env, tenant!, provider!, domain!)).toThrow();
  expect(() =>
    resolveDnsBinding(
      {
        ...env,
        EMAILS_DNS_BINDINGS: JSON.stringify([
          { ...binding, token: "client-token" },
        ]),
      },
      binding.tenant_id,
      "provider",
      "example.test",
    ),
  ).toThrow();
});
test("DNS plans preserve unrelated records and exact DKIM while refusing conflicting SPF and foreign names", () => {
  const records = [
    old("dkim", "CNAME", task.name, task.value + "."),
    old("site", "A", "example.test", "192.0.2.1"),
  ];
  expect(buildDnsPlan(binding, [task], records, false, false)).toMatchObject({
    creates: [],
    deletes: [],
  });
  expect(() =>
    buildDnsPlan(
      binding,
      [{ ...task, name: "selector._domainkey.foreign.test" }],
      [],
      false,
      false,
    ),
  ).toThrow();
  const spf = {
    type: "TXT" as const,
    name: "mail.example.test",
    value: "v=spf1 include:amazonses.com ~all",
    purpose: "SPF" as const,
    status: "pending" as const,
  };
  expect(() =>
    buildDnsPlan(
      binding,
      [task, spf],
      [old("spf", "TXT", spf.name, "v=spf1 include:other.test -all")],
      false,
      false,
    ),
  ).toThrow();
});
test("root MX replacement requires explicit force and the exact bound target, preserving priorities", () => {
  const records = [
    old("foreign-mx", "MX", "example.test", "mail.other.test", 1),
    old("site", "A", "example.test", "192.0.2.1"),
  ];
  expect(() => buildDnsPlan(binding, [task], records, true, false)).toThrow();
  const plan = buildDnsPlan(binding, [task], records, true, true);
  expect(plan.deletes).toEqual([{ id: "foreign-mx" }]);
  expect(plan.creates).toContainEqual({
    type: "MX",
    name: "example.test",
    content: binding.inbound_mx,
    priority: 10,
    ttl: 300,
  });
  expect(() =>
    buildDnsPlan(
      { ...binding, inbound_mx: undefined },
      [task],
      records,
      true,
      true,
    ),
  ).toThrow();
});
test("Cloudflare client pins origin, rejects redirects, paginates completely and bounds record batches", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [],
    token = crypto.randomUUID(),
    signal = AbortSignal.timeout(1000);
  const client = createBoundDnsClient(
    binding,
    { FIXTURE_DNS_TOKEN: token },
    signal,
    (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });
      expect(url.origin).toBe("https://api.cloudflare.com");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBe(signal);
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
      if (url.pathname.endsWith("/batch"))
        return Response.json({ success: true, result: {} });
      if (url.pathname.endsWith("/dns_records")) {
        const page = Number(url.searchParams.get("page"));
        return Response.json({
          success: true,
          result: [
            old(String(page), "TXT", `r${page}.example.test`, "fixture"),
          ],
          result_info: { page, per_page: 100, total_pages: 2 },
        });
      }
      return Response.json({
        success: true,
        result: {
          id: binding.zone_id,
          name: binding.zone_name,
          status: "active",
        },
      });
    }) as typeof fetch,
  );
  await client.getZone();
  expect(await client.listRecords()).toHaveLength(2);
  await client.applyBatch(buildDnsPlan(binding, [task], [], false, false));
  expect(calls).toHaveLength(4);
});

test("DNS client refuses malformed, incomplete and oversized evidence without exposing provider error text", async () => {
  const make = (response: Response) =>
    createBoundDnsClient(
      binding,
      { FIXTURE_DNS_TOKEN: crypto.randomUUID() },
      AbortSignal.timeout(1000),
      (async () => response) as typeof fetch,
    );
  for (const response of [
    Response.json({
      success: true,
      result: [],
      result_info: { page: 2, total_pages: 2 },
    }),
    Response.json({
      success: true,
      result: [
        old("same", "TXT", "example.test", "a"),
        old("same", "TXT", "example.test", "b"),
      ],
      result_info: { page: 1, total_pages: 1 },
    }),
    new Response("x".repeat(2 * 1048576 + 1)),
    Response.json({
      success: false,
      errors: [{ message: "PRIVATE_PROVIDER_DETAIL" }],
    }),
    new Response(null, {
      status: 302,
      headers: { Location: "https://foreign.example.test" },
    }),
  ])
    await expect(make(response).listRecords()).rejects.toThrow();
  try {
    await make(
      Response.json({
        success: false,
        errors: [{ message: "PRIVATE_PROVIDER_DETAIL" }],
      }),
    ).listRecords();
    throw new Error("Expected provider refusal");
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  }
  const client = make(Response.json({ success: true, result: {} }));
  await expect(
    client.applyBatch({
      creates: [],
      deletes: Array.from({ length: 201 }, (_, id) => ({ id: String(id) })),
      existing: [],
    }),
  ).rejects.toThrow("batch limit");
});
