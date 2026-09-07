import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
export async function setupInboxRealtime(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  async function request(path: string, body?: unknown) {
    for (let index = 0; index < credentials.length; index++) {
      const response = await fetch(transport.baseUrl + path, { method: body === undefined ? "GET" : "POST", redirect: "error", headers: { Authorization: `Bearer ${credentials[index]}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35000) });
      if (response.status === 401 && index < credentials.length - 1) continue;
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok || (response.status === 502 && result.ok === false && result.verified === false && Array.isArray(result.changed))) return result;
      throw new Error(typeof result.error === "string" ? result.error : `Realtime setup failed (HTTP ${response.status}).`);
    }
    throw new Error("No Emails API credential is configured.");
  }
  const contract = await request("/openapi.json") as { paths?: Record<string, { post?: unknown }> };
  if (!contract.paths?.["/v1/inbox/setup-realtime"]?.post) throw new Error("The Emails API needs an update for realtime setup. No setup request was submitted.");
  const result = await request("/inbox/setup-realtime", input);
  if (typeof result.ok !== "boolean" || typeof result.verified !== "boolean" || typeof result.source_id !== "string" || !Array.isArray(result.changed) || result.worker_started !== false || result.delivery_tested !== false || (result.ok && result.verified !== true)) throw new Error("Invalid realtime setup receipt; inspect the bound cloud configuration before retrying.");
  return result;
}
