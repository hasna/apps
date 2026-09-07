import { createHash } from "node:crypto";
import {
  connectDomain,
  normalizeDomainConnect,
  type DomainConnectInput,
} from "./domain-connect.js";
import {
  resolveDnsBinding,
  createBoundDnsClient,
  buildDnsPlan,
  dnsPlanConfirmed,
  DomainDnsError,
  type DomainDnsBinding,
  type DomainDnsPlan,
  type BoundDnsClient,
} from "./domain-dns-provider.js";
import type { TenantScopedStore } from "./store.js";
import type { SenderResolver } from "./sender.js";

interface SenderBindingIdentity {
  provider: string;
  region?: string;
  credentialSource?: string;
  credentialRevision?: number;
}
/** Compare managed envelope generations, never credential material or fresh object identity. */
export function sameDomainDnsSender(
  initial: SenderBindingIdentity,
  current: SenderBindingIdentity | null | undefined,
): boolean {
  if (
    !current ||
    initial.provider !== current.provider ||
    initial.region !== current.region ||
    initial.credentialSource !== current.credentialSource
  )
    return false;
  if (initial.credentialSource !== "managed_envelope")
    return initial === current;
  return (
    Number.isSafeInteger(initial.credentialRevision) &&
    initial.credentialRevision! >= 0 &&
    initial.credentialRevision === current.credentialRevision
  );
}

export interface DomainDnsInput extends DomainConnectInput {
  operation: "setup_cloudflare" | "provision_domain";
  add_mx: boolean;
  force_mx_switch: boolean;
  mail_from?: string;
  mx_server?: string;
}
export interface DomainDnsResult {
  dry_run: boolean;
  job: {
    id: string | null;
    domain: string;
    provider_id: string;
    zone_id: string;
    status:
      | "planned"
      | "processing"
      | "blocked"
      | "pending_verification"
      | "verified";
    phase: string;
    dns_published: boolean;
    verified_for_sending: boolean;
    requires_reconciliation: boolean;
    plan: DomainDnsPlan | null;
    message: string;
  };
}
export interface DomainDnsClaim {
  id: string;
  lease: string | null;
  input: DomainDnsInput;
  binding: DomainDnsBinding;
  fingerprint: string;
  previous: DomainDnsResult | null;
}
export const dnsFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const connectInput = (input: DomainDnsInput): DomainConnectInput => ({
  domain: input.domain,
  provider_id: input.provider_id,
  register_provider: input.register_provider,
  dns_provider: "cloudflare",
});
export function normalizeDomainDns(
  body: Record<string, unknown>,
  operation: DomainDnsInput["operation"],
): DomainDnsInput {
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "domain",
          "provider_id",
          "register_provider",
          "dry_run",
          "add_mx",
          "force_mx_switch",
          "mail_from",
          "mx_server",
          "send",
        ].includes(key),
    )
  )
    throw new DomainDnsError("Unknown domain DNS option.", 400);
  const base = normalizeDomainConnect({
    domain: body.domain,
    provider_id: body.provider_id,
    dns_provider: "cloudflare",
    register_provider:
      operation === "provision_domain" || body.register_provider === true,
    ...(body.dry_run === undefined ? {} : { dry_run: body.dry_run }),
  });
  for (const key of ["register_provider", "add_mx", "force_mx_switch"] as const)
    if (body[key] !== undefined && typeof body[key] !== "boolean")
      throw new DomainDnsError(`${key} must be boolean.`, 400);
  if (
    body.send !== undefined &&
    (operation !== "provision_domain" || body.send !== "ses")
  )
    throw new DomainDnsError(
      "Domain provisioning currently requires SES sending.",
      400,
    );
  if (body.force_mx_switch === true && body.add_mx !== true)
    throw new DomainDnsError(
      "MX switching requires explicit MX publication.",
      400,
    );
  let mailFrom: string | undefined;
  if (operation === "provision_domain") {
    if (
      body.mail_from !== undefined &&
      (typeof body.mail_from !== "string" || !body.mail_from.trim())
    )
      throw new DomainDnsError("MAIL FROM requires a valid subdomain.", 400);
    const proposed = String(body.mail_from ?? `mail.${base.domain}`)
      .trim()
      .toLowerCase();
    mailFrom = normalizeDomainConnect({
      domain: proposed.includes(".") ? proposed : `${proposed}.${base.domain}`,
      provider_id: base.provider_id,
    }).domain;
    if (!mailFrom.endsWith(`.${base.domain}`))
      throw new DomainDnsError(
        "MAIL FROM must be a subdomain of this bound domain.",
        400,
      );
  } else if (body.mail_from !== undefined)
    throw new DomainDnsError(
      "Use provision domain to configure MAIL FROM.",
      400,
    );
  if (
    body.mx_server !== undefined &&
    (typeof body.mx_server !== "string" ||
      !body.mx_server.trim() ||
      body.add_mx !== true)
  )
    throw new DomainDnsError(
      "MX server requires explicit MX publication.",
      400,
    );
  return {
    ...base,
    operation,
    add_mx: body.add_mx === true,
    force_mx_switch: body.force_mx_switch === true,
    ...(mailFrom ? { mail_from: mailFrom } : {}),
    ...(body.mx_server !== undefined
      ? {
          mx_server: String(body.mx_server)
            .trim()
            .toLowerCase()
            .replace(/\.$/, ""),
        }
      : {}),
  };
}

export async function publishDomainDns(
  store: TenantScopedStore,
  tenant: string,
  requested: DomainDnsInput,
  dryRun: boolean,
  resolveSender: SenderResolver | undefined,
  env: NodeJS.ProcessEnv,
  actor: string,
  factory: (
    binding: DomainDnsBinding,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ) => BoundDnsClient = createBoundDnsClient,
): Promise<DomainDnsResult> {
  const refs = await store.resolveDomainConnect(connectInput(requested));
  const input = { ...requested, provider_id: refs.input.provider_id };
  const binding = resolveDnsBinding(
    env,
    tenant,
    input.provider_id,
    input.domain,
  );
  const sender = await resolveSender?.(tenant, input.provider_id);
  if (
    !sender ||
    sender.provider !== refs.provider_type ||
    !sender.readDomainConnection ||
    (input.register_provider && !sender.registerDomain)
  )
    throw new DomainDnsError(
      "Configure the matching server mail provider binding before publishing DNS.",
      503,
    );
  if (
    (input.operation === "provision_domain" || input.register_provider) &&
    refs.provider_type !== "ses"
  )
    throw new DomainDnsError(
      "Provider registration and MAIL FROM provisioning in this workflow require SES.",
    );
  if (input.mail_from && !sender.setMailFrom)
    throw new DomainDnsError(
      "The bound SES provider cannot configure MAIL FROM.",
      503,
    );
  if (
    input.add_mx &&
    (!binding.inbound_mx ||
      refs.provider_type !== "ses" ||
      !sender.region ||
      binding.inbound_mx !== `inbound-smtp.${sender.region}.amazonaws.com`)
  )
    throw new DomainDnsError(
      "Inbound MX requires the exact SES endpoint for the server-bound provider region.",
    );
  if (input.mx_server !== undefined && input.mx_server !== binding.inbound_mx)
    throw new DomainDnsError(
      "The requested MX server differs from the explicit server DNS binding.",
    );
  const initial: DomainDnsResult = {
    dry_run: dryRun,
    job: {
      id: null,
      domain: input.domain,
      provider_id: input.provider_id,
      zone_id: binding.zone_id,
      status: dryRun ? "planned" : "processing",
      phase: "resolve",
      dns_published: false,
      verified_for_sending: false,
      requires_reconciliation: false,
      plan: null,
      message: dryRun
        ? "Server bindings resolved. Execution will inspect provider and DNS state before making changes; this plan made no provider calls or writes."
        : "Inspecting provider and DNS state.",
    },
  };
  if (dryRun) return initial;
  const jobs = store.domainDnsJobs(),
    claim = await jobs.claim(input, binding, actor);
  if (!claim.lease) return (await jobs.read(claim.id))!;
  let result: DomainDnsResult = {
    ...initial,
    job: { ...initial.job, id: claim.id },
  };
  const signal = AbortSignal.timeout(90000),
    capturedToken = env[binding.token_env];
  const guard = async () => {
    signal.throwIfAborted();
    const currentBinding = resolveDnsBinding(
      env,
      tenant,
      input.provider_id,
      input.domain,
    );
    if (
      dnsFingerprint(currentBinding) !== dnsFingerprint(binding) ||
      env[binding.token_env] !== capturedToken ||
      !sameDomainDnsSender(
        sender,
        await resolveSender?.(tenant, input.provider_id),
      )
    )
      throw new DomainDnsError(
        "Server bindings changed during this operation. No further writes are allowed.",
      );
    await jobs.assertCurrent(claim, refs.provider_type);
  };
  const checkpoint = async (
    phase: string,
    patch: Partial<DomainDnsResult["job"]> = {},
  ) => {
    await guard();
    result = { ...result, job: { ...result.job, ...patch, phase } };
    await jobs.save(claim, refs.provider_type, result, false);
  };
  try {
    const cf = factory(binding, env, signal);
    await cf.getZone();
    let records = await cf.listRecords();
    await guard();
    if (claim.previous?.job.requires_reconciliation) {
      result = {
        ...result,
        job: {
          ...result.job,
          requires_reconciliation: true,
          plan: claim.previous.job.plan,
        },
      };
      if (
        !claim.previous.job.plan ||
        !dnsPlanConfirmed(claim.previous.job.plan, records)
      )
        throw new DomainDnsError(
          "An earlier DNS batch has uncertain acceptance. Its original plan has not appeared completely in the provider inventory; no further mutations are allowed.",
        );
      await checkpoint("reconciled", {
        requires_reconciliation: false,
        message: "The previous DNS batch was confirmed by provider inventory.",
      });
    }
    // Refuse an unapproved root-MX change before SES registration or MAIL FROM writes.
    if (
      input.add_mx &&
      !input.force_mx_switch &&
      records.some(
        (record) =>
          record.type === "MX" &&
          record.name.toLowerCase().replace(/\.$/, "") === input.domain &&
          (record.content.toLowerCase().replace(/\.$/, "") !==
            binding.inbound_mx ||
            record.priority !== 10),
      )
    )
      throw new DomainDnsError(
        "Existing root MX requires explicit --force-mx-switch before provider or DNS changes.",
      );
    const before = await connectDomain(
      store,
      tenant,
      connectInput(input),
      false,
      resolveSender,
      actor,
      signal,
      guard,
    );
    if (
      !before.connection.provider_registered ||
      before.connection.status === "blocked" ||
      before.connection.status === "processing"
    )
      throw new DomainDnsError(
        "Provider connection is incomplete; inspect its connection receipt before DNS publication.",
      );
    let tasks = before.connection.dns_tasks;
    if (input.mail_from) {
      const existing = tasks
        .filter((task) => task.purpose === "MAIL_FROM" && task.type === "MX")
        .map((task) => task.name);
      if (existing.some((name) => name !== input.mail_from))
        throw new DomainDnsError(
          "SES has a different MAIL FROM domain. Review that provider configuration explicitly before changing it.",
        );
      if (!existing.length) {
        await checkpoint("mail_from", {
          message: "Configuring the requested SES MAIL FROM subdomain.",
        });
        await sender.setMailFrom!(input.domain, input.mail_from, signal);
      }
      await guard();
      const refreshed = await sender.readDomainConnection(input.domain, signal);
      tasks = refreshed.dns_tasks;
      if (
        !tasks.some(
          (task) =>
            task.purpose === "MAIL_FROM" && task.name === input.mail_from,
        )
      )
        throw new DomainDnsError(
          "SES has not confirmed the requested MAIL FROM configuration; DNS publication is pending.",
        );
    }
    await guard();
    const plan = buildDnsPlan(
      binding,
      tasks,
      records,
      input.add_mx,
      input.force_mx_switch,
    );
    if (
      claim.previous?.job.requires_reconciliation &&
      (plan.creates.length || plan.deletes.length)
    ) {
      result.job.requires_reconciliation = true;
      throw new DomainDnsError(
        "An earlier DNS batch has uncertain acceptance and has not fully appeared in the provider inventory. Review that batch before attempting another mutation.",
      );
    }
    await checkpoint("dns_plan", {
      plan,
      message: "Validated the bound DNS publication plan.",
    });
    if (plan.creates.length || plan.deletes.length) {
      // Re-read the exact inventory before recording the attempt. Changes abort this plan.
      const fresh = await cf.listRecords();
      if (dnsFingerprint(fresh) !== dnsFingerprint(records))
        throw new DomainDnsError(
          "DNS changed after planning. Retry to inspect the new inventory before publishing.",
        );
      await checkpoint("dns_batch", {
        requires_reconciliation: true,
        message:
          "DNS publication was attempted; durable provider readback is required before retry.",
      });
      await guard();
      await cf.applyBatch(plan);
    }
    records = await cf.listRecords();
    const remaining = buildDnsPlan(
      binding,
      tasks,
      records,
      input.add_mx,
      input.force_mx_switch,
    );
    if (remaining.creates.length || remaining.deletes.length)
      throw new DomainDnsError(
        "DNS publication has not been confirmed by complete provider readback. Retry after the provider state settles.",
      );
    await checkpoint("dns_published", {
      requires_reconciliation: false,
      dns_published: true,
      message:
        "DNS records are present at the provider. Public propagation and sending verification may still be pending.",
    });
    const observed = await sender.readDomainConnection(input.domain, signal);
    // Reuse the same evidence validator and scope planner before accepting sending verification.
    const finalPlan = buildDnsPlan(
      binding,
      observed.dns_tasks,
      records,
      input.add_mx,
      input.force_mx_switch,
    );
    if (
      !observed.registered ||
      finalPlan.creates.length ||
      finalPlan.deletes.length
    )
      throw new DomainDnsError(
        "The provider DNS requirements changed before final verification; inspect the current evidence and retry.",
      );
    const mailFromReady =
      !input.mail_from ||
      observed.dns_tasks.some(
        (task) =>
          task.purpose === "MAIL_FROM" &&
          task.type === "MX" &&
          task.name === input.mail_from &&
          task.status === "verified",
      );
    result.job.verified_for_sending =
      observed.verified_for_sending && mailFromReady;
    result.job.status = result.job.verified_for_sending
      ? "verified"
      : "pending_verification";
    result.job.phase = "complete";
    result.job.message = result.job.verified_for_sending
      ? "DNS publication and provider sending verification are confirmed. Inbound receiving requires its separate configured-source readiness checks."
      : "DNS publication is confirmed; the provider has not verified sending yet. Retry or wait for verification.";
    await guard();
    await jobs.save(claim, refs.provider_type, result, true);
    return result;
  } catch (error) {
    result = {
      ...result,
      job: {
        ...result.job,
        status: "blocked",
        message:
          error instanceof DomainDnsError
            ? error.message
            : "The provider or database did not confirm completion. Existing external changes may persist; inspect the durable receipt and retry to reconcile.",
      },
    };
    await jobs.block(claim, result);
    return (await jobs.read(claim.id)) ?? result;
  }
}
