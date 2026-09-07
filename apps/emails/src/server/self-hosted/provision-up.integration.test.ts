import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import {
  createPgPool,
  createQueryClient,
  MigrationLedger,
  type PoolQueryClient,
} from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations, DEFAULT_TENANT_ID } from "./migrations.js";
import { EmailsSelfHostedStore, type TenantScopedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "./service.js";
import { testAuthDeps } from "./auth/test-support.js";
import {
  normalizeProvisionUp,
  newProvisionUpReceipt,
  type BoundProvisionUpInput,
} from "./provision-up.js";
import type { BoundDnsRecord, DomainDnsPlan } from "./domain-dns-provider.js";
import type { SelfHostedSender } from "./sender.js";
const url = process.env.EMAILS_TEST_POSTGRES_URL,
  pgtest = test.skipIf(!url),
  tenant = DEFAULT_TENANT_ID,
  other = "00000000-0000-0000-0000-000000000002";
const role = `up_rls_${crypto.randomUUID().replaceAll("-", "")}`;
let pool: ReturnType<typeof createPgPool>,
  client: PoolQueryClient,
  base: EmailsSelfHostedStore,
  store: TenantScopedStore,
  deps: SelfHostedServiceDeps,
  input: BoundProvisionUpInput,
  token: string,
  secret: string,
  sender: SelfHostedSender;
let records: BoundDnsRecord[], sendCalls: number, uncertain: boolean;
beforeAll(async () => {
  if (!url) return;
  pool = createPgPool({ connectionString: url, env: { PGSSLMODE: "disable" } });
  client = createQueryClient(pool);
  await client.execute(
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
  );
  await new MigrationLedger(client, emailsSelfHostedMigrations()).migrate();
  await client.execute(
    "INSERT INTO tenants(id,slug,name) VALUES($1,'up-a','A'),($2,'up-b','B') ON CONFLICT(id) DO NOTHING",
    [tenant, other],
  );
  await client.execute(
    `CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON provisioning_jobs TO "${role}"`,
  );
  base = new EmailsSelfHostedStore(client);
  store = base.forTenant(tenant);
}, 60000);
beforeEach(async () => {
  if (!url) return;
  base = new EmailsSelfHostedStore(client);
  store = base.forTenant(tenant);
  await client.execute(
    "TRUNCATE self_hosted_providers,domains,addresses,owners,provisioning_jobs,provisioning_events,address_ownership_events,messages CASCADE; DELETE FROM inbound_domain_routes; UPDATE tenants SET status='active'",
  );
  const provider = await store.createResource(
    resourceSpecForPath("providers")!,
    { name: "Fixture", type: "ses", region: "eu-west-1", active: true },
  );
  await store.createDomain({
    domain: "example.test",
    provider: provider.id as string,
    status: "verified",
    verified: true,
  });
  input = {
    ...normalizeProvisionUp({
      domain: "example.test",
      provider_id: provider.id,
      addresses: "one,two",
      count: 0,
    }),
    provider_type: "ses",
    provider_region: "eu-west-1",
    dns_binding: {
      tenant_id: tenant,
      provider_id: provider.id as string,
      domain: "example.test",
      zone_id: "a".repeat(32),
      zone_name: "example.test",
      token_env: "FIXTURE_DNS_TOKEN",
    },
  };
  records = [];
  sendCalls = 0;
  uncertain = false;
  sender = {
    provider: "ses",
    region: "eu-west-1",
    registerDomain: async () => {},
    setMailFrom: async () => "mail.example.test",
    readDomainConnection: async () => ({
      registered: true,
      verified_for_sending: true,
      dns_tasks: [
        {
          type: "CNAME",
          name: "selector._domainkey.example.test",
          value: "selector.dkim.amazonses.com",
          purpose: "DKIM",
          status: "verified",
        },
        {
          type: "MX",
          name: "mail.example.test",
          value: "feedback-smtp.eu-west-1.amazonses.com",
          priority: 10,
          purpose: "MAIL_FROM",
          status: "verified",
        },
        {
          type: "TXT",
          name: "mail.example.test",
          value: "v=spf1 include:amazonses.com ~all",
          purpose: "SPF",
          status: "verified",
        },
      ],
    }),
    verifyDomain: async () => ({
      verifiedForSending: true,
      dkim: "verified",
      spf: "verified",
      dmarc: "pending",
    }),
    checkInboundDomain: async () => ({
      ready: true,
      reason: "fixture",
      topicArn: "fixture-topic",
    }),
    checkInboundQueue: async () => ({ ready: true, reason: "fixture" }),
    send: async (message, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      sendCalls++;
      if (uncertain)
        throw new DOMException("fixture deadline interrupted", "AbortError");
      await store.createMessage({
        direction: "inbound",
        from_addr: message.from,
        to_addrs: message.to,
        subject: message.subject,
        body_text: message.text ?? "",
        provider: "ses",
        provider_id: input.provider_id,
      });
      return `fixture-send-${sendCalls}`;
    },
  };
  secret = crypto.randomUUID();
  token = mintApiKey({
    app: "emails",
    scopes: ["emails:*"],
    signingSecret: secret,
  }).token;
  deps = {
    client,
    store: base,
    sender,
    resolveSender: () => sender,
    verifier: verifyApiKey({
      app: "emails",
      signingSecret: secret,
      keyStatus: async () => "active",
    }),
    migrations: [],
    version: "fixture",
    ...testAuthDeps(client, secret),
    env: {
      EMAILS_DNS_BINDINGS: JSON.stringify([input.dns_binding]),
      FIXTURE_DNS_TOKEN: crypto.randomUUID(),
      EMAILS_INGEST_S3_BUCKET: "fixture-bucket",
      EMAILS_INGEST_QUEUE_URL: "fixture-queue",
    },
    provisioning: {
      resolveMx: async () => [
        { exchange: "inbound-smtp.eu-west-1.amazonaws.com", priority: 10 },
      ],
    },
    domainDns: {
      client: () => ({
        getZone: async () => {},
        listRecords: async () => records,
        applyBatch: async (plan: DomainDnsPlan) => {
          records.push(
            ...plan.creates.map((record, index) => ({
              ...record,
              id: `dns-${index}`,
            })),
          );
          return;
        },
      }),
    },
  } as unknown as SelfHostedServiceDeps;
});
afterAll(async () => {
  if (url) {
    await client.execute(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    await pool.end();
  }
});
async function api(
  path: string,
  body?: Record<string, unknown>,
  selected = token,
) {
  const response = await handleSelfHostedRequest(
    deps,
    new Request(`http://fixture.test${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${selected}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: response!.status, body: (await response!.json()) as any };
}
async function start(count = 0) {
  const response = await api("/v1/provision/up", {
    domain: input.domain,
    provider_id: input.provider_id,
    addresses: "one,two",
    count,
  });
  expect(response.status).toBe(200);
  return response.body.job;
}
async function drive(id: string, limit = 30) {
  let job: any;
  for (let step = 0; step < limit; step++) {
    await client.execute(
      "UPDATE provisioning_jobs SET receipt=jsonb_set(receipt,'{next_attempt_ms}','0') WHERE id=$1",
      [id],
    );
    const result = await api(`/v1/provision/runs/${id}/run`, {});
    expect(result.status).toBe(200);
    job = result.body.job;
    if (["ready", "blocked"].includes(job.status)) break;
  }
  return job;
}
pgtest(
  "actual handler freezes one identity across fresh clients; scoped keys cannot authorize it",
  async () => {
    const first = await start(),
      second = await start();
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("pending");
    expect(first).not.toHaveProperty("lease");
    expect(JSON.stringify(first)).not.toContain("token_env");
    expect(
      await client.one("SELECT count(*)::int AS n FROM provisioning_jobs"),
    ).toEqual({ n: 1 });
    const changed = await api("/v1/provision/up", {
      domain: input.domain,
      provider_id: input.provider_id,
      addresses: "one,three",
      count: 0,
    });
    expect(changed.status).toBe(409);
    const scoped = mintApiKey({
      app: "emails",
      scopes: ["emails:write", "emails:read"],
      signingSecret: secret,
    }).token;
    for (const [path, body] of [
      [
        "/v1/provision/up",
        { domain: input.domain, provider_id: input.provider_id },
      ],
      ["/v1/provision/tick", { provider_id: input.provider_id }],
      ["/v1/provision/retry", { domain: input.domain }],
      [`/v1/provision/runs/${first.id}`, undefined],
    ] as const)
      expect((await api(path, body, scoped)).status).toBe(403);
    expect(sendCalls).toBe(0);
  },
);
pgtest(
  "atomic claims and fenced saves reject concurrent and expired workers",
  async () => {
    const job = await start(),
      jobs = store.provisionUpJobs(),
      claims = await Promise.all([jobs.claim(job.id), jobs.claim(job.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    await client.execute(
      "UPDATE provisioning_jobs SET updated_at=now()-interval '3 minutes' WHERE id=$1",
      [job.id],
    );
    const current = await jobs.claim(job.id);
    expect(current!.lease).not.toBe(old.lease);
    await expect(jobs.save(old, old.receipt!, "ready")).rejects.toThrow(
      "lease",
    );
    expect((await jobs.get(job.id))!.lease).toBe(current!.lease);
  },
);
pgtest(
  "retry retains receipts, identities and errors; completed runs do not send again",
  async () => {
    const job = await start(1),
      jobs = store.provisionUpJobs(),
      claim = (await jobs.claim(job.id))!,
      receipt = newProvisionUpReceipt(claim.input, claim.id);
    receipt.roundtrip.items[0]!.state = "received";
    receipt.errors = [{ code: "old_failure", at: "fixture" }];
    await jobs.save(claim, receipt, "blocked");
    const resumed = await jobs.retry(input.domain, input.provider_id, job.id);
    expect(resumed.receipt!.roundtrip.items).toEqual(receipt.roundtrip.items);
    expect(resumed.receipt!.errors).toEqual(receipt.errors);
    expect(resumed.status).toBe("pending");
    await jobs.start(input, "explicit-second", "fixture");
    await expect(jobs.retry(input.domain)).rejects.toThrow("Multiple");
  },
);
pgtest(
  "binding and tenant changes fence checkpoints and disabled domains cannot be started",
  async () => {
    const jobs = store.provisionUpJobs(),
      job = await start(),
      claim = (await jobs.claim(job.id))!;
    await client.execute(
      "UPDATE self_hosted_providers SET region='us-east-1' WHERE id=$1",
      [input.provider_id],
    );
    await expect(jobs.save(claim, claim.receipt!, "ready")).rejects.toThrow(
      "binding changed",
    );
    await client.execute(
      "UPDATE self_hosted_providers SET region='eu-west-1' WHERE id=$1",
      [input.provider_id],
    );
    await client.execute("UPDATE tenants SET status='suspended' WHERE id=$1", [
      tenant,
    ]);
    await expect(jobs.assertCurrent(claim)).rejects.toThrow("account");
    await client.execute("UPDATE tenants SET status='active' WHERE id=$1", [
      tenant,
    ]);
    await client.execute(
      "UPDATE domains SET status='outbound_disabled' WHERE domain='example.test'",
    );
    expect(
      (
        await api("/v1/provision/up", {
          domain: input.domain,
          provider_id: input.provider_id,
        })
      ).status,
    ).toBe(409);
  },
);
pgtest(
  "RLS and tenant predicates isolate saved runs and daemon selection excludes blocked intents",
  async () => {
    const job = await start(),
      jobs = store.provisionUpJobs();
    expect(
      await base.forTenant(other).provisionUpJobs().get(job.id),
    ).toBeNull();
    expect(
      await base.forTenant(other).provisionUpJobs().claim(job.id),
    ).toBeNull();
    await client.transaction(async (tx) => {
      await tx.execute(`SET LOCAL ROLE "${role}"`);
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [
        other,
      ]);
      expect(await tx.many("SELECT id FROM provisioning_jobs")).toEqual([]);
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [
        tenant,
      ]);
      expect(await tx.many("SELECT id FROM provisioning_jobs")).toEqual([
        { id: job.id },
      ]);
    });
    expect(await jobs.due(input.provider_id, { add_mx: true })).toEqual([]);
    const claim = (await jobs.claim(job.id))!;
    await jobs.save(claim, claim.receipt!, "blocked");
    expect(await jobs.due(input.provider_id)).toEqual([]);
  },
);
pgtest(
  "actual DNS and address steps complete without claiming delivery when tests are skipped",
  async () => {
    const job = await start(),
      done = await drive(job.id);
    expect(done.status, JSON.stringify(done.receipt)).toBe("ready");
    expect(done.receipt).toMatchObject({
      complete: true,
      delivery_tested: false,
      phase: "complete",
    });
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 2 });
    expect(sendCalls).toBe(0);
    expect(
      (
        await api("/v1/provision/retry", {
          domain: input.domain,
          job_id: job.id,
        })
      ).body.job.status,
    ).toBe("ready");
    expect(
      (await api("/v1/provision/tick", { provider_id: input.provider_id })).body
        .advanced,
    ).toBe(0);
  },
);
pgtest(
  "actual normal send route accepts confirmed 202 and receipts survive worker restarts",
  async () => {
    const job = await start(1),
      done = await drive(job.id);
    expect(done.status, JSON.stringify(done.receipt)).toBe("ready");
    expect(done.receipt.delivery_tested).toBe(true);
    expect(
      done.receipt.roundtrip.items.every(
        (row: any) => row.state === "received",
      ),
    ).toBe(true);
    expect(sendCalls).toBe(2);
    await drive(job.id, 1);
    expect(sendCalls).toBe(2);
  },
);
pgtest(
  "uncertain provider acceptance blocks successors and retry never calls the provider with a new identity",
  async () => {
    uncertain = true;
    const job = await start(1),
      blocked = await drive(job.id);
    expect(blocked.status).toBe("blocked");
    expect(sendCalls).toBe(1);
    const keys = blocked.receipt.roundtrip.items.map(
      (row: any) => row.send_key,
    );
    expect(blocked.receipt.roundtrip.items[1].state).toBe("not_attempted");
    await api("/v1/provision/retry", { domain: input.domain, job_id: job.id });
    const again = await drive(job.id);
    expect(again.status).toBe("blocked");
    expect(
      again.receipt.roundtrip.items.map((row: any) => row.send_key),
    ).toEqual(keys);
    expect(sendCalls).toBe(1);
  },
);
pgtest(
  "provider rotation during queue evidence cannot promote a ready child",
  async () => {
    const job = await start();
    await drive(job.id, 1);
    const original = sender;
    original.checkInboundQueue = async () => {
      sender = { ...original };
      return { ready: true, reason: "old account evidence" };
    };
    const blocked = await drive(job.id, 1);
    expect(blocked.status).toBe("blocked");
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 0 });
    expect(
      await client.one(
        "SELECT count(*)::int AS n FROM provisioning_jobs WHERE kind='address' AND status='ready'",
      ),
    ).toEqual({ n: 0 });
  },
);
pgtest(
  "retry revalidates previously ready address children before accepting new account evidence",
  async () => {
    uncertain = true;
    const job = await start(1);
    await drive(job.id);
    let queueChecks = 0;
    sender = {
      ...sender,
      checkInboundQueue: async () => {
        queueChecks++;
        return { ready: false, reason: "new account has no queue route" };
      },
    };
    await api("/v1/provision/retry", { domain: input.domain, job_id: job.id });
    const blocked = await drive(job.id);
    expect(blocked.status).toBe("blocked");
    expect(blocked.receipt.phase).toBe("addresses");
    expect(blocked.receipt.address_cursor).toBe(0);
    expect(queueChecks).toBe(1);
    expect(sendCalls).toBe(1);
  },
);
pgtest(
  "rotation after the send checkpoint is fenced immediately before provider I/O",
  async () => {
    const job = await start(1);
    await drive(job.id, 4); // DNS, both addresses, preflight
    const originalForTenant = base.forTenant.bind(base);
    base.forTenant = ((tenantId: string) => {
      const scoped = originalForTenant(tenantId);
      const original = scoped.claimSendIntent.bind(scoped);
      scoped.claimSendIntent = (async (
        ...args: Parameters<typeof original>
      ) => {
        const result = await original(...args);
        sender = { ...sender };
        return result;
      }) as typeof scoped.claimSendIntent;
      return scoped;
    }) as typeof base.forTenant;
    const blocked = await drive(job.id, 1);
    expect(blocked.status).toBe("blocked");
    expect(sendCalls).toBe(0);
  },
);

pgtest(
  "provider generation drift between steps blocks old address proofs until explicit retry",
  async () => {
    const job = await start();
    const addressesReady = await drive(job.id, 3);
    expect(addressesReady.receipt.address_cursor).toBe(2);
    sender = { ...sender };
    const blocked = await drive(job.id, 1);
    expect(blocked.status).toBe("blocked");
    expect(blocked.receipt.errors.at(-1).code).toBe("provider_binding_changed");
    const history = blocked.receipt.binding_history;
    await api("/v1/provision/retry", { domain: input.domain, job_id: job.id });
    const ready = await drive(job.id);
    expect(ready.status).toBe("ready");
    expect(ready.receipt.binding_history).toHaveLength(2);
    expect(ready.receipt.binding_history[0]).toBe(history[0]);
  },
);

pgtest(
  "a binding change after the final async guard prevents the ready checkpoint",
  async () => {
    const job = await start();
    await drive(job.id, 3);
    const originalForTenant = base.forTenant.bind(base);
    base.forTenant = ((tenantId: string) => {
      const scoped = originalForTenant(tenantId);
      const factory = scoped.provisionUpJobs.bind(scoped);
      scoped.provisionUpJobs = () => {
        const jobs = factory(),
          save = jobs.save.bind(jobs);
        jobs.save = async (...args: Parameters<typeof save>) => {
          if (args[2] === "ready")
            deps.env!.EMAILS_DNS_BINDINGS = JSON.stringify([
              { ...input.dns_binding, token_env: "CHANGED_FIXTURE_DNS_TOKEN" },
            ]);
          return save(...args);
        };
        return jobs;
      };
      return scoped;
    }) as typeof base.forTenant;
    const blocked = await drive(job.id, 1);
    expect(blocked.status).toBe("blocked");
    expect(blocked.receipt.complete).toBe(false);
    expect(
      await client.one(
        "SELECT count(*)::int AS n FROM provisioning_jobs WHERE kind='provision_up' AND status='ready'",
      ),
    ).toEqual({ n: 0 });
  },
);
