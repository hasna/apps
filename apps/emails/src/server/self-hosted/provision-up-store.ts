import { randomUUID } from "node:crypto";
import type {
  PoolQueryClient,
  TypedQueryClient,
} from "../../storage-kit/index.js";
import { resolveDomainConnect } from "./domain-connect-store.js";
import { connectInput } from "./domain-dns.js";
import {
  newProvisionUpReceipt,
  ProvisionUpError,
  upDnsInput,
  upHash,
  type BoundProvisionUpInput,
  type ProvisionUpJob,
  type ProvisionUpReceipt,
} from "./provision-up.js";
const columns =
  "id,input_hash,input,status,lease,receipt,created_at::text,updated_at::text";
export class ProvisionUpJobs {
  constructor(
    private client: TypedQueryClient,
    private tenant: string,
    private atomic?: PoolQueryClient,
  ) {}
  private transaction<T>(
    work: (tx: TypedQueryClient) => Promise<T>,
  ): Promise<T> {
    if (!this.atomic)
      throw new ProvisionUpError(
        "Provisioning requires a transactional service store.",
        503,
      );
    return this.atomic.transaction(async (tx) => {
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [
        this.tenant,
      ]);
      return work(tx);
    });
  }
  private async references(tx: TypedQueryClient, input: BoundProvisionUpInput) {
    if (
      !(await tx.get(
        "SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE",
        [this.tenant],
      ))
    )
      throw new ProvisionUpError("The account is no longer active.");
    const provider = await tx.get<{
      type: string;
      region: string | null;
      active: boolean;
    }>(
      "SELECT type,region,active FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 FOR SHARE",
      [this.tenant, input.provider_id],
    );
    if (
      !provider?.active ||
      provider.type !== input.provider_type ||
      provider.region !== input.provider_region
    )
      throw new ProvisionUpError(
        "The saved provider binding changed. Inspect this run before creating a new intent.",
      );
    await tx.execute(
      "SELECT id FROM domains WHERE tenant_id=$1 AND domain=$2 FOR SHARE",
      [this.tenant, input.domain],
    );
    const refs = await resolveDomainConnect(
      tx,
      this.tenant,
      connectInput(upDnsInput(input)),
    );
    if (refs.domain?.status === "outbound_disabled")
      throw new ProvisionUpError("Sending is disabled for this domain.");
  }
  async start(
    input: BoundProvisionUpInput,
    key: string,
    actor: string,
  ): Promise<ProvisionUpJob> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new ProvisionUpError("Invalid provisioning idempotency key.", 400);
    return this.transaction(async (tx) => {
      await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${this.tenant}:provision-up:${key}`,
      ]);
      await this.references(tx, input);
      const existing = await tx.get<ProvisionUpJob>(
        `SELECT ${columns} FROM provisioning_jobs WHERE tenant_id=$1 AND kind='provision_up' AND idempotency_key=$2 FOR UPDATE`,
        [this.tenant, key],
      );
      const hash = upHash(input);
      if (existing) {
        if (existing.input_hash !== hash)
          throw new ProvisionUpError(
            "This run identity belongs to different frozen inputs. Inspect it or choose an explicit new idempotency key.",
          );
        return existing;
      }
      const id = randomUUID();
      return tx.one<ProvisionUpJob>(
        `INSERT INTO provisioning_jobs(id,tenant_id,kind,idempotency_key,input_hash,input,actor,status,receipt) VALUES($1,$2,'provision_up',$3,$4,$5::jsonb,$6,'pending',$7::jsonb) RETURNING ${columns}`,
        [
          id,
          this.tenant,
          key,
          hash,
          JSON.stringify(input),
          actor,
          JSON.stringify(newProvisionUpReceipt(input, id)),
        ],
      );
    });
  }
  get(id: string): Promise<ProvisionUpJob | null> {
    return this.client.get<ProvisionUpJob>(
      `SELECT ${columns} FROM provisioning_jobs WHERE tenant_id=$1 AND kind='provision_up' AND id=$2`,
      [this.tenant, id],
    );
  }
  claim(id: string): Promise<ProvisionUpJob | null> {
    return this.client.get<ProvisionUpJob>(
      `UPDATE provisioning_jobs SET status='processing',lease=$3::uuid,updated_at=now() WHERE tenant_id=$1 AND kind='provision_up' AND id=$2 AND ((status='pending' AND COALESCE((receipt->>'next_attempt_ms')::bigint,0)<=extract(epoch FROM now())*1000) OR (status='processing' AND updated_at<now()-interval '2 minutes')) RETURNING ${columns}`,
      [this.tenant, id, randomUUID()],
    );
  }
  private async lock(tx: TypedQueryClient, job: ProvisionUpJob) {
    if (
      !job.lease ||
      !(await tx.get(
        "SELECT id FROM provisioning_jobs WHERE tenant_id=$1 AND kind='provision_up' AND id=$2 AND input_hash=$3 AND status='processing' AND lease=$4::uuid AND updated_at>=now()-interval '2 minutes' FOR UPDATE",
        [this.tenant, job.id, job.input_hash, job.lease],
      ))
    )
      throw new ProvisionUpError(
        "This worker no longer owns the provisioning lease.",
      );
  }
  async assertCurrentInTransaction(tx: TypedQueryClient, job: ProvisionUpJob) {
    await this.lock(tx, job);
    await this.references(tx, job.input);
  }
  async assertCurrent(job: ProvisionUpJob) {
    await this.transaction(async (tx) => {
      await this.lock(tx, job);
      await this.references(tx, job.input);
    });
  }
  save(
    job: ProvisionUpJob,
    receipt: ProvisionUpReceipt,
    status: ProvisionUpJob["status"],
    beforeCommit?: (tx: TypedQueryClient) => Promise<void>,
  ): Promise<ProvisionUpJob> {
    return this.transaction(async (tx) => {
      await this.lock(tx, job);
      if (status !== "blocked") {
        await this.references(tx, job.input);
        await beforeCommit?.(tx);
      }
      return tx.one<ProvisionUpJob>(
        `UPDATE provisioning_jobs SET receipt=$3::jsonb,status=$4,lease=CASE WHEN $4='processing' THEN lease ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${columns}`,
        [this.tenant, job.id, JSON.stringify(receipt), status],
      );
    });
  }
  async retry(
    domain: string,
    provider?: string,
    id?: string,
  ): Promise<ProvisionUpJob> {
    return this.transaction(async (tx) => {
      const rows = await tx.many<ProvisionUpJob & { current: boolean }>(
        `SELECT ${columns},updated_at>=now()-interval '2 minutes' AS current FROM provisioning_jobs WHERE tenant_id=$1 AND kind='provision_up' AND input->>'domain'=$2 AND ($3::text IS NULL OR input->>'provider_id'=$3) AND ($4::text IS NULL OR id=$4) ORDER BY created_at DESC LIMIT 2 FOR UPDATE`,
        [this.tenant, domain, provider ?? null, id ?? null],
      );
      if (!rows.length)
        throw new ProvisionUpError(
          "No saved provisioning run matches this domain.",
          404,
        );
      if (rows.length !== 1)
        throw new ProvisionUpError(
          "Multiple saved runs match. Select the exact --job ID.",
        );
      const job = rows[0]!;
      if (job.status === "processing" && job.current)
        throw new ProvisionUpError(
          "This run is still processing. Inspect it after the current lease finishes.",
        );
      await this.references(tx, job.input);
      if (job.status === "ready") return job;
      const receipt = structuredClone(
        job.receipt ?? newProvisionUpReceipt(job.input, job.id),
      );
      receipt.binding_generation = null;
      receipt.phase = "dns";
      receipt.address_cursor = 0;
      receipt.next_attempt_ms = 0;
      receipt.complete = false;
      receipt.roundtrip.preflight = false;
      receipt.roundtrip.poll_cursor = 0;
      receipt.roundtrip.poll_pass = 0;
      return tx.one<ProvisionUpJob>(
        `UPDATE provisioning_jobs SET status='pending',lease=NULL,receipt=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${columns}`,
        [this.tenant, job.id, JSON.stringify(receipt)],
      );
    });
  }
  async due(
    provider: string,
    assertions: {
      bucket?: string;
      add_mx?: boolean;
      force_mx_switch?: boolean;
    } = {},
  ): Promise<string[]> {
    const rows = await this.client.many<{ id: string }>(
      `SELECT id FROM provisioning_jobs WHERE tenant_id=$1 AND kind='provision_up' AND input->>'provider_id'=$2 AND ((status='pending' AND COALESCE((receipt->>'next_attempt_ms')::bigint,0)<=extract(epoch FROM now())*1000) OR (status='processing' AND updated_at<now()-interval '2 minutes')) AND ($3::text IS NULL OR input->>'bucket'=$3) AND ($4::boolean IS NULL OR (input->>'add_mx')::boolean=$4) AND ($5::boolean IS NULL OR (input->>'force_mx_switch')::boolean=$5) ORDER BY updated_at,id LIMIT 1`,
      [
        this.tenant,
        provider,
        assertions.bucket ?? null,
        assertions.add_mx ?? null,
        assertions.force_mx_switch ?? null,
      ],
    );
    return rows.map((row) => row.id);
  }
}
