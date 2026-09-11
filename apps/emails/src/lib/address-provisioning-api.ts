import { randomUUID } from "node:crypto";
import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { readStorageWiring } from "./storage-wiring.js";
import { resolveSelfHostedConfig } from "../db/self-hosted-store.js";

export interface ProvisionAddressOptions {
  provider: string;
  domain?: string;
  receive?: "ses-s3" | "cf-routing" | "resend-webhook";
  forwardTo?: string;
  owner?: string;
  administrator?: string;
  bucket?: string;
  dryRun?: boolean;
  wait?: boolean;
  timeout?: number | string;
  interval?: number | string;
  idempotencyKey?: string;
}
export type ProvisionAddressResult = Awaited<
  ReturnType<EmailsSelfHostClient["provisionAddress"]>
> & { timed_out?: boolean };
const duration = (
  value: number | string | undefined,
  fallback: number,
  max: number,
  name: string,
) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max)
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  return number;
};
function client(): EmailsSelfHostClient {
  if (readStorageWiring(process.env).kind !== "api")
    throw new Error(
      "Address provisioning requires an authenticated Emails API configuration; it cannot use a local database.",
    );
  const config = resolveSelfHostedConfig(process.env, {
    selectedMode: "self_hosted",
  });
  const base = new URL(config.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return new EmailsSelfHostClient({
    baseUrl: base.toString().replace(/\/$/, ""),
    bearerToken: config.credential,
  });
}
async function request<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 403, 404, 409].includes(error.status) &&
      error.body &&
      typeof error.body === "object" &&
      "reason" in error.body &&
      typeof error.body.reason === "string"
    ) {
      // The SDK deliberately discards arbitrary server error text. Recover only
      // known machine reasons, using local text that cannot expose provider data.
      const reasons: Record<string, string> = {
        invalid_option: "Options must be recognized and nonempty safe values.",
        invalid_email: "One valid mailbox is required.",
        invalid_provider: "Select a registered provider.",
        invalid_strategy: "Unknown receive strategy.",
        invalid_forward_target:
          "A valid forward target is supported only with cf-routing.",
        invalid_idempotency_key:
          "The idempotency key must be 1–200 safe characters.",
        reference_not_found:
          "A provider, domain, or owner reference is missing or ambiguous in this tenant.",
        provider_inactive: "The selected provider is inactive.",
        provider_mismatch: "The domain must be bound to the selected provider.",
        domain_mismatch:
          "The selected domain must match the mailbox and existing address.",
        domain_disabled: "The selected domain is disabled or suspended.",
        address_binding_conflict:
          "Bind the existing unbound or ambiguous address explicitly first.",
        address_inactive:
          "The existing address is inactive; provisioning does not reactivate it.",
        invalid_ownership:
          "An owner is required for an administrator; human owners require an agent administrator.",
        ownership_conflict:
          "Use ownership transfer to change an existing owner or administrator.",
        idempotency_conflict:
          "This provisioning identity already names different inputs.",
        provisioning_conflict:
          "Provisioning state changed; inspect the job before retrying.",
        operator_required:
          "Address provisioning requires tenant operator permission.",
      };
      const message = Object.hasOwn(reasons, error.body.reason)
        ? reasons[error.body.reason]
        : undefined;
      if (message)
        throw new Error(`Address provisioning: ${message}`, { cause: error });
    }
    throw error;
  }
}
export async function provisionAddress(
  email: string,
  options: ProvisionAddressOptions,
): Promise<ProvisionAddressResult> {
  const timeout = duration(options.timeout, 120, 300, "timeout"),
    interval = duration(options.interval, 5, 60, "interval");
  const deadline = Date.now() + timeout * 1000;
  const requestOptions = () => ({
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(30000, deadline - Date.now())),
    ),
  });
  const result: ProvisionAddressResult = await request(() =>
    client().provisionAddress(
      {
        email,
        provider_id: options.provider,
        ...(options.domain !== undefined ? { domain_id: options.domain } : {}),
        receive_strategy: options.receive ?? "ses-s3",
        ...(options.forwardTo !== undefined
          ? { forward_to: options.forwardTo }
          : {}),
        ...(options.owner !== undefined ? { owner: options.owner } : {}),
        ...(options.administrator !== undefined
          ? { administrator: options.administrator }
          : {}),
        ...(options.bucket !== undefined
          ? { inbound_bucket: options.bucket }
          : {}),
        dry_run: options.dryRun ?? false,
        idempotency_key: options.idempotencyKey ?? randomUUID(),
      },
      requestOptions(),
    ),
  );
  if (!options.wait || !("job" in result)) return result;
  let current: Awaited<ReturnType<EmailsSelfHostClient["runProvisioningJob"]>> =
    result;
  while (current.job.status !== "ready" && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(interval * 1000, deadline - Date.now())),
    );
    if (Date.now() >= deadline) break;
    const id = current.job.id;
    try {
      current = await request(() =>
        client().runProvisioningJob(id, {}, requestOptions()),
      );
    } catch (error) {
      if (Date.now() >= deadline) return { ...current, timed_out: true };
      throw error;
    }
  }
  return current.job.status === "ready"
    ? current
    : { ...current, timed_out: true };
}
export function formatAddressProvisioningResult(
  result: ProvisionAddressResult,
): string {
  if ("job" in result)
    return `Provisioning ${result.job.id}: ${result.job.status}${result.timed_out ? " (wait timed out)" : ""}\n${result.job.receipt?.message ?? "Readiness checks are processing; inspect this job again."}`;
  return `Dry run: ${result.receipt.ready ? "readiness checks passed" : "blocked"}; no address or ownership records changed.\n${result.receipt.message}`;
}
export function addressProvisioningReady(
  result: ProvisionAddressResult,
): boolean {
  return "job" in result ? result.job.status === "ready" : result.receipt.ready;
}

export async function inspectAddressProvisioningJob(
  id: string,
  retry = false,
): Promise<ProvisionAddressResult> {
  return request(() =>
    retry
      ? client().runProvisioningJob(
          id,
          {},
          { signal: AbortSignal.timeout(30000) },
        )
      : client().getProvisioningJob(id, { signal: AbortSignal.timeout(30000) }),
  );
}
