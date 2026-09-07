import { beforeAll, beforeEach, afterAll, expect, test } from "bun:test";
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
  planAddressProvisioning,
  runAddressProvisioningJob,
  type AddressProvisioningInput,
  type ProvisioningReceipt,
} from "./address-provisioning.js";
import type { SelfHostedSender } from "./sender.js";
import { evaluateInboundReceiptRoute } from "./inbound-receipt-route.js";
const url = process.env.EMAILS_TEST_POSTGRES_URL;
const tenantA = "00000000-0000-0000-0000-000000000001",
  tenantB = "00000000-0000-0000-0000-000000000002";
let pool: ReturnType<typeof createPgPool>,
  client: PoolQueryClient,
  base: EmailsSelfHostedStore,
  store: TenantScopedStore;
let input: AddressProvisioningInput, sender: SelfHostedSender, options: any;
const role = `provision_rls_${crypto.randomUUID().replaceAll("-", "")}`;
beforeAll(async () => {
  if (!url) return;
  pool = createPgPool({ connectionString: url, env: { PGSSLMODE: "disable" } });
  client = createQueryClient(pool);
  base = new EmailsSelfHostedStore(client);
  store = base.forTenant(tenantA);
  await client.execute(
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
  );
  await new MigrationLedger(client, emailsSelfHostedMigrations()).migrate();
  await client.execute(
    "INSERT INTO tenants(id,slug,name) VALUES($1,'provision-a','A'),($2,'provision-b','B') ON CONFLICT(id) DO NOTHING",
    [tenantA, tenantB],
  );
  await client.execute(
    `CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE ON provisioning_jobs TO "${role}"`,
  );
});
beforeEach(async () => {
  if (!url) return;
  await client.execute(
    "TRUNCATE self_hosted_providers,domains,addresses,owners,provisioning_jobs,provisioning_events,address_ownership_events CASCADE; DELETE FROM inbound_domain_routes",
  );
  const provider = await store.createResource(
    resourceSpecForPath("providers")!,
    { name: "Fixture", type: "ses", active: true },
  );
  const domain = await store.createDomain({
    domain: "example.test",
    provider: provider.id as string,
    status: "pending",
    verified: false,
  });
  input = {
    email: "new@example.test",
    provider_id: provider.id as string,
    domain_id: domain.id,
    receive_strategy: "ses-s3",
  };
  sender = {
    provider: "ses",
    region: "us-east-1",
    send: async () => {
      throw new Error("No mail");
    },
    verifyDomain: async () => ({
      verifiedForSending: true,
      dkim: "verified",
      spf: "pending",
      dmarc: "pending",
    }),
    checkInboundDomain: async () => ({
      ready: true,
      reason: "fixture checked",
      topicArn: "fixture-topic",
    }),
    checkInboundQueue: async () => ({ ready: true, reason: "fixture checked" }),
  };
  options = {
    env: {
      EMAILS_INGEST_S3_BUCKET: "fixture-bucket",
      EMAILS_INGEST_QUEUE_URL: "fixture-queue",
    },
    resolveSender: () => sender,
    mx: async () => [
      { exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 },
    ],
  };
});
afterAll(async () => {
  if (url) {
    await client.execute(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    await pool.end();
  }
});
async function start(value = input, key = crypto.randomUUID()) {
  const refs = await store.resolveAddressProvisioning(value);
  return store.startProvisioningJob(refs.input, key, "fixture-operator");
}
const pgtest = test.skipIf(!url);
pgtest(
  "dry run checks actual inputs and evidence without writing address, job, ownership or readiness",
  async () => {
    const result = await planAddressProvisioning(
      store,
      tenantA,
      input,
      options,
    );
    expect(result).toMatchObject({ dry_run: true, receipt: { ready: true } });
    for (const table of [
      "addresses",
      "provisioning_jobs",
      "address_ownership_events",
      "provisioning_events",
    ])
      expect(
        await client.one(`SELECT count(*)::int AS n FROM ${table}`),
      ).toEqual({ n: 0 });
    expect(await store.getDomain(input.domain_id!)).toMatchObject({
      verified: false,
      status: "pending",
    });
  },
);
pgtest(
  "verified routing atomically ensures an owned address and a durable ready receipt",
  async () => {
    const owner = await store.createResource(resourceSpecForPath("owners")!, {
      name: "Robot",
      type: "agent",
    });
    const job = await start({ ...input, owner: "Robot" });
    const result = await runAddressProvisioningJob(
      store,
      tenantA,
      job.id,
      options,
    );
    expect(result).toMatchObject({
      status: "ready",
      receipt: {
        ready: true,
        checks: { provider_verified: true, queue_route_verified: true },
      },
    });
    expect(await store.getAddress(result.receipt!.address_id!)).toMatchObject({
      email: input.email,
      provider_id: input.provider_id,
      domain_id: input.domain_id,
      verified: true,
      provisioning_status: "ready",
      owner_id: owner.id,
      administrator_id: owner.id,
    });
    expect(
      await client.one("SELECT count(*)::int AS n FROM provisioning_events"),
    ).toEqual({ n: 1 });
    expect(
      await client.one(
        "SELECT count(*)::int AS n FROM address_ownership_events",
      ),
    ).toEqual({ n: 1 });
    expect(
      await client.one(
        "SELECT tenant_id FROM inbound_domain_routes WHERE domain='example.test'",
      ),
    ).toEqual({ tenant_id: tenantA });
    await runAddressProvisioningJob(store, tenantA, job.id, options);
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 1 });
    expect(
      await client.one("SELECT count(*)::int AS n FROM provisioning_events"),
    ).toEqual({ n: 1 });
  },
);
pgtest(
  "unverified providers, wrong MX, missing queue wiring and unsupported strategies never create ready addresses",
  async () => {
    for (const failure of [
      "provider",
      "mx",
      "mixed-mx",
      "mailbox-stop",
      "queue",
      "strategy",
      "bucket",
    ]) {
      const saved = { ...sender };
      const deps = { ...options };
      let params = { ...input };
      if (failure === "provider")
        sender.verifyDomain = async () => ({
          verifiedForSending: false,
          dkim: "pending",
          spf: "pending",
          dmarc: "pending",
        });
      if (failure === "mx")
        deps.mx = async () => [
          { exchange: "other.example.test", priority: 10 },
        ];
      if (failure === "mixed-mx")
        deps.mx = async () => [
          { exchange: "aspmx.l.google.com", priority: 1 },
          { exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 20 },
        ];
      if (failure === "mailbox-stop")
        sender.checkInboundDomain = async (domain, bucket, mailbox) => {
          expect(mailbox).toBe(input.email);
          return evaluateInboundReceiptRoute(
            [
              {
                Name: "shadow",
                Enabled: true,
                Recipients: [input.email],
                Actions: [{ StopAction: { Scope: "RuleSet" } }],
              },
              {
                Name: "delivery",
                Enabled: true,
                Recipients: [domain],
                Actions: [
                  {
                    S3Action: { BucketName: bucket, TopicArn: "fixture-topic" },
                  },
                ],
              },
            ],
            domain,
            bucket,
            mailbox,
          );
        };
      if (failure === "queue")
        sender.checkInboundQueue = async () => ({
          ready: false,
          reason: "Missing subscription",
        });
      if (failure === "strategy") params.receive_strategy = "resend-webhook";
      if (failure === "bucket") params.inbound_bucket = "different-bucket";
      const job = await start(params);
      const result = await runAddressProvisioningJob(
        store,
        tenantA,
        job.id,
        deps,
      );
      expect(result).toMatchObject({
        status: "blocked",
        receipt: { ready: false },
      });
      Object.assign(sender, saved);
    }
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 0 });
    expect(await store.getDomain(input.domain_id!)).toMatchObject({
      verified: false,
    });
  },
);
pgtest(
  "tenant provider/domain and human-administrator ownership constraints fail before provisioning",
  async () => {
    const other = base.forTenant(tenantB),
      provider = await other.createResource(resourceSpecForPath("providers")!, {
        name: "Foreign",
        type: "ses",
        active: true,
      });
    await expect(
      store.resolveAddressProvisioning({
        ...input,
        provider_id: provider.id as string,
      }),
    ).rejects.toThrow("missing or ambiguous");
    const human = await store.createResource(resourceSpecForPath("owners")!, {
      name: "Human",
      type: "human",
    });
    await expect(
      store.resolveAddressProvisioning({ ...input, owner: human.id as string }),
    ).rejects.toThrow("administering agent");
    await expect(
      store.resolveAddressProvisioning({
        ...input,
        owner: human.id as string,
        administrator: human.id as string,
      }),
    ).rejects.toThrow("must be an agent");
    await expect(
      store.resolveAddressProvisioning({
        ...input,
        email: "other@different.test",
      }),
    ).rejects.toThrow("does not match");
  },
);
pgtest(
  "concurrent identities are immutable and lease loss fences every final address write",
  async () => {
    const [first, replay] = await Promise.all([
      start(input, "same-key"),
      start(input, "same-key"),
    ]);
    expect(first.id).toBe(replay.id);
    await expect(
      start({ ...input, email: "different@example.test" }, "same-key"),
    ).rejects.toThrow("different inputs");
    const old = await store.claimProvisioningJob(first.id);
    expect(await store.claimProvisioningJob(first.id)).toBeNull();
    await client.execute(
      "UPDATE provisioning_jobs SET updated_at=now()-interval '3 minutes' WHERE id=$1",
      [first.id],
    );
    const current = await store.claimProvisioningJob(first.id);
    expect(current!.lease).not.toBe(old!.lease);
    const receipt: ProvisioningReceipt = {
      ready: true,
      code: "ready",
      message: "fixture",
      checked_at: new Date().toISOString(),
    };
    expect(
      await store.completeAddressProvisioning(
        old!,
        await store.resolveAddressProvisioning(input),
        receipt,
      ),
    ).toBeNull();
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 0 });
    expect(
      await base.forTenant(tenantB).getProvisioningJob(first.id),
    ).toBeNull();
  },
);
pgtest(
  "audit failure rolls back address creation, ownership and domain readiness together",
  async () => {
    await client.execute(
      "ALTER TABLE provisioning_events ADD CONSTRAINT reject_fixture_provisioning CHECK(to_state<>'ready')",
    );
    try {
      const job = await start();
      const result = await runAddressProvisioningJob(
        store,
        tenantA,
        job.id,
        options,
      );
      expect(result.status).toBe("blocked");
      expect(result.receipt?.message).not.toContain("reject_fixture");
      expect(
        await client.one("SELECT count(*)::int AS n FROM addresses"),
      ).toEqual({ n: 0 });
      expect(await store.getDomain(input.domain_id!)).toMatchObject({
        verified: false,
        status: "pending",
      });
      expect(
        await client.one(
          "SELECT count(*)::int AS n FROM inbound_domain_routes",
        ),
      ).toEqual({ n: 0 });
    } finally {
      await client.execute(
        "ALTER TABLE provisioning_events DROP CONSTRAINT reject_fixture_provisioning",
      );
    }
  },
);
pgtest(
  "ready commit revalidates changed provider and domain bindings after the external check",
  async () => {
    const job = await start();
    sender.checkInboundQueue = async () => {
      await client.execute(
        "UPDATE self_hosted_providers SET active=false WHERE id=$1",
        [input.provider_id],
      );
      return { ready: true, reason: "fixture" };
    };
    expect(
      (await runAddressProvisioningJob(store, tenantA, job.id, options)).status,
    ).toBe("blocked");
    expect(
      await client.one("SELECT count(*)::int AS n FROM addresses"),
    ).toEqual({ n: 0 });
  },
);
pgtest(
  "forced RLS hides other tenants' job inputs and refuses cross-tenant job mutation",
  async () => {
    const job = await start();
    const session = await pool.connect();
    try {
      await session.query("BEGIN");
      await session.query(`SET LOCAL ROLE "${role}"`);
      await session.query("SELECT set_config('app.current_tenant',$1,true)", [
        tenantB,
      ]);
      expect(
        (await session.query("SELECT id FROM provisioning_jobs")).rows,
      ).toEqual([]);
      expect(
        (
          await session.query(
            "UPDATE provisioning_jobs SET status='ready' WHERE id=$1",
            [job.id],
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        session.query(
          "INSERT INTO provisioning_jobs(id,tenant_id,kind,idempotency_key,input_hash,input,actor,status) VALUES('forged',$1,'address','forged','hash','{}','forged','pending')",
          [tenantA],
        ),
      ).rejects.toThrow("row-level security");
    } finally {
      await session.query("ROLLBACK");
      session.release();
    }
  },
);
