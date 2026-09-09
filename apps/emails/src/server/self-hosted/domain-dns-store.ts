import { randomUUID } from "node:crypto";
import type {
  PoolQueryClient,
  TypedQueryClient,
} from "../../storage-kit/index.js";
import { resolveDomainConnect } from "./domain-connect-store.js";
import {
  DomainDnsError,
  type DomainDnsBinding,
} from "./domain-dns-provider.js";
import {
  connectInput,
  dnsFingerprint,
  type DomainDnsClaim,
  type DomainDnsInput,
  type DomainDnsResult,
} from "./domain-dns.js";

interface JobRow {
  id: string;
  input: { request: DomainDnsInput; binding: DomainDnsBinding };
  input_hash: string;
  receipt: DomainDnsResult | null;
  status: string;
  current: boolean;
}
/** Uses the existing RLS-protected generic job ledger; no new migration or local state. */
export class DomainDnsJobs {
  constructor(
    private client: TypedQueryClient,
    private tenant: string,
    private atomic?: PoolQueryClient,
  ) {}
  private async transaction<T>(
    work: (tx: TypedQueryClient) => Promise<T>,
  ): Promise<T> {
    if (!this.atomic)
      throw new DomainDnsError(
        "DNS provisioning requires a transactional service store.",
        503,
      );
    return this.atomic.transaction(async (tx) => {
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [
        this.tenant,
      ]);
      return work(tx);
    });
  }
  async claim(
    input: DomainDnsInput,
    binding: DomainDnsBinding,
    actor: string,
  ): Promise<DomainDnsClaim> {
    return this.transaction(async (tx) => {
      await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${this.tenant}:domain-dns:${input.domain}`,
      ]);
      const payload = { request: input, binding },
        fingerprint = dnsFingerprint(payload);
      const row = await tx.get<JobRow>(
        "SELECT id,input,input_hash,receipt,status,updated_at>=now()-interval '2 minutes' AS current FROM provisioning_jobs WHERE tenant_id=$1 AND kind='domain_dns' AND idempotency_key=$2 FOR UPDATE",
        [this.tenant, input.domain],
      );
      if (row?.status === "processing" && row.current) {
        if (row.input_hash !== fingerprint)
          throw new DomainDnsError(
            "A different request is already processing for this domain. Inspect its receipt before submitting another request.",
          );
        return {
          id: row.id,
          lease: null,
          input: row.input.request,
          binding: row.input.binding,
          fingerprint: row.input_hash,
          previous: row.receipt,
        };
      }
      if (
        row?.receipt?.job.requires_reconciliation &&
        row.input_hash !== fingerprint
      )
        throw new DomainDnsError(
          "A previous DNS batch has uncertain acceptance. Reconcile its original plan and binding before changing the request.",
        );
      const id = row?.id ?? randomUUID(),
        lease = randomUUID();
      await tx.execute(
        `INSERT INTO provisioning_jobs(id,tenant_id,kind,idempotency_key,input_hash,input,actor,status,lease)
        VALUES($1,$2,'domain_dns',$3,$4,$5::jsonb,$6,'processing',$7::uuid)
        ON CONFLICT(tenant_id,kind,idempotency_key) DO UPDATE SET input_hash=EXCLUDED.input_hash,input=EXCLUDED.input,actor=EXCLUDED.actor,status='processing',lease=EXCLUDED.lease,updated_at=now()`,
        [
          id,
          this.tenant,
          input.domain,
          fingerprint,
          JSON.stringify(payload),
          actor,
          lease,
        ],
      );
      return {
        id,
        lease,
        input,
        binding,
        fingerprint,
        previous: row?.receipt ?? null,
      };
    });
  }
  private async lockCurrent(
    tx: TypedQueryClient,
    claim: DomainDnsClaim,
    providerType: "ses" | "resend",
  ) {
    const row = await tx.get(
      "SELECT id FROM provisioning_jobs WHERE tenant_id=$1 AND id=$2 AND kind='domain_dns' AND status='processing' AND lease=$3::uuid AND input_hash=$4 AND updated_at>=now()-interval '2 minutes' FOR UPDATE",
      [this.tenant, claim.id, claim.lease, claim.fingerprint],
    );
    if (!row)
      throw new DomainDnsError(
        "This DNS operation no longer owns its current lease.",
      );
    const tenant = await tx.get(
      "SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE",
      [this.tenant],
    );
    if (!tenant) throw new DomainDnsError("The account is no longer active.");
    await tx.execute(
      "SELECT id FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 FOR SHARE",
      [this.tenant, claim.input.provider_id],
    );
    await tx.execute(
      "SELECT id FROM domains WHERE tenant_id=$1 AND domain=$2 FOR UPDATE",
      [this.tenant, claim.input.domain],
    );
    const refs = await resolveDomainConnect(
      tx,
      this.tenant,
      connectInput(claim.input),
    );
    if (refs.provider_type !== providerType)
      throw new DomainDnsError(
        "The provider type changed during DNS provisioning.",
      );
    return refs;
  }
  async assertCurrent(claim: DomainDnsClaim, providerType: "ses" | "resend") {
    await this.transaction(async (tx) => {
      await this.lockCurrent(tx, claim, providerType);
    });
  }
  async save(
    claim: DomainDnsClaim,
    providerType: "ses" | "resend",
    result: DomainDnsResult,
    complete: boolean,
  ) {
    await this.transaction(async (tx) => {
      const refs = await this.lockCurrent(tx, claim, providerType);
      if (complete) {
        if (!refs.domain || !result.job.dns_published)
          throw new DomainDnsError(
            "DNS completion needs an existing domain and confirmed provider DNS readback.",
          );
        // Sending evidence does not claim an inbound route. Preserve all existing route rows.
        await tx.execute(
          `UPDATE domains SET dns_provider='cloudflare',cf_zone_id=$3,mail_from_domain=COALESCE($4,mail_from_domain),verified=$5,
          status=CASE WHEN status='pending' AND $5::boolean THEN 'verified' ELSE status END,
          provisioning_status=CASE WHEN provisioning_status IN ('none','dns_pending','dns_published') THEN CASE WHEN $5::boolean THEN 'verified' ELSE 'dns_published' END ELSE provisioning_status END,
          last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [
            this.tenant,
            refs.domain.id,
            claim.binding.zone_id,
            claim.input.mail_from ?? null,
            result.job.verified_for_sending,
          ],
        );
        await tx.execute(
          "INSERT INTO provisioning_events(id,tenant_id,entity_type,entity_id,from_state,to_state,detail_json) VALUES($1,$2,'domain',$3,$4,$5,$6::jsonb)",
          [
            randomUUID(),
            this.tenant,
            refs.domain.id,
            refs.domain.provisioning_status ?? "none",
            result.job.status,
            JSON.stringify({
              operation: claim.input.operation,
              receipt: result,
            }),
          ],
        );
      }
      await tx.execute(
        "UPDATE provisioning_jobs SET receipt=$4::jsonb,status=$5,lease=CASE WHEN $6 THEN NULL ELSE lease END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease=$3::uuid",
        [
          this.tenant,
          claim.id,
          claim.lease,
          JSON.stringify(result),
          complete ? "ready" : "processing",
          complete,
        ],
      );
    });
  }
  async block(claim: DomainDnsClaim, result: DomainDnsResult) {
    await this.client.execute(
      "UPDATE provisioning_jobs SET receipt=$4::jsonb,status='blocked',lease=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND kind='domain_dns' AND lease=$3::uuid",
      [this.tenant, claim.id, claim.lease, JSON.stringify(result)],
    );
  }
  async read(id: string): Promise<DomainDnsResult | null> {
    const row = await this.client.get<JobRow>(
      "SELECT id,input,input_hash,receipt,status FROM provisioning_jobs WHERE tenant_id=$1 AND kind='domain_dns' AND id=$2",
      [this.tenant, id],
    );
    if (!row) return null;
    if (row.status !== "processing" && row.receipt) return row.receipt;
    return {
      dry_run: false,
      job: {
        id: row.id,
        domain: row.input.request.domain,
        provider_id: row.input.request.provider_id,
        zone_id: row.input.binding.zone_id,
        status: "processing",
        phase: row.receipt?.job.phase ?? "resolve",
        dns_published: row.receipt?.job.dns_published ?? false,
        verified_for_sending: row.receipt?.job.verified_for_sending ?? false,
        requires_reconciliation:
          row.receipt?.job.requires_reconciliation ?? false,
        plan: row.receipt?.job.plan ?? null,
        message:
          "DNS provisioning is processing. Inspect this receipt or retry the original command after the lease expires.",
      },
    };
  }
}
