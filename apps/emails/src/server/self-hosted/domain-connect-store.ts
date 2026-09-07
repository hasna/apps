import { createHash, randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import type { TenantScopedStore, DomainRecord } from "./store.js";
import {
  DomainConnectError,
  type DomainConnectInput,
  type DomainConnectRefs,
  type DomainConnectClaim,
  type DomainConnectResult,
} from "./domain-connect.js";

export async function resolveDomainConnect(
  client: TypedQueryClient,
  tenant: string,
  input: DomainConnectInput,
): Promise<DomainConnectRefs> {
  let provider = await client.get<any>(
    "SELECT id,type,active FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2",
    [tenant, input.provider_id],
  );
  if (!provider) {
    const rows = await client.many<any>(
      "SELECT id,type,active FROM self_hosted_providers WHERE tenant_id=$1 AND (lower(name)=lower($2) OR left(id,length($2))=$2) LIMIT 2",
      [tenant, input.provider_id],
    );
    if (rows.length !== 1)
      throw new DomainConnectError(
        "Provider reference is missing or ambiguous in this tenant",
        404,
        "provider_not_found",
      );
    provider = rows[0];
  }
  if (provider.active !== true || !["ses", "resend"].includes(provider.type))
    throw new DomainConnectError(
      "Select an active SES or Resend provider",
      409,
      "provider_unavailable",
    );
  const domain = await client.get<DomainRecord>(
    "SELECT * FROM domains WHERE tenant_id=$1 AND domain=$2",
    [tenant, input.domain],
  );
  if (domain && domain.provider !== provider.id)
    throw new DomainConnectError(
      "The existing domain must already be bound to this provider; transfer it explicitly first",
      409,
      "provider_mismatch",
    );
  if (domain && ["disabled", "suspended", "deleted"].includes(domain.status))
    throw new DomainConnectError(
      "The existing domain is disabled or suspended",
      409,
      "domain_disabled",
    );
  return {
    input: { ...input, provider_id: provider.id },
    provider_type: provider.type,
    domain,
  };
}
export async function claimDomainConnect(
  client: TypedQueryClient,
  tenant: string,
  input: DomainConnectInput,
  providerType: "ses" | "resend",
  actor: string,
): Promise<DomainConnectClaim> {
  const payload = JSON.stringify(input),
    key = `${input.provider_id}:${input.domain}`,
    lease = randomUUID();
  const claimed = await client.get<DomainConnectClaim>(
    `INSERT INTO provisioning_jobs(id,tenant_id,kind,idempotency_key,input_hash,input,actor,status,lease)
    VALUES($1,$2,'domain_connect',$3,$4,$5::jsonb,$7,'processing',$6::uuid)
    ON CONFLICT(tenant_id,kind,idempotency_key) DO UPDATE SET input=EXCLUDED.input,input_hash=EXCLUDED.input_hash,status='processing',lease=EXCLUDED.lease,updated_at=now()
    WHERE provisioning_jobs.status<>'processing' OR provisioning_jobs.updated_at<now()-interval '2 minutes'
    RETURNING id,lease,input`,
    [
      randomUUID(),
      tenant,
      key,
      createHash("sha256").update(payload).digest("hex"),
      payload,
      lease,
      actor,
    ],
  );
  if (claimed) return { ...claimed, provider_type: providerType };
  const existing = await client.one<{ id: string; input: DomainConnectInput }>(
    "SELECT id,input FROM provisioning_jobs WHERE tenant_id=$1 AND kind='domain_connect' AND idempotency_key=$2",
    [tenant, key],
  );
  return { ...existing, lease: null, provider_type: providerType };
}
export async function domainConnectLeaseCurrent(
  client: TypedQueryClient,
  tenant: string,
  claim: DomainConnectClaim,
): Promise<boolean> {
  return !!(await client.get(
    "SELECT id FROM provisioning_jobs WHERE tenant_id=$1 AND id=$2 AND kind='domain_connect' AND status='processing' AND lease=$3::uuid AND updated_at>=now()-interval '2 minutes'",
    [tenant, claim.id, claim.lease],
  ));
}
export async function blockDomainConnect(
  client: TypedQueryClient,
  tenant: string,
  claim: DomainConnectClaim,
  result: DomainConnectResult,
) {
  await client.execute(
    "UPDATE provisioning_jobs SET status='blocked',receipt=$4::jsonb,lease=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND kind='domain_connect' AND lease=$3::uuid",
    [tenant, claim.id, claim.lease, JSON.stringify(result)],
  );
}
export async function completeDomainConnect(
  client: TypedQueryClient,
  store: TenantScopedStore,
  tenant: string,
  claim: DomainConnectClaim,
  result: DomainConnectResult,
): Promise<DomainConnectResult | null> {
  const row = await client.get(
    "SELECT id FROM provisioning_jobs WHERE tenant_id=$1 AND id=$2 AND kind='domain_connect' AND status='processing' AND lease=$3::uuid FOR UPDATE",
    [tenant, claim.id, claim.lease],
  );
  if (!row) return null;
  await client.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${tenant}:domain-connect:${claim.input.domain}`,
  ]);
  await client.execute(
    "SELECT id FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tenant, claim.input.provider_id],
  );
  await client.execute(
    "SELECT id FROM domains WHERE tenant_id=$1 AND domain=$2 FOR UPDATE",
    [tenant, claim.input.domain],
  );
  const refs = await resolveDomainConnect(client, tenant, claim.input);
  if (refs.provider_type !== claim.provider_type)
    throw new DomainConnectError(
      "Provider binding changed during connection",
      409,
      "provider_mismatch",
    );
  const domain =
    refs.domain ??
    (await store.createDomain({
      domain: refs.input.domain,
      provider: refs.input.provider_id,
      status: "pending",
      verified: false,
    }));
  await store.applyDomainProvisioning(domain.id, {
    dns_provider: refs.input.dns_provider,
    send_provider: refs.provider_type,
    ...(!refs.domain ? { provisioning_status: "dns_pending" } : {}),
  });
  const receipt = {
    ...result,
    connection: { ...result.connection, domain_id: domain.id },
  };
  await client.execute(
    "INSERT INTO provisioning_events(id,tenant_id,entity_type,entity_id,from_state,to_state,detail_json) VALUES($1,$2,'domain',$3,$4,$5,$6::jsonb)",
    [
      randomUUID(),
      tenant,
      domain.id,
      refs.domain?.provisioning_status ?? "unconfigured",
      receipt.connection.status,
      JSON.stringify({ operation: "domain_connect", receipt }),
    ],
  );
  await client.execute(
    "UPDATE provisioning_jobs SET status='ready',receipt=$4::jsonb,lease=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND kind='domain_connect' AND lease=$3::uuid",
    [tenant, claim.id, claim.lease, JSON.stringify(receipt)],
  );
  return receipt;
}
export async function getDomainConnection(
  client: TypedQueryClient,
  tenant: string,
  id: string,
): Promise<DomainConnectResult | null> {
  const row = await client.get<{
    id: string;
    input: DomainConnectInput;
    status: string;
    receipt: DomainConnectResult | null;
    updated_at: string;
  }>(
    "SELECT id,input,status,receipt,updated_at FROM provisioning_jobs WHERE tenant_id=$1 AND kind='domain_connect' AND id=$2",
    [tenant, id],
  );
  if (!row) return null;
  if (row.status !== "processing" && row.receipt) return row.receipt;
  return {
    dry_run: false,
    connection: {
      id: row.id,
      domain_id: row.receipt?.connection.domain_id ?? null,
      ...row.input,
      status: "processing",
      provider_registered: null,
      dns_tasks: [],
      checked_at: row.updated_at,
      message:
        "Domain connection is processing; run connect again to resume after an interrupted attempt.",
    },
  };
}
