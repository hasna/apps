import { createHash, randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import type {
  TenantScopedStore,
  DomainRecord,
  AddressRecord,
} from "./store.js";
import {
  AddressProvisioningError,
  type AddressProvisioningInput,
  type AddressProvisioningRefs,
  type ProvisioningJob,
  type ProvisioningReceipt,
} from "./address-provisioning.js";

async function reference(
  client: TypedQueryClient,
  tenant: string,
  table: "owners" | "self_hosted_providers" | "domains",
  ref: string,
  name: string,
): Promise<any> {
  const exact = await client.get(
    `SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2`,
    [tenant, ref],
  );
  if (exact) return exact;
  const matches = await client.many(
    `SELECT * FROM ${table} WHERE tenant_id=$1 AND (lower(${name})=lower($2) OR left(id,length($2))=$2) LIMIT 2`,
    [tenant, ref],
  );
  if (matches.length !== 1)
    throw new AddressProvisioningError(
      `${table === "self_hosted_providers" ? "Provider" : table === "domains" ? "Domain" : "Owner"} reference is missing or ambiguous in this tenant.`,
      404,
      "reference_not_found",
    );
  return matches[0];
}
export async function resolveAddressProvisioning(
  client: TypedQueryClient,
  tenant: string,
  input: AddressProvisioningInput,
): Promise<AddressProvisioningRefs> {
  const provider = await reference(
    client,
    tenant,
    "self_hosted_providers",
    input.provider_id,
    "name",
  );
  if (provider.active !== true)
    throw new AddressProvisioningError(
      "The selected provider is inactive.",
      409,
      "provider_inactive",
    );
  const domain = (await reference(
    client,
    tenant,
    "domains",
    input.domain_id ?? input.email.split("@")[1]!,
    "domain",
  )) as DomainRecord;
  if (domain.domain.toLowerCase() !== input.email.split("@")[1])
    throw new AddressProvisioningError(
      "The selected domain does not match the mailbox.",
      409,
      "domain_mismatch",
    );
  if (domain.provider !== provider.id)
    throw new AddressProvisioningError(
      "The domain must already be bound to the selected tenant provider.",
      409,
      "provider_mismatch",
    );
  if (["disabled", "suspended", "deleted"].includes(domain.status))
    throw new AddressProvisioningError(
      "The selected domain is disabled or suspended.",
      409,
      "domain_disabled",
    );
  const addresses = await client.many<AddressRecord>(
    "SELECT * FROM addresses WHERE tenant_id=$1 AND email=$2 AND (provider_id=$3 OR provider_id IS NULL) LIMIT 2",
    [tenant, input.email, provider.id],
  );
  if (
    addresses.length > 1 ||
    addresses.some((address) => address.provider_id !== provider.id)
  )
    throw new AddressProvisioningError(
      "An unbound or ambiguous address already exists; bind it explicitly before provisioning.",
      409,
      "address_binding_conflict",
    );
  const address = addresses[0] ?? null;
  if (address && address.status !== "active")
    throw new AddressProvisioningError(
      "The existing address is not active; provisioning does not reactivate it.",
      409,
      "address_inactive",
    );
  if (address?.domain_id && address.domain_id !== domain.id)
    throw new AddressProvisioningError(
      "The existing address belongs to a different domain record.",
      409,
      "domain_mismatch",
    );
  const ownerRef = input.owner ?? address?.owner_id ?? undefined;
  const owner = ownerRef
    ? await reference(client, tenant, "owners", ownerRef, "name")
    : null;
  const administratorRef =
    input.administrator ??
    address?.administrator_id ??
    (owner?.type === "agent" ? owner.id : undefined);
  const administrator = administratorRef
    ? await reference(client, tenant, "owners", administratorRef, "name")
    : null;
  if (administrator && !owner)
    throw new AddressProvisioningError(
      "An administrator requires an owner.",
      400,
      "invalid_ownership",
    );
  if (owner && !["human", "agent"].includes(owner.type))
    throw new AddressProvisioningError(
      "The owner type is unsupported.",
      400,
      "invalid_ownership",
    );
  if (owner && !administrator)
    throw new AddressProvisioningError(
      "A human owner requires an administering agent.",
      400,
      "invalid_ownership",
    );
  if (administrator && administrator.type !== "agent")
    throw new AddressProvisioningError(
      "The administrator must be an agent.",
      400,
      "invalid_ownership",
    );
  if (
    (address?.owner_id && address.owner_id !== owner?.id) ||
    (address?.administrator_id &&
      address.administrator_id !== administrator?.id)
  )
    throw new AddressProvisioningError(
      "Use the ownership transfer command to change an existing owner or administrator.",
      409,
      "ownership_conflict",
    );
  return {
    input: {
      ...input,
      provider_id: provider.id,
      domain_id: domain.id,
      ...(owner ? { owner: owner.id } : {}),
      ...(administrator ? { administrator: administrator.id } : {}),
    },
    domain,
    provider_id: provider.id,
    provider_type: provider.type,
    owner_id: owner?.id ?? null,
    administrator_id: administrator?.id ?? null,
    address,
  };
}
export async function startProvisioningJob(
  client: TypedQueryClient,
  tenant: string,
  input: AddressProvisioningInput,
  key: string,
  actor: string,
): Promise<ProvisioningJob> {
  if (
    !key ||
    key.length > 200 ||
    key !== key.trim() ||
    /[\x00-\x1f\x7f]/.test(key)
  )
    throw new AddressProvisioningError(
      "idempotency_key must be 1–200 safe characters.",
      400,
      "invalid_idempotency_key",
    );
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  const hash = createHash("sha256").update(payload).digest("hex");
  const row = await client.get<ProvisioningJob>(
    `INSERT INTO provisioning_jobs(id,tenant_id,kind,idempotency_key,input_hash,input,actor,status)
    VALUES($1,$2,'address',$3,$4,$5::jsonb,$6,'pending') ON CONFLICT(tenant_id,kind,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
    WHERE provisioning_jobs.input_hash=EXCLUDED.input_hash RETURNING *`,
    [randomUUID(), tenant, key, hash, payload, actor],
  );
  if (!row)
    throw new AddressProvisioningError(
      "This provisioning identity already names different inputs.",
      409,
      "idempotency_conflict",
    );
  return row;
}
export async function getProvisioningJob(
  client: TypedQueryClient,
  tenant: string,
  id: string,
): Promise<ProvisioningJob | null> {
  return client.get<ProvisioningJob>(
    "SELECT * FROM provisioning_jobs WHERE tenant_id=$1 AND id=$2 AND kind='address'",
    [tenant, id],
  );
}
export async function claimProvisioningJob(
  client: TypedQueryClient,
  tenant: string,
  id: string,
  recheckReady = false,
): Promise<ProvisioningJob | null> {
  return client.get<ProvisioningJob>(
    `UPDATE provisioning_jobs SET status='processing',lease=$3::uuid,updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND kind='address' AND (status IN ('pending','blocked') OR ($4::boolean AND status='ready') OR (status='processing' AND updated_at<now()-interval '2 minutes')) RETURNING *`,
    [tenant, id, randomUUID(), recheckReady],
  );
}
export async function blockProvisioningJob(
  client: TypedQueryClient,
  tenant: string,
  job: ProvisioningJob,
  receipt: ProvisioningReceipt,
): Promise<ProvisioningJob | null> {
  return client.get<ProvisioningJob>(
    `UPDATE provisioning_jobs SET status='blocked',receipt=$4::jsonb,lease=NULL,updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND lease=$3::uuid AND status='processing' RETURNING *`,
    [tenant, job.id, job.lease, JSON.stringify(receipt)],
  );
}
/** Called inside one tenant-scoped transaction. Provider/DNS I/O has already finished. */
export async function completeAddressProvisioning(
  client: TypedQueryClient,
  store: TenantScopedStore,
  tenant: string,
  job: ProvisioningJob,
  refs: AddressProvisioningRefs,
  receipt: ProvisioningReceipt,
  beforeCommit?: (tx: TypedQueryClient) => Promise<void>,
): Promise<ProvisioningJob | null> {
  const current = await client.get<{ actor: string }>(
    "SELECT actor FROM provisioning_jobs WHERE tenant_id=$1 AND id=$2 AND lease=$3::uuid AND status='processing' FOR UPDATE",
    [tenant, job.id, job.lease],
  );
  if (!current) return null;
  await client.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${tenant}:provision-address:${refs.provider_id}:${refs.input.email}`,
  ]);
  await client.execute(
    "SELECT id FROM domains WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tenant, refs.domain.id],
  );
  await client.execute(
    "SELECT id FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tenant, refs.provider_id],
  );
  await client.execute(
    "SELECT id FROM owners WHERE tenant_id=$1 AND id=ANY($2::text[]) FOR UPDATE",
    [tenant, [refs.owner_id, refs.administrator_id].filter(Boolean)],
  );
  await client.execute(
    "SELECT id FROM addresses WHERE tenant_id=$1 AND email=$2 AND provider_id=$3 FOR UPDATE",
    [tenant, refs.input.email, refs.provider_id],
  );
  const fresh = await resolveAddressProvisioning(client, tenant, refs.input);
  if (fresh.provider_type !== "ses")
    throw new AddressProvisioningError(
      "The provider binding changed during readiness checks.",
      409,
      "provider_mismatch",
    );
  await beforeCommit?.(client);
  const domainStatus = [
    "active",
    "verified",
    "ready",
    "outbound_disabled",
  ].includes(fresh.domain.status)
    ? fresh.domain.status
    : "inbound_ready";
  const domain = await store.updateDomain(fresh.domain.id, {
    verified: true,
    status: domainStatus,
  });
  if (!domain)
    throw new AddressProvisioningError(
      "The domain changed during provisioning.",
    );
  await store.applyDomainProvisioning(domain.id, {
    provisioning_status: [
      "ready",
      "active",
      "verified",
      "verified_inbound_ready",
    ].includes(fresh.domain.provisioning_status ?? "")
      ? "verified_inbound_ready"
      : "inbound_ready",
    last_error: null,
  });
  const address =
    fresh.address ??
    (await store.createAddress({
      email: fresh.input.email,
      provider_id: fresh.provider_id,
      verified: false,
    }));
  const next = await client.one<AddressRecord>(
    `UPDATE addresses SET domain_id=$3,receive_strategy='ses-s3',verified=true,provisioning_status='ready',
    owner_id=$4,administrator_id=$5,last_validated_at=$6::timestamptz,last_error=NULL,next_check_at=NULL,updated_at=now()
    WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [
      tenant,
      address.id,
      domain.id,
      fresh.owner_id,
      fresh.administrator_id,
      receipt.checked_at,
    ],
  );
  if (
    fresh.owner_id &&
    (address.owner_id !== fresh.owner_id ||
      address.administrator_id !== fresh.administrator_id)
  ) {
    await client.execute(
      `INSERT INTO address_ownership_events(id,tenant_id,address_id,action,previous_owner_id,previous_administrator_id,owner_id,administrator_id,actor,reason)
      VALUES($1,$2,$3,'assign',$4,$5,$6,$7,$8,'Address provisioning')`,
      [
        randomUUID(),
        tenant,
        address.id,
        address.owner_id ?? null,
        address.administrator_id ?? null,
        fresh.owner_id,
        fresh.administrator_id,
        current.actor,
      ],
    );
  }
  const result = { ...receipt, address_id: next.id };
  await client.execute(
    `INSERT INTO provisioning_events(id,tenant_id,entity_type,entity_id,from_state,to_state,detail_json)
    VALUES($1,$2,'address',$3,$4,'ready',$5::jsonb)`,
    [
      randomUUID(),
      tenant,
      address.id,
      address.provisioning_status ?? "unconfigured",
      JSON.stringify({ job_id: job.id, actor: current.actor, receipt: result }),
    ],
  );
  return client.get<ProvisioningJob>(
    "UPDATE provisioning_jobs SET status='ready',receipt=$4::jsonb,lease=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease=$3::uuid RETURNING *",
    [tenant, job.id, job.lease, JSON.stringify(result)],
  );
}
