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
  connectDomain,
  type DomainConnectInput,
  type DomainConnectResult,
} from "./domain-connect.js";
import type { SelfHostedSender } from "./sender.js";
const url = process.env.EMAILS_TEST_POSTGRES_URL;
const tenantA = "00000000-0000-0000-0000-000000000001",
  tenantB = "00000000-0000-0000-0000-000000000002";
let pool: ReturnType<typeof createPgPool>,
  client: PoolQueryClient,
  base: EmailsSelfHostedStore,
  store: TenantScopedStore;
let input: DomainConnectInput,
  sender: SelfHostedSender,
  registrations: number,
  reads: number,
  registered: boolean;
// A cold schema rebuild can exceed Bun's default 5s hook deadline. Match the
// neighboring domain-DNS setup allowance; individual case deadlines stay intact.
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
    "INSERT INTO tenants(id,slug,name) VALUES($1,'connect-a','A'),($2,'connect-b','B') ON CONFLICT(id) DO NOTHING",
    [tenantA, tenantB],
  );
}, 60_000);
beforeEach(async () => {
  if (!url) return;
  await client.execute(
    "TRUNCATE self_hosted_providers,domains,provisioning_jobs,provisioning_events CASCADE; DELETE FROM inbound_domain_routes",
  );
  const provider = await store.createResource(
    resourceSpecForPath("providers")!,
    { name: "Fixture", type: "ses", active: true },
  );
  input = {
    domain: "example.test",
    provider_id: provider.id as string,
    dns_provider: "manual",
    register_provider: true,
  };
  registrations = 0;
  reads = 0;
  registered = false;
  sender = {
    provider: "ses",
    send: async () => {
      throw new Error("no mail");
    },
    registerDomain: async () => {
      registrations++;
      registered = true;
    },
    readDomainConnection: async () => {
      reads++;
      return {
        registered,
        verified_for_sending: false,
        dns_tasks: registered
          ? [
              {
                type: "CNAME",
                name: "selector._domainkey.example.test",
                value: "fixture.dkim.example.test",
                purpose: "DKIM",
                status: "pending",
              },
            ]
          : [],
      };
    },
  };
});
afterAll(async () => {
  if (url) await pool.end();
});
const pgtest = test.skipIf(!url);
const run = (dry = false) =>
  connectDomain(store, tenantA, input, dry, () => sender, "fixture-actor");
pgtest(
  "dry run resolves tenant binding without provider calls or job/registry writes",
  async () => {
    const result = await run(true);
    expect(result.connection.status).toBe("planned");
    expect({ reads, registrations }).toEqual({ reads: 0, registrations: 0 });
    for (const table of ["domains", "provisioning_jobs", "provisioning_events"])
      expect(await client.one(`SELECT count(*)::int n FROM ${table}`)).toEqual({
        n: 0,
      });
  },
);
pgtest(
  "provider registration and DNS tasks persist across clients without creating inbound readiness",
  async () => {
    const first = await run();
    expect(first.connection).toMatchObject({
      status: "pending_verification",
      provider_registered: true,
    });
    expect(registrations).toBe(1);
    const freshClient = new EmailsSelfHostedStore(client).forTenant(tenantA);
    expect(await freshClient.getDomainConnection(first.connection.id!)).toEqual(
      first,
    );
    expect(
      await freshClient.getDomain(first.connection.domain_id!),
    ).toMatchObject({
      domain: input.domain,
      provider: input.provider_id,
      verified: false,
      status: "pending",
      dns_provider: "manual",
    });
    const again = await run();
    expect(again.connection.id).toBe(first.connection.id);
    expect(registrations).toBe(1);
    expect(await client.one("SELECT count(*)::int n FROM domains")).toEqual({
      n: 1,
    });
    expect(
      await client.one("SELECT count(*)::int n FROM inbound_domain_routes"),
    ).toEqual({ n: 0 });
  },
);
pgtest(
  "no-register-provider records truthful pending tasks without provider mutation",
  async () => {
    input.register_provider = false;
    input.dns_provider = "route53";
    const result = await run();
    expect(result.connection).toMatchObject({
      provider_registered: false,
      status: "pending_verification",
      dns_provider: "route53",
      dns_tasks: [],
    });
    expect(registrations).toBe(0);
  },
);
pgtest(
  "foreign providers and existing differently-bound domains fail before provider calls",
  async () => {
    const foreign = await base
      .forTenant(tenantB)
      .createResource(resourceSpecForPath("providers")!, {
        name: "Foreign",
        type: "ses",
        active: true,
      });
    await expect(
      connectDomain(
        store,
        tenantA,
        { ...input, provider_id: foreign.id as string },
        false,
        () => sender,
      ),
    ).rejects.toThrow("missing");
    await store.createDomain({ domain: input.domain, provider: null });
    await expect(run()).rejects.toThrow("bound");
    expect({ reads, registrations }).toEqual({ reads: 0, registrations: 0 });
  },
);
pgtest(
  "inflight inputs remain frozen and lease replacement fences stale final writes",
  async () => {
    const old = await store.claimDomainConnect(input, "ses", "fixture-actor");
    const busy = await store.claimDomainConnect(
      { ...input, dns_provider: "cloudflare" },
      "ses",
      "other-actor",
    );
    expect(busy.lease).toBeNull();
    expect(busy.input.dns_provider).toBe("manual");
    await client.execute(
      "UPDATE provisioning_jobs SET updated_at=now()-interval '3 minutes' WHERE id=$1",
      [old.id],
    );
    const next = await store.claimDomainConnect(input, "ses", "fixture-actor");
    expect(next.lease).not.toBe(old.lease);
    const result: DomainConnectResult = {
      dry_run: false,
      connection: {
        ...input,
        id: old.id,
        domain_id: null,
        status: "pending_verification",
        provider_registered: true,
        dns_tasks: [],
        checked_at: new Date().toISOString(),
        message: "fixture",
      },
    };
    expect(await store.completeDomainConnect(old, result)).toBeNull();
    expect(await client.one("SELECT count(*)::int n FROM domains")).toEqual({
      n: 0,
    });
    expect(
      await base.forTenant(tenantB).getDomainConnection(old.id),
    ).toBeNull();
  },
);
pgtest(
  "provider disable after external registration prevents shared readiness writes",
  async () => {
    sender.registerDomain = async () => {
      registered = true;
      registrations++;
      await client.execute(
        "UPDATE self_hosted_providers SET active=false WHERE id=$1",
        [input.provider_id],
      );
    };
    const result = await run();
    expect(result.connection.status).toBe("blocked");
    expect(await client.one("SELECT count(*)::int n FROM domains")).toEqual({
      n: 0,
    });
  },
);
pgtest(
  "audit failure rolls back registry and tasks while preserving a blocked receipt",
  async () => {
    await client.execute(
      "ALTER TABLE provisioning_events ADD CONSTRAINT reject_connect_fixture CHECK(false) NOT VALID",
    );
    try {
      const result = await run();
      expect(result.connection.status).toBe("blocked");
      expect(JSON.stringify(result)).not.toContain("reject_connect_fixture");
      expect(await client.one("SELECT count(*)::int n FROM domains")).toEqual({
        n: 0,
      });
      expect(
        (await store.getDomainConnection(result.connection.id!))?.connection
          .status,
      ).toBe("blocked");
    } finally {
      await client.execute(
        "ALTER TABLE provisioning_events DROP CONSTRAINT reject_connect_fixture",
      );
    }
  },
);
