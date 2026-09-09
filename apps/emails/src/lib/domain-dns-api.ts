import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

export interface DomainDnsOptions {
  provider: string;
  registerSes?: boolean;
  mx?: boolean;
  addMx?: boolean;
  mxServer?: string;
  forceMxSwitch?: boolean;
  mailFrom?: string;
  send?: string;
  dryRun?: boolean;
  wait?: boolean;
  timeout?: string;
}
export type DomainDnsReceipt = Awaited<
  ReturnType<EmailsSelfHostClient["getDomainDnsJob"]>
>;
interface ApiSelection {
  url?: string;
  credential?: string;
}
async function request<T>(
  action: (client: EmailsSelfHostClient) => Promise<T>,
  selected: ApiSelection = {},
): Promise<T> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  if (
    selected.url !== undefined &&
    (selected.url !== transport.baseUrl ||
      selected.credential !== transport.credential)
  )
    throw new Error(
      "The Emails API account configuration changed during DNS provisioning. Run the command again to select the current account.",
    );
  selected.url = transport.baseUrl;
  selected.credential = transport.credential;
  const base = new URL(transport.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [
    transport.credential,
    ...(transport.credentialFallbacks ?? []).map((item) => item.value),
  ];
  for (let index = 0; index < credentials.length; index++) {
    try {
      return await action(
        new EmailsSelfHostClient({
          baseUrl: base.toString().replace(/\/$/, ""),
          bearerToken: credentials[index],
          timeoutMs: 95000,
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
  }
  throw new Error("No Emails API credential is configured.");
}
async function publish(
  domain: string,
  options: DomainDnsOptions,
  provision: boolean | "owned",
): Promise<DomainDnsReceipt> {
  const seconds = Number(options.timeout ?? "600");
  if (
    !/^\d+$/.test(options.timeout ?? "600") ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > 900
  )
    throw new Error("Verification timeout must be between 1 and 900 seconds.");
  if (options.send !== undefined && options.send !== "ses")
    throw new Error("Domain provisioning currently supports --send ses.");
  const selected: ApiSelection = {},
    deadline = Date.now() + (options.wait ? seconds * 1000 : 95000);
  const body = {
    domain,
    provider_id: options.provider,
    dry_run: options.dryRun ?? false,
    add_mx: options.addMx ?? options.mx ?? false,
    force_mx_switch: options.forceMxSwitch ?? false,
    ...(provision === true
      ? {
          register_provider: true,
          send: "ses" as const,
          ...(options.mailFrom !== undefined
            ? { mail_from: options.mailFrom }
            : {}),
        }
      : provision === "owned"
        ? {}
        : { register_provider: options.registerSes ?? false }),
    ...(options.mxServer !== undefined ? { mx_server: options.mxServer } : {}),
  };
  let result: DomainDnsReceipt;
  while (true) {
    try {
      result = await request(
        (client) =>
          provision === "owned"
            ? client.setupOwnedDomain(body, {
                signal: AbortSignal.timeout(
                  Math.max(1, Math.min(95000, deadline - Date.now())),
                ),
              })
            : provision === true
              ? client.provisionSendingDomain(body, {
                  signal: AbortSignal.timeout(
                    Math.max(1, Math.min(95000, deadline - Date.now())),
                  ),
                })
              : client.setupDomainCloudflare(body, {
                  signal: AbortSignal.timeout(
                    Math.max(1, Math.min(95000, deadline - Date.now())),
                  ),
                }),
        selected,
      );
    } catch (error) {
      if (
        provision === "owned" &&
        error instanceof ApiError &&
        [404, 405].includes(error.status)
      )
        throw new Error(
          "The Emails API needs an update to support owned-domain setup; no setup completion was confirmed.",
        );
      throw error;
    }
    if (
      !options.wait ||
      options.dryRun ||
      !["processing", "pending_verification"].includes(result.job.status) ||
      Date.now() >= deadline
    )
      return result;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(5000, Math.max(1, deadline - Date.now()))),
    );
    if (Date.now() >= deadline) return result;
  }
}
export const setupOwnedDomain = (domain: string, options: DomainDnsOptions) =>
  publish(domain, options, "owned");
export const setupDomainCloudflare = (
  domain: string,
  options: DomainDnsOptions,
) => publish(domain, options, false);
export const provisionSendingDomain = (
  domain: string,
  options: DomainDnsOptions,
) => publish(domain, options, true);
export const inspectDomainDnsJob = (id: string) =>
  request((client) =>
    client.getDomainDnsJob(id, { signal: AbortSignal.timeout(30000) }),
  );
export function domainDnsSucceeded(
  result: DomainDnsReceipt,
  wait = false,
): boolean {
  return (
    (result.dry_run && result.job.status === "planned") ||
    (["pending_verification", "verified"].includes(result.job.status) &&
      result.job.dns_published &&
      (!wait || result.job.verified_for_sending))
  );
}
export function formatDomainDns(result: DomainDnsReceipt): string {
  const { job } = result;
  return [
    `${job.domain}: ${job.status}${job.id ? ` (${job.id})` : ""}`,
    job.message,
    ...(job.plan?.creates ?? []).map(
      (record) =>
        `${record.type} ${record.name} ${record.priority === undefined ? "" : `${record.priority} `}${record.content}`,
    ),
    ...(job.plan?.deletes ?? []).map(
      (record) => `Replace root MX record ${record.id}`,
    ),
  ].join("\n");
}
