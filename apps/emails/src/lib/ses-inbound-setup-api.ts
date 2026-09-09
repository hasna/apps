import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
export async function setupSesInboundApi(input: Parameters<EmailsSelfHostClient["setupSesInbound"]>[0]) {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const baseUrl = transport.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  for (let i = 0; i < credentials.length; i++) {
    try {
      const result = await new EmailsSelfHostClient({ baseUrl, bearerToken: credentials[i], timeoutMs: 35000 }).setupSesInbound(input, { signal: AbortSignal.timeout(35000) });
      if (result.ok && !result.verified) throw new Error("The API did not confirm SES setup verification.");
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && i < credentials.length - 1) continue;
      if (error instanceof ApiError && [404,405].includes(error.status)) throw new Error("The Emails API needs an update or a matching ingest binding before SES inbound setup can run.");
      throw error;
    }
  }
  throw new Error("No Emails API credential is configured.");
}
