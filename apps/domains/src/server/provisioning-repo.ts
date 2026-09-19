import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import type {
  DomainProvisioningJob,
  DomainDnsReconciliation,
  DomainProvisioningProviderState,
  DomainProvisioningRequest,
  DomainProvisioningStore,
  ProvisioningStatus,
  RegisteredDomainDetail,
  HostedDnsRecord,
} from "../lib/provisioning.js";
import { DomainsRepo, HttpError } from "./repo.js";

interface ProvisioningRow {
  id: string;
  domain_id: string;
  domain_name: string;
  idempotency_key: string;
  request_hash: string;
  status: string;
  max_price_usd: number | string;
  years: number | string;
  auto_renew: boolean;
  acquisition_mode: string;
  registrar: string;
  dns_provider: string;
  target: string;
  worker_name: string | null;
  origin_hostname: string | null;
  origin_tls_mode: string | null;
  provider_state: string;
  attempts: number | string;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface DnsReconciliationRow {
  id: string;
  provisioning_job_id: string;
  domain_name: string;
  idempotency_key: string;
  request_hash: string;
  status: DomainDnsReconciliation["status"];
  records: string;
  result: string | null;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

function dnsRow(row: DnsReconciliationRow): DomainDnsReconciliation {
  return {
    ...row,
    records: JSON.parse(row.records) as HostedDnsRecord[],
    result: row.result ? JSON.parse(row.result) : null,
  };
}

function parseProviderState(raw: string | null | undefined): DomainProvisioningProviderState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as DomainProvisioningProviderState
      : {};
  } catch {
    return {};
  }
}

function rowToJob(row: ProvisioningRow): DomainProvisioningJob {
  return {
    id: row.id,
    domain_id: row.domain_id,
    name: row.domain_name,
    idempotency_key: row.idempotency_key,
    request_hash: row.request_hash,
    status: row.status as ProvisioningStatus,
    max_price_usd: Number(row.max_price_usd),
    years: Number(row.years),
    auto_renew: Boolean(row.auto_renew),
    acquisition_mode: row.acquisition_mode as "purchase" | "adopt",
    registrar: row.registrar as "route53",
    dns_provider: row.dns_provider as "cloudflare",
    target: row.target as "shortlinks" | "website_origin",
    worker_name: row.worker_name,
    origin_hostname: row.origin_hostname,
    origin_tls_mode: row.origin_tls_mode as DomainProvisioningRequest["origin_tls_mode"],
    provider_state: parseProviderState(row.provider_state),
    attempts: Number(row.attempts),
    error: row.error,
    lease_token: row.lease_token,
    lease_until: row.lease_until,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class DomainsProvisioningRepo implements DomainProvisioningStore {
  private readonly domains: DomainsRepo;

  constructor(private readonly db: TypedQueryClient) {
    this.domains = new DomainsRepo(db);
  }

  async reserve(request: DomainProvisioningRequest, requestHash: string): Promise<DomainProvisioningJob> {
    const byKey = await this.db.get<ProvisioningRow>(
      "SELECT * FROM domain_provisioning_jobs WHERE idempotency_key = $1",
      [request.idempotency_key],
    );
    if (byKey) {
      if (byKey.request_hash !== requestHash) throw new HttpError(409, "idempotency key already used for a different provisioning request");
      return rowToJob(byKey);
    }

    const byDomain = await this.db.get<ProvisioningRow>(
      "SELECT * FROM domain_provisioning_jobs WHERE domain_name = $1",
      [request.name],
    );
    if (byDomain) {
      if (byDomain.request_hash !== requestHash) throw new HttpError(409, `domain '${request.name}' already has a different provisioning request`);
      return rowToJob(byDomain);
    }

    let domain = await this.domains.getDomainByName(request.name);
    if (!domain) {
      try {
        domain = await this.domains.createDomain({
          name: request.name,
          registrar: "AWS Route 53",
          status: "researching",
          auto_renew: request.auto_renew,
          notes: "Reserved by the hosted Domains API provisioning authority.",
          metadata: { provisioning: { status: "requested", target: request.target } },
        });
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        domain = await this.domains.getDomainByName(request.name);
      }
    }
    if (!domain) throw new Error("failed to reserve domain portfolio row");

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      const row = await this.db.get<ProvisioningRow>(
        `INSERT INTO domain_provisioning_jobs (
           id, domain_id, domain_name, idempotency_key, request_hash, status,
           max_price_usd, years, auto_renew, acquisition_mode, registrar, dns_provider, target,
           worker_name, origin_hostname, origin_tls_mode, provider_state, attempts, error, lease_token, lease_until,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{}',0,NULL,NULL,NULL,$16,$17)
         RETURNING *`,
        [
          id,
          domain.id,
          request.name,
          request.idempotency_key,
          requestHash,
          request.max_price_usd,
          request.years,
          request.auto_renew,
          request.acquisition_mode,
          request.registrar,
          request.dns_provider,
          request.target,
          request.worker_name,
          request.origin_hostname,
          request.origin_tls_mode,
          now,
          now,
        ],
      );
      return rowToJob(row!);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate key|unique constraint/i.test(message)) throw error;
      const existing = await this.db.get<ProvisioningRow>(
        "SELECT * FROM domain_provisioning_jobs WHERE idempotency_key = $1 OR domain_name = $2 ORDER BY created_at LIMIT 1",
        [request.idempotency_key, request.name],
      );
      if (!existing || existing.request_hash !== requestHash) {
        throw new HttpError(409, "conflicting provisioning request");
      }
      return rowToJob(existing);
    }
  }

  async reserveAdoption(
    request: DomainProvisioningRequest,
    requestHash: string,
    detail: RegisteredDomainDetail,
  ): Promise<DomainProvisioningJob> {
    const byKey = await this.db.get<ProvisioningRow>(
      "SELECT * FROM domain_provisioning_jobs WHERE idempotency_key=$1",
      [request.idempotency_key],
    );
    if (byKey) {
      if (byKey.request_hash !== requestHash) throw new HttpError(409, "idempotency key already used for a different adoption request");
      return rowToJob(byKey);
    }
    const byDomain = await this.db.get<ProvisioningRow>(
      "SELECT * FROM domain_provisioning_jobs WHERE domain_name=$1",
      [request.name],
    );
    if (byDomain) {
      if (byDomain.request_hash !== requestHash) throw new HttpError(409, `domain '${request.name}' already has different provisioning intent`);
      return rowToJob(byDomain);
    }
    const domain = await this.domains.getDomainByName(request.name);
    if (!domain) throw new HttpError(404, "owned domain is not present in the portfolio");
    const now = new Date().toISOString();
    const providerState: DomainProvisioningProviderState = {
      last_provider_status: "externally_verified_owned",
    };
    try {
      const row = await this.db.get<ProvisioningRow>(
        `INSERT INTO domain_provisioning_jobs (
           id, domain_id, domain_name, idempotency_key, request_hash, status,
           max_price_usd, years, auto_renew, acquisition_mode, registrar, dns_provider, target,
           worker_name, origin_hostname, origin_tls_mode, provider_state, attempts, error, lease_token, lease_until,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'registered',0,1,$6,'adopt',$7,$8,$9,$10,$11,$12,$13,0,NULL,NULL,NULL,$14,$15)
         RETURNING *`,
        [
          crypto.randomUUID(), domain.id, request.name, request.idempotency_key, requestHash,
          detail.auto_renew ?? request.auto_renew, request.registrar, request.dns_provider,
          request.target, request.worker_name, request.origin_hostname, request.origin_tls_mode,
          JSON.stringify(providerState), now, now,
        ],
      );
      return rowToJob(row!);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate key|unique constraint/i.test(message)) throw error;
      const raced = await this.db.get<ProvisioningRow>(
        "SELECT * FROM domain_provisioning_jobs WHERE idempotency_key = $1 OR domain_name = $2 ORDER BY created_at LIMIT 1",
        [request.idempotency_key, request.name],
      );
      if (!raced || raced.request_hash !== requestHash) {
        throw new HttpError(409, "conflicting domain adoption request");
      }
      return rowToJob(raced);
    }
  }

  async get(id: string): Promise<DomainProvisioningJob | null> {
    const row = await this.db.get<ProvisioningRow>("SELECT * FROM domain_provisioning_jobs WHERE id = $1", [id]);
    return row ? rowToJob(row) : null;
  }

  async getByName(name: string): Promise<DomainProvisioningJob | null> {
    const row = await this.db.get<ProvisioningRow>(
      "SELECT * FROM domain_provisioning_jobs WHERE domain_name = $1",
      [name],
    );
    return row ? rowToJob(row) : null;
  }

  async listRunnable(limit: number): Promise<DomainProvisioningJob[]> {
    const now = new Date().toISOString();
    const rows = await this.db.many<ProvisioningRow>(
      `SELECT * FROM domain_provisioning_jobs
       WHERE status NOT IN ('ready','manual_review','failed')
         AND (lease_until IS NULL OR lease_until < $1)
       ORDER BY updated_at ASC
       LIMIT $2`,
      [now, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map(rowToJob);
  }

  async claim(id: string, leaseToken: string, leaseUntil: string): Promise<DomainProvisioningJob | null> {
    const now = new Date().toISOString();
    const row = await this.db.get<ProvisioningRow>(
      `UPDATE domain_provisioning_jobs
       SET lease_token = $2, lease_until = $3, updated_at = $4
       WHERE id = $1
         AND status NOT IN ('ready','manual_review','failed')
         AND (lease_until IS NULL OR lease_until < $4)
       RETURNING *`,
      [id, leaseToken, leaseUntil, now],
    );
    return row ? rowToJob(row) : null;
  }

  async update(
    id: string,
    patch: Partial<Pick<DomainProvisioningJob, "status" | "provider_state" | "attempts" | "error" | "lease_token" | "lease_until">>,
    leaseToken?: string,
  ): Promise<DomainProvisioningJob | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.provider_state !== undefined) add("provider_state", JSON.stringify(patch.provider_state));
    if (patch.attempts !== undefined) add("attempts", patch.attempts);
    if (patch.error !== undefined) add("error", patch.error);
    if (patch.lease_token !== undefined) add("lease_token", patch.lease_token);
    if (patch.lease_until !== undefined) add("lease_until", patch.lease_until);
    add("updated_at", new Date().toISOString());
    params.push(id);
    const idParam = `$${params.length}`;
    let where = `id = ${idParam}`;
    if (leaseToken !== undefined) {
      params.push(leaseToken);
      where += ` AND lease_token = $${params.length}`;
    }
    const row = await this.db.get<ProvisioningRow>(
      `UPDATE domain_provisioning_jobs SET ${sets.join(", ")} WHERE ${where} RETURNING *`,
      params,
    );
    return row ? rowToJob(row) : null;
  }

  async markPortfolioReady(job: DomainProvisioningJob, detail: RegisteredDomainDetail): Promise<void> {
    const existing = await this.domains.getDomain(job.domain_id);
    if (!existing) throw new Error("domain portfolio row disappeared during provisioning");
    await this.domains.updateDomain(job.domain_id, {
      registrar: detail.registrar ?? "AWS Route 53",
      status: "active",
      registered_at: detail.registered_at ?? existing.registered_at ?? undefined,
      expires_at: detail.expires_at ?? existing.expires_at ?? undefined,
      auto_renew: detail.auto_renew ?? job.auto_renew,
      purchase_price: job.provider_state.quoted_price_usd ?? existing.purchase_price,
      standard_price: job.provider_state.quoted_price_usd ?? existing.standard_price,
      purchase_date: existing.purchase_date ?? job.created_at,
      nameservers: detail.nameservers,
      metadata: {
        ...existing.metadata,
        provisioning: {
          job_id: job.id,
          status: "ready",
          target: job.target,
          acquisition_mode: job.acquisition_mode,
          worker_name: job.worker_name,
          cloudflare_zone_id: job.provider_state.cloudflare_zone_id,
          registration_operation_id: job.provider_state.registration_operation_id,
          nameserver_operation_id: job.provider_state.nameserver_operation_id,
          ready_at: new Date().toISOString(),
        },
      },
    });
  }

  async reserveDnsReconciliation(input: {
    job: DomainProvisioningJob;
    idempotencyKey: string;
    requestHash: string;
    records: HostedDnsRecord[];
  }): Promise<DomainDnsReconciliation> {
    const existing = await this.db.get<DnsReconciliationRow>(
      "SELECT * FROM domain_dns_reconciliations WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (existing) {
      if (existing.request_hash !== input.requestHash) {
        throw new HttpError(409, "idempotency key already used for different DNS records");
      }
      return dnsRow(existing);
    }
    const now = new Date().toISOString();
    try {
      const row = await this.db.get<DnsReconciliationRow>(
        `INSERT INTO domain_dns_reconciliations (
           id, provisioning_job_id, domain_name, idempotency_key, request_hash,
           status, records, result, error, lease_token, lease_until, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'requested',$6,NULL,NULL,NULL,NULL,$7,$8)
         RETURNING *`,
        [crypto.randomUUID(), input.job.id, input.job.name, input.idempotencyKey, input.requestHash,
          JSON.stringify(input.records), now, now],
      );
      return dnsRow(row!);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate key|unique constraint/i.test(message)) throw error;
      const raced = await this.db.get<DnsReconciliationRow>(
        "SELECT * FROM domain_dns_reconciliations WHERE idempotency_key = $1",
        [input.idempotencyKey],
      );
      if (!raced || raced.request_hash !== input.requestHash) {
        throw new HttpError(409, "conflicting DNS reconciliation request");
      }
      return dnsRow(raced);
    }
  }

  async claimDnsReconciliation(
    id: string,
    leaseToken: string,
    leaseUntil: string,
  ): Promise<DomainDnsReconciliation | null> {
    const now = new Date().toISOString();
    const row = await this.db.get<DnsReconciliationRow>(
      `UPDATE domain_dns_reconciliations
       SET lease_token=$2, lease_until=$3, updated_at=$4
       WHERE id=$1 AND status <> 'ready' AND (lease_until IS NULL OR lease_until < $4)
       RETURNING *`,
      [id, leaseToken, leaseUntil, now],
    );
    return row ? dnsRow(row) : null;
  }

  async updateDnsReconciliation(
    id: string,
    patch: Partial<Pick<DomainDnsReconciliation, "status" | "result" | "error" | "lease_token" | "lease_until">>,
    leaseToken: string,
  ): Promise<DomainDnsReconciliation | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => { params.push(value); sets.push(`${column}=$${params.length}`); };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.result !== undefined) add("result", patch.result === null ? null : JSON.stringify(patch.result));
    if (patch.error !== undefined) add("error", patch.error);
    if (patch.lease_token !== undefined) add("lease_token", patch.lease_token);
    if (patch.lease_until !== undefined) add("lease_until", patch.lease_until);
    add("updated_at", new Date().toISOString());
    params.push(id, leaseToken);
    const row = await this.db.get<DnsReconciliationRow>(
      `UPDATE domain_dns_reconciliations SET ${sets.join(", ")}
       WHERE id=$${params.length - 1} AND lease_token=$${params.length} RETURNING *`,
      params,
    );
    return row ? dnsRow(row) : null;
  }
}
