import { canonicalSender } from "../../lib/email-address.js";
import {
  DomainOperationError,
  runDomainOperation,
} from "./domain-operations.js";
import type {
  TenantScopedStore,
  DomainRecord,
  AddressRecord,
} from "./store.js";
import type { SenderResolver } from "./sender.js";
import type { resolveMx } from "node:dns/promises";

export interface AddressProvisioningInput {
  email: string;
  provider_id: string;
  domain_id?: string;
  receive_strategy: "ses-s3" | "cf-routing" | "resend-webhook";
  forward_to?: string;
  owner?: string;
  administrator?: string;
  inbound_bucket?: string;
}
export interface AddressProvisioningRefs {
  input: AddressProvisioningInput;
  domain: DomainRecord;
  provider_id: string;
  provider_type: string;
  owner_id: string | null;
  administrator_id: string | null;
  address: AddressRecord | null;
}
export interface ProvisioningReceipt {
  ready: boolean;
  code: string;
  message: string;
  checked_at: string;
  address_id?: string;
  checks?: {
    provider_verified: boolean;
    mx_verified: boolean;
    receipt_route_verified: boolean;
    queue_route_verified: boolean;
  };
}
export interface ProvisioningJob {
  id: string;
  kind: "address";
  status: "pending" | "processing" | "blocked" | "ready";
  input: AddressProvisioningInput;
  receipt: ProvisioningReceipt | null;
  lease: string | null;
  created_at: string;
  updated_at: string;
}
export interface AddressProvisioningStore {
  resolveAddressProvisioning(
    input: AddressProvisioningInput,
  ): Promise<AddressProvisioningRefs>;
  startProvisioningJob(
    input: AddressProvisioningInput,
    key: string,
    actor: string,
  ): Promise<ProvisioningJob>;
  getProvisioningJob(id: string): Promise<ProvisioningJob | null>;
  claimProvisioningJob(id: string): Promise<ProvisioningJob | null>;
  blockProvisioningJob(
    job: ProvisioningJob,
    receipt: ProvisioningReceipt,
  ): Promise<ProvisioningJob | null>;
  completeAddressProvisioning(
    job: ProvisioningJob,
    refs: AddressProvisioningRefs,
    receipt: ProvisioningReceipt,
  ): Promise<ProvisioningJob | null>;
}
export class AddressProvisioningError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "provisioning_conflict",
  ) {
    super(message);
  }
}
export function normalizeAddressProvisioning(
  body: Record<string, unknown>,
): AddressProvisioningInput {
  const allowed = [
    "email",
    "provider_id",
    "domain_id",
    "receive_strategy",
    "forward_to",
    "owner",
    "administrator",
    "inbound_bucket",
    "dry_run",
    "idempotency_key",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new AddressProvisioningError(
      "Unknown address provisioning option",
      400,
      "invalid_option",
    );
  const email =
    typeof body.email === "string" ? canonicalSender(body.email) : null;
  if (!email)
    throw new AddressProvisioningError(
      "One valid mailbox is required",
      400,
      "invalid_email",
    );
  const text = (key: string) => {
    const value = body[key];
    if (value === undefined) return undefined;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 300 ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw new AddressProvisioningError(
        `${key} must be a nonempty safe string`,
        400,
        "invalid_option",
      );
    return value.trim();
  };
  const provider_id = text("provider_id");
  if (!provider_id)
    throw new AddressProvisioningError(
      "provider_id is required",
      400,
      "invalid_provider",
    );
  const receive_strategy = body.receive_strategy ?? "ses-s3";
  if (
    typeof receive_strategy !== "string" ||
    !["ses-s3", "cf-routing", "resend-webhook"].includes(receive_strategy)
  )
    throw new AddressProvisioningError(
      "Unknown receive strategy",
      400,
      "invalid_strategy",
    );
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean")
    throw new AddressProvisioningError(
      "dry_run must be boolean",
      400,
      "invalid_option",
    );
  const forward = text("forward_to");
  if (forward && !canonicalSender(forward))
    throw new AddressProvisioningError(
      "forward_to must be one valid mailbox",
      400,
      "invalid_forward_target",
    );
  if (forward && receive_strategy !== "cf-routing")
    throw new AddressProvisioningError(
      "forward_to is only valid for cf-routing",
      400,
      "invalid_forward_target",
    );
  return {
    email,
    provider_id,
    receive_strategy:
      receive_strategy as AddressProvisioningInput["receive_strategy"],
    ...(text("domain_id") ? { domain_id: text("domain_id") } : {}),
    ...(forward ? { forward_to: canonicalSender(forward)! } : {}),
    ...(text("owner") ? { owner: text("owner") } : {}),
    ...(text("administrator") ? { administrator: text("administrator") } : {}),
    ...(text("inbound_bucket")
      ? { inbound_bucket: text("inbound_bucket") }
      : {}),
  };
}
export interface AddressProvisioningDeps {
  resolveSender?: SenderResolver;
  env?: NodeJS.ProcessEnv;
  mx?: typeof resolveMx;
}

async function checkReadiness(
  store: TenantScopedStore,
  tenantId: string,
  refs: AddressProvisioningRefs,
  deps: AddressProvisioningDeps,
): Promise<ProvisioningReceipt> {
  const input = refs.input,
    env = deps.env ?? process.env;
  if (input.receive_strategy !== "ses-s3")
    throw new AddressProvisioningError(
      `The ${input.receive_strategy} adapter has no address readiness capability in this service. Configure SES/S3 or implement that adapter before retrying.`,
      503,
      "unsupported_receive_strategy",
    );
  const bucket = env.EMAILS_INGEST_S3_BUCKET?.trim(),
    queue = env.EMAILS_INGEST_QUEUE_URL?.trim();
  if (!bucket || !queue)
    throw new AddressProvisioningError(
      "Configure the server ingest S3 bucket and queue before provisioning an address.",
      503,
      "missing_ingest_configuration",
    );
  if (input.inbound_bucket && input.inbound_bucket !== bucket)
    throw new AddressProvisioningError(
      "inbound_bucket must match the server ingest bucket.",
      409,
      "bucket_mismatch",
    );
  const sender = await deps.resolveSender?.(tenantId, refs.provider_id);
  if (!sender || sender.provider !== "ses" || !sender.checkInboundQueue)
    throw new AddressProvisioningError(
      "Configure an SES provider binding with inbound queue verification capability.",
      503,
      "missing_provider_capability",
    );
  const evidence = await runDomainOperation(
    store,
    tenantId,
    refs.domain.id,
    "enable-inbound",
    {
      ...deps,
      providerId: refs.provider_id,
      dryRun: true,
      inboundAddress: input.email,
    },
  );
  const topic = "inbound" in evidence ? evidence.inbound?.topicArn : undefined;
  if (!topic)
    throw new AddressProvisioningError(
      "The SES S3 receipt action must notify the configured ingest queue through SNS.",
      409,
      "missing_receipt_notification",
    );
  const queueEvidence = await sender.checkInboundQueue(topic, queue);
  if (!queueEvidence.ready)
    throw new AddressProvisioningError(
      queueEvidence.reason,
      409,
      "queue_not_ready",
    );
  return {
    ready: true,
    code: "ready",
    message:
      "Provider, MX, SES/S3 and SNS/SQS routing verified. No round-trip message was sent.",
    checked_at: new Date().toISOString(),
    checks: {
      provider_verified: true,
      mx_verified: true,
      receipt_route_verified: true,
      queue_route_verified: true,
    },
  };
}
function failedReceipt(error: unknown): ProvisioningReceipt {
  return {
    ready: false,
    code:
      error instanceof AddressProvisioningError
        ? error.code
        : error instanceof DomainOperationError
          ? "domain_not_ready"
          : "readiness_unavailable",
    message:
      error instanceof AddressProvisioningError ||
      error instanceof DomainOperationError
        ? error.message
        : "Readiness checks could not complete; provider details are not exposed. Retry after checking the server configuration.",
    checked_at: new Date().toISOString(),
  };
}
export async function planAddressProvisioning(
  store: TenantScopedStore,
  tenantId: string,
  input: AddressProvisioningInput,
  deps: AddressProvisioningDeps,
) {
  const refs = await store.resolveAddressProvisioning(input);
  let receipt: ProvisioningReceipt;
  try {
    receipt = await checkReadiness(store, tenantId, refs, deps);
  } catch (error) {
    receipt = failedReceipt(error);
  }
  return {
    dry_run: true,
    plan: {
      ...refs.input,
      owner_id: refs.owner_id,
      administrator_id: refs.administrator_id,
      address_exists: refs.address !== null,
    },
    receipt,
  };
}
export async function runAddressProvisioningJob(
  store: TenantScopedStore,
  tenantId: string,
  id: string,
  deps: AddressProvisioningDeps,
): Promise<ProvisioningJob> {
  const job = await store.claimProvisioningJob(id);
  if (!job) {
    const current = await store.getProvisioningJob(id);
    if (!current)
      throw new AddressProvisioningError(
        "Provisioning job not found",
        404,
        "job_not_found",
      );
    return current;
  }
  try {
    const refs = await store.resolveAddressProvisioning(job.input);
    const receipt = await checkReadiness(store, tenantId, refs, deps);
    const completed = await store.completeAddressProvisioning(
      job,
      refs,
      receipt,
    );
    if (completed) return completed;
  } catch (error) {
    const blocked = await store.blockProvisioningJob(job, failedReceipt(error));
    if (blocked) return blocked;
  }
  const current = await store.getProvisioningJob(id);
  if (!current)
    throw new AddressProvisioningError(
      "Provisioning job not found",
      404,
      "job_not_found",
    );
  return current;
}
