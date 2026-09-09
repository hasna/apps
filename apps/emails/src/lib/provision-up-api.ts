import { setTimeout as delay } from "node:timers/promises";
import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
import { planRoundtrip } from "./roundtrip-plan.js";
export type ProvisionUpResult = Awaited<
  ReturnType<EmailsSelfHostClient["startProvisionUp"]>
>;
export type ProvisionUpTick = Awaited<
  ReturnType<EmailsSelfHostClient["tickProvisionUp"]>
>;
export interface ProvisionUpOptions {
  provider: string;
  addresses?: string;
  bucket?: string;
  source?: string;
  addMx?: boolean;
  forceMxSwitch?: boolean;
  count?: string;
  timeout?: string;
  test?: boolean;
  buyIfNeeded?: boolean;
  purchaseProfile?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
}
interface Selection {
  identity?: string;
}
async function request<T>(
  action: (client: EmailsSelfHostClient) => Promise<T>,
  selected: Selection,
) {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const identity = JSON.stringify([
    transport.baseUrl,
    transport.credential,
    transport.credentialFallbacks ?? [],
  ]);
  if (selected.identity !== undefined && selected.identity !== identity)
    throw new Error(
      "The Emails API account configuration changed. Inspect the saved run with the original account before continuing.",
    );
  selected.identity = identity; // in-memory only; never included in jobs or output
  const base = new URL(transport.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [
    transport.credential,
    ...(transport.credentialFallbacks ?? []).map((item) => item.value),
  ];
  for (let index = 0; index < credentials.length; index++)
    try {
      return await action(
        new EmailsSelfHostClient({
          baseUrl: base.toString().replace(/\/$/, ""),
          bearerToken: credentials[index],
          timeoutMs: 110000,
        }),
      );
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 401 ||
        index === credentials.length - 1
      )
        throw error;
    }
  throw new Error("No Emails API credential configured.");
}
const integer = (
  value: string | undefined,
  fallback: number,
  max: number,
  name: string,
) => {
  const n =
    value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw new Error(`${name} must be between 1 and ${max}.`);
  return n;
};
export function provisionUpBody(domain: string, opts: ProvisionUpOptions) {
  if (opts.buyIfNeeded !== undefined || opts.purchaseProfile !== undefined)
    throw new Error(
      "Provision up configures an already-owned domain. Complete registration with the Domains registrar commands, then configure the server binding. Purchase options and client AWS profiles are not supported here.",
    );
  const count =
    opts.count === undefined
      ? 1
      : /^\d+$/.test(opts.count)
        ? Number(opts.count)
        : NaN;
  if (!Number.isSafeInteger(count) || count < 0 || count > 100)
    throw new Error("Count must be between 0 and 100.");
  const plan = planRoundtrip({
    domain,
    provider: opts.provider,
    addresses: opts.addresses,
    count: Math.max(1, count),
    bucket: opts.bucket,
    source: opts.source,
    idempotencyKey: opts.idempotencyKey ?? "validate",
  });
  if (opts.forceMxSwitch && !opts.addMx)
    throw new Error("MX switching requires explicit --add-mx.");
  return {
    domain: plan.items[0]!.from.split("@")[1]!,
    provider_id: plan.provider,
    addresses: opts.addresses ?? "one,two,three",
    count: opts.test === false ? 0 : count,
    add_mx: opts.addMx ?? false,
    force_mx_switch: opts.forceMxSwitch ?? false,
    dry_run: opts.dryRun ?? false,
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    ...(opts.source ? { source_id: opts.source } : {}),
    ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
  };
}
export async function runProvisionUp(
  domain: string,
  opts: ProvisionUpOptions,
  signal?: AbortSignal,
  onCheckpoint?: (result: ProvisionUpResult) => void,
): Promise<ProvisionUpResult> {
  const body = provisionUpBody(domain, opts),
    seconds = integer(opts.timeout, 600, 3600, "Timeout"),
    selection: Selection = {};
  signal?.throwIfAborted();
  const deadline = Date.now() + seconds * 1000;
  const init = () => ({
    signal: AbortSignal.any([
      AbortSignal.timeout(Math.max(1, Math.min(110000, deadline - Date.now()))),
      ...(signal ? [signal] : []),
    ]),
  });
  let result = await request(
    (client) => client.startProvisionUp(body, init()),
    selection,
  );
  onCheckpoint?.(result);
  while (
    !result.dry_run &&
    result.job &&
    ["pending", "processing"].includes(result.job.status) &&
    Date.now() < deadline
  ) {
    await delay(Math.min(1000, Math.max(1, deadline - Date.now())), undefined, {
      signal,
    });
    if (Date.now() >= deadline) break;
    result = await request(
      (client) => client.runProvisionUp(result.job!.id, {}, init()),
      selection,
    );
    onCheckpoint?.(result);
  }
  return result;
}
export const provisionUpSucceeded = (result: ProvisionUpResult) =>
  result.dry_run === true ||
  (result.job?.status === "ready" && result.job.receipt?.complete === true);
export function formatProvisionUp(result: ProvisionUpResult): string {
  if (result.dry_run)
    return "Provisioning plan only; no jobs, DNS records, addresses or messages were created.";
  if (!result.job) return "No provisioning run was returned.";
  const job = result.job,
    receipt = job.receipt;
  return [
    `${job.input.domain}: ${job.status} (${job.id})`,
    receipt
      ? `Step: ${receipt.phase}. Delivery test: ${receipt.delivery_tested ? "verified" : job.input.test_count ? "not yet verified" : "skipped"}.`
      : "Waiting for the first checkpoint.",
    ...(receipt?.errors ?? []).map((error) => `${error.code} (${error.at})`),
    ...(job.status !== "ready"
      ? [
          `Inspect with 'emails provision run ${job.id}'. Resume the frozen intent with 'emails provision retry ${job.input.domain} --job ${job.id}' and the daemon.`,
        ]
      : []),
  ].join("\n");
}
export async function inspectProvisionUp(id: string, signal?: AbortSignal) {
  if (!id.trim()) throw new Error("Run ID required.");
  return request((client) => client.getProvisionUp(id, { signal }), {});
}
export async function retryProvisionUp(
  domain: string,
  opts: { provider?: string; job?: string },
  signal?: AbortSignal,
) {
  if (
    !domain.trim() ||
    (opts.provider !== undefined && !opts.provider.trim()) ||
    (opts.job !== undefined && !opts.job.trim())
  )
    throw new Error("Domain and supplied selectors must not be blank.");
  return request(
    (client) =>
      client.retryProvisionUp(
        {
          domain,
          ...(opts.provider ? { provider_id: opts.provider } : {}),
          ...(opts.job ? { job_id: opts.job } : {}),
        },
        { signal },
      ),
    {},
  );
}
export async function runProvisionDaemon(
  opts: {
    provider: string;
    bucket?: string;
    addMx?: boolean;
    forceMxSwitch?: boolean;
    once?: boolean;
    interval?: string;
    maxTicks?: string;
  },
  signal: AbortSignal,
  onTick: (result: ProvisionUpTick) => void,
) {
  if (!opts.provider.trim()) throw new Error("Provider ID required.");
  const interval = integer(opts.interval, 30, 3600, "Interval"),
    max = opts.once
      ? 1
      : opts.maxTicks === undefined
        ? Infinity
        : integer(opts.maxTicks, 1, 100000, "Max ticks"),
    selection: Selection = {};
  const body = {
    provider_id: opts.provider,
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    ...(opts.addMx !== undefined ? { add_mx: opts.addMx } : {}),
    ...(opts.forceMxSwitch !== undefined
      ? { force_mx_switch: opts.forceMxSwitch }
      : {}),
  };
  for (let tick = 0; tick < max; tick++) {
    signal.throwIfAborted();
    const result = await request(
      (client) => client.tickProvisionUp(body, { signal }),
      selection,
    );
    onTick(result);
    if (tick + 1 < max) await delay(interval * 1000, undefined, { signal });
  }
}
