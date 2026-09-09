import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
import { runtimeLogQuery } from "../server/self-hosted/runtime-log.js";

export async function tailApiRuntimeLogs(component: string, lines: string) {
  const query = runtimeLogQuery(component, lines);
  const { EmailsSelfHostClient, ApiError } = await import("../selfhost.js");
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const baseUrl = transport.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  for (let index = 0; index < credentials.length; index++) {
    try {
      return await new EmailsSelfHostClient({ baseUrl, bearerToken: credentials[index] }).tailRuntimeLogs({ component: query.component, lines: query.limit }, { signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && index < credentials.length - 1) continue;
      if (error instanceof ApiError && [404,405].includes(error.status)) throw Error("The Emails API needs an update to publish runtime logs.");
      throw error;
    }
  }
  throw Error("No Emails API credential is configured.");
}
