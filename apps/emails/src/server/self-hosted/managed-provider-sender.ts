import type { ManagedProviderSecrets } from "./managed-provider-secrets.js";
import { buildSelfHostedSender, type SelfHostedSender, type SenderResolver } from "./sender.js";

export class ManagedSenderUnavailableError extends Error {
  constructor() { super("Managed provider credentials could not be loaded; retry or inspect server credential status."); this.name = "ManagedSenderUnavailableError"; }
}

/** Resolve at each operation boundary: credential updates never use a boot-time cache. */
export function buildManagedSenderResolver(
  external: SenderResolver,
  secrets: (tenant: string) => Pick<ManagedProviderSecrets, "read">,
  build: (env: NodeJS.ProcessEnv) => SelfHostedSender = buildSelfHostedSender,
): SenderResolver {
  return async (tenant, provider) => {
    // An unreadable envelope is a failure, never permission to use another identity.
    let material: Awaited<ReturnType<ManagedProviderSecrets["read"]>>;
    try { material = await secrets(tenant).read(provider); }
    catch { throw new ManagedSenderUnavailableError(); }
    if (!material) return external(tenant, provider);
    const credentials = material.credentials;
    const config: NodeJS.ProcessEnv = { EMAILS_SEND_PROVIDER: credentials.type };
    if (credentials.type === "resend") config.RESEND_API_KEY = credentials.api_key;
    else {
      if (!material.region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(material.region)) {
        throw new Error("Managed SES credentials require a valid registered provider region.");
      }
      config.EMAILS_AWS_REGION = material.region;
      config.EMAILS_SES_ACCESS_KEY_ID = credentials.access_key;
      config.EMAILS_SES_SECRET_ACCESS_KEY = credentials.secret_key;
    }
    return { ...build(config), credentialSource: "managed_envelope" };
  };
}
