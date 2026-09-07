import { getAdapter } from "../../providers/index.js";
import { resolveSesCredentials } from "../../providers/ses.js";
import type { Provider, SendEmailOptions } from "../../types/index.js";

export type SelfHostedSendProvider = "ses" | "resend";

/**
 * Which identity the sender signs with. Never a credential value.
 *
 * `environment`    — the scoped EMAILS_SES_* key pair from the server environment.
 * `ambient_aws_env`— a generic AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY pair that
 *                    happens to be in the process environment (preserved for
 *                    existing self-hosters; reported distinctly so nobody
 *                    mistakes it for a deliberate SES configuration).
 * `deployment_role`— the AWS SDK default chain: the ECS/EC2 task or instance role.
 * `api_key`        — Resend.
 */
export type SelfHostedSenderCredentialSource =
  | "environment"
  | "ambient_aws_env"
  | "deployment_role"
  | "api_key";

export interface SelfHostedSender {
  readonly provider: SelfHostedSendProvider;
  readonly credentialSource?: SelfHostedSenderCredentialSource;
  send(input: SendEmailOptions): Promise<string>;
}

/**
 * What a thrown provider error PROVES about the send.
 *
 * `rejected`  — the provider answered with a 4xx-class client error: it REFUSED
 *               the request, so nothing was sent. This outcome is definitive
 *               and safe to retry (after fixing the cause). The canonical case
 *               is SES sandbox `MessageRejected` ("Email address is not
 *               verified…") for any unverified/external recipient — the exact
 *               error the 2026-07-25 incident swallowed into a generic 502.
 * `uncertain` — anything else (network failure, provider 5xx, unknown shape):
 *               the request may have reached the provider, so the send may or
 *               may not have happened and reconciliation is required.
 */
export type ProviderSendErrorOutcome = {
  kind: "rejected" | "uncertain";
  /** The provider SDK's error name (e.g. `MessageRejected`), for logs/response. */
  providerErrorName: string;
  /** The provider's own message, capped so a response cannot be flooded. */
  detail: string;
  /** The provider HTTP status when one was received; undefined for network errors. */
  httpStatus?: number;
};

/**
 * Safe structured fields for provider-failure logs. The provider's message can
 * contain sender or recipient addresses, so it stays in the authenticated API
 * response for ordinary inline clients but is never copied into server logs.
 */
export function providerSendLogFields(outcome: ProviderSendErrorOutcome): {
  outcome: ProviderSendErrorOutcome["kind"];
  provider_error: string;
  http_status: number | null;
} {
  const providerError = /^[A-Za-z0-9_.:-]{1,100}$/.test(outcome.providerErrorName)
    ? outcome.providerErrorName
    : "ProviderError";
  return {
    outcome: outcome.kind,
    provider_error: providerError,
    http_status: outcome.httpStatus ?? null,
  };
}

const PROVIDER_ERROR_DETAIL_MAX_CHARS = 600;

/** Read a numeric HTTP status from the shapes real provider SDKs throw. */
function providerHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  // AWS SDK v3: err.$metadata.httpStatusCode
  const metadata = record["$metadata"];
  if (metadata && typeof metadata === "object") {
    const code = (metadata as Record<string, unknown>)["httpStatusCode"];
    if (typeof code === "number" && Number.isInteger(code)) return code;
  }
  // Resend/fetch-style SDKs: err.statusCode / err.status
  for (const key of ["statusCode", "status"]) {
    const code = record[key];
    if (typeof code === "number" && Number.isInteger(code)) return code;
  }
  return undefined;
}

/**
 * Classify an error thrown by a provider `send`. Deliberately conservative:
 * only a received 4xx response proves "nothing was sent"; everything else
 * stays uncertain. Never throws.
 */
export function classifyProviderSendError(error: unknown): ProviderSendErrorOutcome {
  const providerErrorName = error instanceof Error && error.name ? error.name : "UnknownProviderError";
  const rawDetail = error instanceof Error ? error.message : String(error ?? "unknown provider error");
  const detail = rawDetail.slice(0, PROVIDER_ERROR_DETAIL_MAX_CHARS);
  const httpStatus = providerHttpStatus(error);
  const fault = error && typeof error === "object" ? (error as Record<string, unknown>)["$fault"] : undefined;
  const rejected = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && fault !== "server";
  return {
    kind: rejected ? "rejected" : "uncertain",
    providerErrorName,
    detail,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

/**
 * SES credentials for the self-hosted sender come from the SERVER environment
 * under scoped names, never from the generic `AWS_*` pair.
 *
 * Scoping is deliberate: the API container's task role may hold unrelated
 * grants (S3/SQS in the deployment account). Injecting `AWS_ACCESS_KEY_ID`
 * would re-point the ENTIRE AWS SDK default chain at the SES identity and
 * silently break every other AWS call in the process. `EMAILS_SES_*` moves only
 * the SES client.
 *
 * When neither is set, the sender falls back to the deployment IAM role — the
 * behaviour open-source self-hosters rely on.
 */
const SES_ACCESS_KEY_ENV = "EMAILS_SES_ACCESS_KEY_ID";
const SES_SECRET_KEY_ENV = "EMAILS_SES_SECRET_ACCESS_KEY";

function sesEnvCredentials(env: NodeJS.ProcessEnv): { access_key: string | null; secret_key: string | null } {
  const accessKey = env[SES_ACCESS_KEY_ENV]?.trim() || "";
  const secretKey = env[SES_SECRET_KEY_ENV]?.trim() || "";
  if (!accessKey && !secretKey) return { access_key: null, secret_key: null };
  if (!accessKey || !secretKey) {
    // Half a key pair is a misconfiguration that would otherwise be completed
    // from the ambient chain and sign against the WRONG account.
    throw new Error(
      `${SES_ACCESS_KEY_ENV} and ${SES_SECRET_KEY_ENV} must be set together (or both left unset to use the deployment IAM role).`,
    );
  }
  return { access_key: accessKey, secret_key: secretKey };
}

const SES_CREDENTIAL_SOURCE_LABEL: Record<"provider" | "ambient" | "chain", SelfHostedSenderCredentialSource> = {
  provider: "environment",
  ambient: "ambient_aws_env",
  chain: "deployment_role",
};

function providerRecord(type: SelfHostedSendProvider, env: NodeJS.ProcessEnv): Provider {
  const now = new Date().toISOString();
  const apiKey = type === "resend" ? env["RESEND_API_KEY"]?.trim() ?? null : null;
  if (type === "resend" && !apiKey) {
    throw new Error("EMAILS_SEND_PROVIDER=resend requires RESEND_API_KEY.");
  }
  const ses = type === "ses" ? sesEnvCredentials(env) : { access_key: null, secret_key: null };
  return {
    id: `self-hosted-${type}`,
    name: `Self-hosted ${type.toUpperCase()}`,
    type,
    api_key: apiKey,
    region: type === "ses" ? env["EMAILS_AWS_REGION"]?.trim() ?? env["AWS_REGION"]?.trim() ?? null : null,
    access_key: ses.access_key,
    secret_key: ses.secret_key,
    oauth_client_id: null,
    oauth_client_secret: null,
    oauth_refresh_token: null,
    oauth_access_token: null,
    oauth_token_expiry: null,
    active: true,
    created_at: now,
    updated_at: now,
  };
}

export function buildSelfHostedSender(env: NodeJS.ProcessEnv = process.env): SelfHostedSender {
  const raw = env["EMAILS_SEND_PROVIDER"]?.trim().toLowerCase();
  if (raw !== "ses" && raw !== "resend") {
    throw new Error(
      "Emails self-hosted sending requires EMAILS_SEND_PROVIDER=ses or EMAILS_SEND_PROVIDER=resend. " +
        `SES uses ${SES_ACCESS_KEY_ENV}/${SES_SECRET_KEY_ENV} when they are set and otherwise the deployment IAM role; ` +
        "Resend additionally requires RESEND_API_KEY.",
    );
  }
  const provider = providerRecord(raw, env);
  const adapter = getAdapter(provider);
  return {
    provider: raw,
    // Never the credential VALUES — only which identity is in use, so an
    // operator can tell "IAM role" from "explicit SES key" from a log line.
    // Resolved with the SAME function the SES adapter signs with, against the
    // same environment, so the reported identity cannot drift from the real
    // one — reporting the configured INTENT instead would recreate the class of
    // defect this change exists to remove. (`getAdapter` builds lazily, so this
    // also surfaces a malformed credential pair at boot, not at first send.)
    credentialSource: raw === "ses"
      ? SES_CREDENTIAL_SOURCE_LABEL[resolveSesCredentials(provider).source]
      : "api_key",
    send: (input) => adapter.sendEmail(input),
  };
}

/** Tenant/provider bindings contain secret environment names, never credential values. */
export type SenderResolver = (tenantId: string, providerId: string) => SelfHostedSender | null;

export function buildSenderResolver(
  defaultSender: SelfHostedSender,
  env: NodeJS.ProcessEnv = process.env,
  build: (env: NodeJS.ProcessEnv) => SelfHostedSender = buildSelfHostedSender,
): SenderResolver {
  const raw = env.EMAILS_SENDER_BINDINGS?.trim();
  if (!raw) return () => null;
  let entries: unknown;
  try { entries = JSON.parse(raw); }
  catch { throw new Error("EMAILS_SENDER_BINDINGS must be a JSON array of tenant/provider bindings."); }
  if (!Array.isArray(entries)) throw new Error("EMAILS_SENDER_BINDINGS must be a JSON array.");
  const bindings = new Map<string, SelfHostedSender>();
  const allowed = new Set(["tenant_id", "provider_id", "sender", "type", "region", "api_key_env", "access_key_env", "secret_key_env"]);
  const requiredName = (value: unknown, label: string): string => {
    if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error(`EMAILS_SENDER_BINDINGS requires a valid ${label}.`);
    }
    return value.trim();
  };
  const secretFrom = (name: unknown): string => {
    if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error("Sender credential references must be environment variable names.");
    }
    const value = env[name]?.trim();
    if (!value) throw new Error(`Sender credential environment variable ${name} is not set.`);
    return value;
  };
  for (const value of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid sender binding.");
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !allowed.has(key))) throw new Error("Sender bindings accept credential environment names only; remove unknown fields.");
    const tenant = requiredName(entry.tenant_id, "tenant_id");
    const provider = requiredName(entry.provider_id, "provider_id");
    const key = JSON.stringify([tenant, provider]);
    if (bindings.has(key)) throw new Error("Duplicate tenant/provider sender binding.");
    let sender: SelfHostedSender;
    if (entry.sender === "default") {
      if (entry.type !== undefined || entry.api_key_env !== undefined || entry.access_key_env !== undefined || entry.secret_key_env !== undefined || entry.region !== undefined) {
        throw new Error("A default sender binding cannot override its credentials or provider type.");
      }
      sender = defaultSender;
    } else {
      if (entry.sender !== undefined) throw new Error("The sender binding selector must be 'default' or omitted.");
      const config: NodeJS.ProcessEnv = {};
      if (entry.type === "resend") {
        if (entry.access_key_env !== undefined || entry.secret_key_env !== undefined || entry.region !== undefined) throw new Error("Resend bindings accept api_key_env only.");
        config.EMAILS_SEND_PROVIDER = "resend";
        config.RESEND_API_KEY = secretFrom(entry.api_key_env);
      } else if (entry.type === "ses") {
        if (entry.api_key_env !== undefined) throw new Error("SES bindings require access_key_env and secret_key_env.");
        config.EMAILS_SEND_PROVIDER = "ses";
        config.EMAILS_SES_ACCESS_KEY_ID = secretFrom(entry.access_key_env);
        config.EMAILS_SES_SECRET_ACCESS_KEY = secretFrom(entry.secret_key_env);
        config.EMAILS_AWS_REGION = requiredName(entry.region, "SES region");
      } else throw new Error("A sender binding type must be ses or resend.");
      sender = build(config);
    }
    bindings.set(key, sender);
  }
  return (tenantId, providerId) => bindings.get(JSON.stringify([tenantId, providerId])) ?? null;
}
