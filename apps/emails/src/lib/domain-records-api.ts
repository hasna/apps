import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { listDomains } from "../db/domains.js";
import { resolveId } from "../cli/utils.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

function selectDomain(reference: string, provider?: string) {
  const name = reference.trim().toLowerCase();
  if (!name) throw new Error("Domain must not be blank");
  if (provider !== undefined && !provider.trim()) throw new Error("Provider must not be blank");
  const providerId = provider !== undefined ? resolveId("providers", provider) : undefined;
  const matches = listDomains().filter(row => (row.domain.toLowerCase() === name || row.id.startsWith(reference)) && (!providerId || row.provider_id === providerId));
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous domain: ${reference}` : `Domain not found: ${reference}`);
  return { domain: matches[0]!, providerId };
}
async function request<T>(run: (client: EmailsSelfHostClient) => Promise<T>): Promise<T> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const base = new URL(transport.baseUrl); base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  for (let i = 0; i < credentials.length; i++) {
    try { return await run(new EmailsSelfHostClient({ baseUrl: base.toString().replace(/\/$/, ""), bearerToken: credentials[i], timeoutMs: 35000 })); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 401 || i === credentials.length - 1) throw error; }
  }
  throw new Error("No Emails API credential is configured");
}
export async function readRegisteredDomainDns(reference: string, provider?: string) {
  const selected = selectDomain(reference, provider);
  return request(client => client.getDomainDnsRecords(selected.domain.id, selected.providerId ? { provider_id: selected.providerId } : {}, { signal: AbortSignal.timeout(35000) }));
}
export async function verifyRegisteredDomain(reference: string, provider?: string) {
  const selected = selectDomain(reference, provider);
  return request(client => client.domainVerify(selected.domain.id, selected.providerId ? { provider_id: selected.providerId } : {}, { signal: AbortSignal.timeout(35000) }));
}
