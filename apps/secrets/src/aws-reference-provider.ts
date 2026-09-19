import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import { loadAwsProfiles, resolveAwsAccountProfile } from "./aws.js";
import { isTestContext } from "./test-isolation.js";
import { AwsSecretReferenceError, parseAwsSecretReference, selectAwsSecretString } from "./aws-reference.js";

const READ_TIMEOUT_MS = 30000;
interface ReferenceClients {
  identity: Pick<STSClient, "send">;
  secrets: Pick<SecretsManagerClient, "send">;
  destroy?: () => void;
}
type ReferenceClientFactory = (selection: { profile: string; region: string }) => Promise<ReferenceClients> | ReferenceClients;

const defaultReferenceClientFactory: ReferenceClientFactory = async ({ profile, region }) => {
  if (isTestContext()) throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED");
  const transport = {
    region,
    maxAttempts: 1,
    ignoreConfiguredEndpointUrls: true,
    requestHandler: { connectionTimeout: 5000, requestTimeout: READ_TIMEOUT_MS },
  };
  // Resolve once: identity and value requests cannot silently switch credentials.
  const credentials = await fromIni({ profile, clientConfig: transport })();
  const identity = new STSClient({ ...transport, credentials });
  const secrets = new SecretsManagerClient({ ...transport, credentials });
  return { identity, secrets, destroy: () => { identity.destroy(); secrets.destroy(); } };
};
let referenceClientFactory = defaultReferenceClientFactory;

/** Reset refuses network access, matching the other Secrets AWS test factories. */
export function setAwsReferenceClientFactoryForTests(factory?: ReferenceClientFactory): void {
  referenceClientFactory = factory ?? (() => { throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED"); });
}

/** One exact provider read; no listing, alias selection, store access, or writes. */
export async function getAwsSecretValueForReference(
  provider: string,
  account: string,
  reference: string,
): Promise<string> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED"));
    }, READ_TIMEOUT_MS);
  });
  const read = async (): Promise<string> => {
    let clients: ReferenceClients | undefined;
    try {
      const parsed = parseAwsSecretReference(reference, account);
      const profiles = await loadAwsProfiles();
      abort.signal.throwIfAborted();
      const target = resolveAwsAccountProfile(provider, account, profiles);
      parseAwsSecretReference(reference, account, target.region);
      clients = await referenceClientFactory({ profile: target.profile, region: parsed.region });
      abort.signal.throwIfAborted();
      const identity = await clients.identity.send(new GetCallerIdentityCommand({}), { abortSignal: abort.signal });
      if (identity.Account !== account) throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED");
      abort.signal.throwIfAborted();
      const result = await clients.secrets.send(new GetSecretValueCommand({
        SecretId: parsed.secretId,
        ...(parsed.versionId ? { VersionId: parsed.versionId } : { VersionStage: parsed.versionStage }),
      }), { abortSignal: abort.signal });
      abort.signal.throwIfAborted();
      if (result.ARN !== parsed.secretId ||
          (parsed.versionId && result.VersionId !== parsed.versionId) ||
          (parsed.versionStage && !result.VersionStages?.includes(parsed.versionStage)) ||
          result.SecretBinary !== undefined) throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED");
      return selectAwsSecretString(result.SecretString, parsed.jsonKey);
    } catch (error) {
      if (error instanceof AwsSecretReferenceError) throw error;
      // AWS/JSON/profile failures can contain input snippets. Never retain a cause.
      throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED");
    } finally {
      try { clients?.destroy?.(); } catch { throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_READ_FAILED"); }
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
