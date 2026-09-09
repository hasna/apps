import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

/** Save feedback in the authenticated tenant; never claim external delivery. */
export async function saveApiFeedback(input: { message: string; email?: string; category?: "bug" | "feature" | "general" }) {
  const { EmailsSelfHostClient, ApiError } = await import("../selfhost.js");
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const baseUrl = transport.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  for (let index = 0; index < credentials.length; index++) {
    try {
      const row = await new EmailsSelfHostClient({ baseUrl, bearerToken: credentials[index] })
        .createResourceFeedback(input, { signal: AbortSignal.timeout(15000) });
      if (row.status !== "saved" || !row.id) throw new Error("The Emails API did not confirm that feedback was saved.");
      return { id: row.id, status: "saved" as const, delivery: "not_sent" as const };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && index < credentials.length - 1) continue;
      if (error instanceof ApiError && [404,405].includes(error.status)) throw new Error("The Emails API needs an update before feedback can be saved.");
      throw error;
    }
  }
  throw new Error("No Emails API credential is configured.");
}
