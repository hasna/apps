import {
  advanceProvisionUp,
  normalizeProvisionUp,
  ProvisionUpError,
  upDnsInput,
  upHash,
  type BoundProvisionUpInput,
  type ProvisionUpJob,
} from "./provision-up.js";
import {
  connectInput,
  publishDomainDns,
  sameDomainDnsSender,
} from "./domain-dns.js";
import { resolveDnsBinding } from "./domain-dns-provider.js";
import { runAddressProvisioningJob } from "./address-provisioning.js";
import { SelfHostedMailDataSource } from "../../lib/self-hosted-mail-data-source.js";
import { resourceSpecForPath } from "./resources.js";
import type { TenantScopedStore } from "./store.js";
import type { SelfHostedServiceDeps } from "./service.js";
import type { SelfHostedSender } from "./sender.js";
import type { IngestBatchReport } from "../../lib/inbox-ingest-api.js";

export const publicProvisionUpJob = (job: ProvisionUpJob) => ({
  id: job.id,
  status: job.status,
  input: {
    domain: job.input.domain,
    provider_id: job.input.provider_id,
    addresses: job.input.addresses,
    test_count: job.input.test_count,
    add_mx: job.input.add_mx,
    force_mx_switch: job.input.force_mx_switch,
    bucket: job.input.bucket,
    source_id: job.input.source_id,
  },
  receipt: job.receipt,
  created_at: job.created_at,
  updated_at: job.updated_at,
});
export interface ProvisionUpApiContext {
  deps: SelfHostedServiceDeps;
  store: TenantScopedStore;
  tenant: string;
  actor: string;
  request(
    path: string,
    body?: Record<string, unknown>,
    boundSender?: SelfHostedSender,
  ): Promise<Response>;
}
export async function provisionUpApi(
  path: string,
  method: string,
  body: Record<string, unknown>,
  ctx: ProvisionUpApiContext,
): Promise<unknown> {
  const { store, tenant, deps, actor } = ctx,
    jobs = store.provisionUpJobs(),
    env = deps.env ?? process.env;
  const advance = async (id: string) => {
    const saved = await jobs.get(id);
    if (!saved) throw new ProvisionUpError("Provisioning run not found.", 404);
    const signal = AbortSignal.timeout(105000);
    const sender = await deps.resolveSender?.(tenant, saved.input.provider_id);
    const boundSender: SelfHostedSender | undefined = sender
      ? {
          ...sender,
          send: (value) => {
            signal.throwIfAborted();
            return sender.send(value, signal);
          },
          ...(sender.verifyDomain
            ? {
                verifyDomain: (domain: string) => {
                  signal.throwIfAborted();
                  return sender.verifyDomain!(domain, signal);
                },
              }
            : {}),
          ...(sender.checkInboundDomain
            ? {
                checkInboundDomain: (
                  domain: string,
                  bucket: string,
                  mailbox?: string,
                ) => {
                  signal.throwIfAborted();
                  return sender.checkInboundDomain!(
                    domain,
                    bucket,
                    mailbox,
                    signal,
                  );
                },
              }
            : {}),
          ...(sender.checkInboundQueue
            ? {
                checkInboundQueue: (topic: string, queue: string) => {
                  signal.throwIfAborted();
                  return sender.checkInboundQueue!(topic, queue, signal);
                },
              }
            : {}),
        }
      : undefined;
    let readRequests = 0;
    // Internal reads still pass through the normal authenticated routes and their permissions.
    const reader = new SelfHostedMailDataSource({
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "internal-route-context",
      fetchImpl: async (url, init) => {
        signal.throwIfAborted();
        if (++readRequests > 24)
          throw new ProvisionUpError(
            "Receipt query exceeded the step request budget.",
          );
        const parsed = new URL(String(url));
        if (
          parsed.origin !== "http://127.0.0.1:1" ||
          (init?.method && init.method !== "GET")
        )
          throw new ProvisionUpError("Unexpected receipt request.");
        return ctx.request(parsed.pathname + parsed.search);
      },
    });
    return advanceProvisionUp(id, {
      store: jobs,
      guard: async (input) => {
        signal.throwIfAborted();
        const binding = resolveDnsBinding(
          env,
          tenant,
          input.provider_id,
          input.domain,
        );
        if (upHash(binding) !== upHash(input.dns_binding))
          throw new ProvisionUpError("The saved DNS binding changed.");
        const current = await deps.resolveSender?.(tenant, input.provider_id);
        if (!sender || !sameDomainDnsSender(sender, current))
          throw new ProvisionUpError(
            "The mail provider binding changed during this step.",
          );
      },
      dns: (input) =>
        publishDomainDns(
          store,
          tenant,
          upDnsInput(input),
          false,
          deps.resolveSender,
          env,
          actor,
          deps.domainDns?.client,
        ),
      address: async (input, email, key) => {
        const refs = await store.resolveAddressProvisioning({
          email,
          provider_id: input.provider_id,
          receive_strategy: "ses-s3",
          ...(input.bucket ? { inbound_bucket: input.bucket } : {}),
        });
        const child = await store.startProvisioningJob(refs.input, key, actor);
        return runAddressProvisioningJob(store, tenant, child.id, {
          resolveSender: () => boundSender ?? null,
          env,
          mx: deps.provisioning?.resolveMx,
        });
      },
      send: (item, input) =>
        ctx.request(
          "/v1/messages/send",
          {
            from: item.from,
            to: [item.to],
            subject: item.subject,
            text: item.token,
            provider_id: input.provider_id,
            idempotency_key: item.send_key,
          },
          boundSender,
        ),
      read: (item) =>
        reader.verificationCandidates(item.to, {
          subject: item.subject,
          from: item.from,
          limit: 10,
        }),
      ...(saved.input.source_id || saved.input.bucket
        ? {
            sync: async (
              input: BoundProvisionUpInput,
              cursor?: string | null,
            ) => {
              const response = await ctx.request("/v1/inbox/sync-s3", {
                provider_id: input.provider_id,
                limit: 10,
                ...(input.source_id ? { source_id: input.source_id } : {}),
                ...(input.bucket ? { bucket: input.bucket } : {}),
                ...(cursor ? { cursor } : {}),
              });
              const report = (await response.json()) as IngestBatchReport;
              if (
                !response.ok ||
                !report.ok ||
                report.sources?.length !== 1 ||
                report.sources[0]!.error > 0
              )
                throw new ProvisionUpError(
                  "Source synchronization was not confirmed.",
                );
              return report.sources[0]!.next_cursor ?? null;
            },
          }
        : {}),
    });
  };
  if (path === "/v1/provision/up") {
    if (method !== "POST")
      throw new ProvisionUpError("Method not allowed.", 405);
    const input = normalizeProvisionUp(body),
      refs = await store.resolveDomainConnect(connectInput(upDnsInput(input)));
    if (refs.provider_type !== "ses")
      throw new ProvisionUpError(
        "Provision up requires a configured SES provider.",
      );
    if (refs.domain?.status === "outbound_disabled")
      throw new ProvisionUpError("Sending is disabled for this domain.");
    const provider = await store.getResource(
      resourceSpecForPath("providers")!,
      refs.input.provider_id,
    );
    const bound: BoundProvisionUpInput = {
      ...input,
      provider_id: refs.input.provider_id,
      provider_type: "ses",
      provider_region:
        typeof provider?.region === "string" ? provider.region : null,
      dns_binding: resolveDnsBinding(
        env,
        tenant,
        refs.input.provider_id,
        input.domain,
      ),
    };
    if (body.dry_run === true)
      return {
        dry_run: true,
        job: null,
        plan: {
          input,
          requires_existing_receiver: true,
          delivery_test_requested: input.test_count > 0,
          dns: await publishDomainDns(
            store,
            tenant,
            upDnsInput(bound),
            true,
            deps.resolveSender,
            env,
            actor,
            deps.domainDns?.client,
          ),
        },
      };
    const key =
      body.idempotency_key === undefined
        ? `up:${upHash([bound.provider_id, bound.domain])}`
        : body.idempotency_key;
    if (typeof key !== "string")
      throw new ProvisionUpError("Idempotency key must be a string.", 400);
    const job = await jobs.start(bound, key, actor);
    return { dry_run: false, job: publicProvisionUpJob(job) };
  }
  if (path === "/v1/provision/retry") {
    if (method !== "POST")
      throw new ProvisionUpError("Method not allowed.", 405);
    if (
      Object.keys(body).some(
        (key) => !["domain", "provider_id", "job_id"].includes(key),
      ) ||
      typeof body.domain !== "string" ||
      !body.domain.trim()
    )
      throw new ProvisionUpError(
        "Retry requires a domain and optional provider/job ID; saved inputs cannot be changed.",
        400,
      );
    for (const key of ["provider_id", "job_id"])
      if (
        body[key] !== undefined &&
        (typeof body[key] !== "string" || !String(body[key]).trim())
      )
        throw new ProvisionUpError(`Invalid ${key}.`, 400);
    const job = await jobs.retry(
      body.domain.trim().toLowerCase(),
      body.provider_id as string | undefined,
      body.job_id as string | undefined,
    );
    return { job: publicProvisionUpJob(job) };
  }
  if (path === "/v1/provision/tick") {
    if (method !== "POST")
      throw new ProvisionUpError("Method not allowed.", 405);
    if (
      Object.keys(body).some(
        (key) =>
          !["provider_id", "bucket", "add_mx", "force_mx_switch"].includes(key),
      ) ||
      typeof body.provider_id !== "string" ||
      !body.provider_id.trim()
    )
      throw new ProvisionUpError(
        "Tick requires an exact provider ID and optional saved-intent assertions.",
        400,
      );
    for (const key of ["add_mx", "force_mx_switch"])
      if (body[key] !== undefined && typeof body[key] !== "boolean")
        throw new ProvisionUpError(`Invalid ${key}.`, 400);
    if (
      body.bucket !== undefined &&
      (typeof body.bucket !== "string" || !body.bucket.trim())
    )
      throw new ProvisionUpError("Invalid bucket assertion.", 400);
    const due = await jobs.due(body.provider_id, {
      bucket: body.bucket as string | undefined,
      add_mx: body.add_mx as boolean | undefined,
      force_mx_switch: body.force_mx_switch as boolean | undefined,
    });
    const results = [];
    for (const id of due) results.push(publicProvisionUpJob(await advance(id)));
    return { jobs: results, advanced: results.length };
  }
  const match = path.match(/^\/v1\/provision\/runs\/([^/]+)(\/run)?$/);
  if (!match) throw new ProvisionUpError("Provisioning route not found.", 404);
  if (method !== (match[2] ? "POST" : "GET"))
    throw new ProvisionUpError("Method not allowed.", 405);
  if (Object.keys(body).length)
    throw new ProvisionUpError("Saved provisioning inputs are immutable.", 400);
  const id = decodeURIComponent(match[1]!);
  const job = match[2] ? await advance(id) : await jobs.get(id);
  if (!job) throw new ProvisionUpError("Provisioning run not found.", 404);
  return { job: publicProvisionUpJob(job) };
}
