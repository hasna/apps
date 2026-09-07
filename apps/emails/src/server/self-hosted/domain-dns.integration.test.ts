import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  createPgPool,
  createQueryClient,
  MigrationLedger,
  type PoolQueryClient,
} from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations } from "./migrations.js";
import { EmailsSelfHostedStore, type TenantScopedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import {
  normalizeDomainDns,
  publishDomainDns,
  type DomainDnsInput,
} from "./domain-dns.js";
import type {
  BoundDnsClient,
  BoundDnsRecord,
  DomainDnsBinding,
} from "./domain-dns-provider.js";
import type { SelfHostedSender } from "./sender.js";
const url = process.env.EMAILS_TEST_POSTGRES_URL;
const tenant = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002";
let pool: ReturnType<typeof createPgPool>,
  client: PoolQueryClient,
  store: TenantScopedStore;
let input: DomainDnsInput,
  binding: DomainDnsBinding,
  env: NodeJS.ProcessEnv,
  sender: SelfHostedSender,
  cf: BoundDnsClient,
  records: BoundDnsRecord[],
  registered: boolean,
  verified: boolean,
  mailFromVerified: boolean,
  mailFrom: string | undefined;
let calls: {
  reads: number;
  registrations: number;
  mailFrom: number;
  batches: number;
  dnsReads: number;
};
const pgtest = test.skipIf(!url);
beforeAll(async () => {
  if (!url) return;
  pool = createPgPool({ connectionString: url, env: { PGSSLMODE: "disable" } });
  client = createQueryClient(pool);
  await client.execute(
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
  );
  await new MigrationLedger(client, emailsSelfHostedMigrations()).migrate();
  await client.execute(
    "INSERT INTO tenants(id,slug,name) VALUES($1,'dns-a','A'),($2,'dns-b','B') ON CONFLICT(id) DO NOTHING",
    [tenant, other],
  );
  store = new EmailsSelfHostedStore(client).forTenant(tenant);
}, 60_000);
beforeEach(async () => {
  if (!url) return;
  await client.execute(
    "TRUNCATE self_hosted_providers,domains,provisioning_jobs,provisioning_events CASCADE; DELETE FROM inbound_domain_routes; UPDATE tenants SET status='active'",
  );
  const provider = await store.createResource(
    resourceSpecForPath("providers")!,
    { name: "SES fixture", type: "ses", active: true },
  );
  input = normalizeDomainDns(
    { domain: "example.test", provider_id: provider.id },
    "provision_domain",
  );
  binding = {
    tenant_id: tenant,
    provider_id: input.provider_id,
    domain: input.domain,
    zone_id: "a".repeat(32),
    zone_name: "example.test",
    token_env: "FIXTURE_DNS_TOKEN",
    inbound_mx: "inbound-smtp.eu-west-1.amazonaws.com",
  };
  env = {
    EMAILS_DNS_BINDINGS: JSON.stringify([binding]),
    FIXTURE_DNS_TOKEN: crypto.randomUUID(),
  };
  registered = false;
  verified = false;
  mailFromVerified = false;
  mailFrom = undefined;
  records = [];
  calls = { reads: 0, registrations: 0, mailFrom: 0, batches: 0, dnsReads: 0 };
  sender = {
    provider: "ses",
    region: "eu-west-1",
    send: async () => {
      throw new Error("No real mail");
    },
    registerDomain: async () => {
      calls.registrations++;
      registered = true;
    },
    setMailFrom: async (_domain, subdomain) => {
      calls.mailFrom++;
      mailFrom = subdomain;
      return subdomain;
    },
    readDomainConnection: async () => {
      calls.reads++;
      return {
        registered,
        verified_for_sending: registered && verified,
        dns_tasks: registered
          ? [
              {
                type: "CNAME",
                name: "selector._domainkey.example.test",
                value: "selector.dkim.amazonses.com",
                purpose: "DKIM",
                status: verified ? "verified" : "pending",
              },
              ...(mailFrom
                ? [
                    {
                      type: "MX" as const,
                      name: mailFrom,
                      value: "feedback-smtp.eu-west-1.amazonses.com",
                      priority: 10,
                      purpose: "MAIL_FROM" as const,
                      status: mailFromVerified
                        ? ("verified" as const)
                        : ("pending" as const),
                    },
                    {
                      type: "TXT" as const,
                      name: mailFrom,
                      value: "v=spf1 include:amazonses.com ~all",
                      purpose: "SPF" as const,
                      status: mailFromVerified
                        ? ("verified" as const)
                        : ("pending" as const),
                    },
                  ]
                : []),
            ]
          : [],
      };
    },
  };
  cf = {
    getZone: async () => {
      calls.dnsReads++;
    },
    listRecords: async () => {
      calls.dnsReads++;
      return structuredClone(records);
    },
    applyBatch: async (plan) => {
      calls.batches++;
      records = records.filter(
        (record) => !plan.deletes.some((item) => item.id === record.id),
      );
      records.push(
        ...plan.creates.map((record) => ({
          ...record,
          id: crypto.randomUUID(),
        })),
      );
    },
  };
});
afterAll(async () => {
  if (url) await pool.end();
});
const run = (dry = false) =>
  publishDomainDns(
    store,
    tenant,
    input,
    dry,
    () => sender,
    env,
    "fixture-operator",
    () => cf,
  );
pgtest(
  "dry run resolves account references and exact bindings without provider calls or job writes",
  async () => {
    expect((await run(true)).job.status).toBe("planned");
    expect(calls).toEqual({
      reads: 0,
      registrations: 0,
      mailFrom: 0,
      batches: 0,
      dnsReads: 0,
    });
    expect(
      await client.one("SELECT count(*)::int n FROM provisioning_jobs"),
    ).toEqual({ n: 0 });
  },
);
pgtest(
  "provider DNS publication and fresh-client receipts remain pending until observed verification, without inbound route claims",
  async () => {
    const first = await run();
    expect(first.job).toMatchObject({
      status: "pending_verification",
      dns_published: true,
      verified_for_sending: false,
    });
    expect(calls.registrations).toBe(1);
    expect(calls.mailFrom).toBe(1);
    expect(calls.batches).toBe(1);
    expect(records.find((record) => record.type === "MX")).toMatchObject({
      priority: 10,
      content: "feedback-smtp.eu-west-1.amazonses.com",
    });
    expect(
      await new EmailsSelfHostedStore(client)
        .forTenant(tenant)
        .domainDnsJobs()
        .read(first.job.id!),
    ).toEqual(first);
    expect(
      await new EmailsSelfHostedStore(client)
        .forTenant(other)
        .domainDnsJobs()
        .read(first.job.id!),
    ).toBeNull();
    verified = true;
    expect((await run()).job).toMatchObject({
      status: "pending_verification",
      dns_published: true,
      verified_for_sending: false,
    });
    mailFromVerified = true;
    const second = await run();
    expect(second.job.status).toBe("verified");
    expect(calls.batches).toBe(1);
    expect(second.job.id).toBe(first.job.id);
    expect(await store.getDomainByName(input.domain)).toMatchObject({
      verified: true,
      cf_zone_id: binding.zone_id,
      mail_from_domain: "mail.example.test",
    });
    expect(
      await client.one("SELECT count(*)::int n FROM inbound_domain_routes"),
    ).toEqual({ n: 0 });
  },
);
pgtest(
  "foreign MX blocks before SES mutation, while explicit force replaces only root MX with the bound endpoint",
  async () => {
    input.add_mx = true;
    records = [
      {
        id: "old-mx",
        type: "MX",
        name: input.domain,
        content: "mail.other.test",
        priority: 1,
      },
      { id: "site", type: "A", name: input.domain, content: "192.0.2.1" },
    ];
    expect((await run()).job.status).toBe("blocked");
    expect(calls.registrations).toBe(0);
    expect(calls.batches).toBe(0);
    input.force_mx_switch = true;
    expect((await run()).job.dns_published).toBe(true);
    expect(records.some((record) => record.id === "old-mx")).toBe(false);
    expect(records.some((record) => record.id === "site")).toBe(true);
    expect(
      records.find(
        (record) => record.type === "MX" && record.name === input.domain,
      ),
    ).toMatchObject({ content: binding.inbound_mx, priority: 10 });
  },
);
pgtest(
  "uncertain DNS acceptance reconciles by readback and never blindly repeats a batch",
  async () => {
    const apply = cf.applyBatch;
    cf.applyBatch = async (plan) => {
      await apply(plan);
      throw new Error("reply lost");
    };
    const first = await run();
    expect(first.job).toMatchObject({
      status: "blocked",
      requires_reconciliation: true,
    });
    expect(calls.batches).toBe(1);
    const second = await run();
    expect(second.job).toMatchObject({
      status: "pending_verification",
      requires_reconciliation: false,
    });
    expect(calls.batches).toBe(1);
  },
);
pgtest(
  "an unconfirmed previous batch freezes its inputs and blocks further provider or DNS mutations",
  async () => {
    cf.applyBatch = async () => {
      calls.batches++;
      throw new Error("unknown acceptance");
    };
    expect((await run()).job.requires_reconciliation).toBe(true);
    const before = { ...calls };
    expect((await run()).job.status).toBe("blocked");
    expect(calls.batches).toBe(1);
    expect(calls.registrations).toBe(before.registrations);
    expect(calls.reads).toBe(before.reads);
    input.mail_from = "changed.example.test";
    await expect(run()).rejects.toThrow("original plan");
  },
);
pgtest(
  "changed bindings, suspended tenants and disabled providers fence subsequent writes",
  async () => {
    for (const mutation of ["binding", "tenant", "provider"] as const) {
      const read = sender.readDomainConnection!;
      sender.readDomainConnection = async (...args) => {
        const value = await read(...args);
        if (mutation === "binding")
          env.EMAILS_DNS_BINDINGS = JSON.stringify([
            { ...binding, zone_id: "b".repeat(32) },
          ]);
        if (mutation === "tenant")
          await client.execute(
            "UPDATE tenants SET status='suspended' WHERE id=$1",
            [tenant],
          );
        if (mutation === "provider")
          await client.execute(
            "UPDATE self_hosted_providers SET active=false WHERE id=$1",
            [input.provider_id],
          );
        return value;
      };
      expect((await run()).job.status).toBe("blocked");
      expect(calls.batches).toBe(0);
      expect(calls.mailFrom).toBe(0);
      expect(calls.registrations).toBe(0);
      sender.readDomainConnection = read;
      env.EMAILS_DNS_BINDINGS = JSON.stringify([binding]);
      await client.execute(
        "UPDATE tenants SET status='active'; UPDATE self_hosted_providers SET active=true",
      );
    }
  },
);
pgtest(
  "lease replacement fences stale completion and preserves the current receipt",
  async () => {
    const jobs = store.domainDnsJobs(),
      first = await jobs.claim(input, binding, "one");
    expect((await jobs.claim(input, binding, "two")).lease).toBeNull();
    await expect(
      jobs.claim({ ...input, mail_from: "other.example.test" }, binding, "two"),
    ).rejects.toThrow("different request");
    await client.execute(
      "UPDATE provisioning_jobs SET updated_at=now()-interval '3 minutes' WHERE id=$1",
      [first.id],
    );
    const second = await jobs.claim(input, binding, "two");
    expect(second.lease).not.toBe(first.lease);
    await expect(jobs.assertCurrent(first, "ses")).rejects.toThrow("lease");
    await jobs.assertCurrent(second, "ses");
  },
);
pgtest(
  "audit failure rolls back final registry promotion after DNS success and leaves a durable blocked receipt",
  async () => {
    verified = true;
    mailFromVerified = true;
    await client.execute(
      "CREATE FUNCTION reject_dns_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.detail_json->>'operation'='provision_domain' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_dns_audit BEFORE INSERT ON provisioning_events FOR EACH ROW EXECUTE FUNCTION reject_dns_audit()",
    );
    try {
      const result = await run();
      expect(result.job.status).toBe("blocked");
      expect(result.job.dns_published).toBe(true);
      expect(await store.getDomainByName(input.domain)).toMatchObject({
        verified: false,
        status: "pending",
      });
      expect(await store.domainDnsJobs().read(result.job.id!)).toEqual(result);
    } finally {
      await client.execute(
        "DROP TRIGGER reject_dns_audit ON provisioning_events; DROP FUNCTION reject_dns_audit()",
      );
    }
  },
);
