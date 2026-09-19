import {
  clientTransportEnvKeys,
  resolveClientTransport,
  resolveCredential,
  toV1BaseUrl,
  type CredentialChainOptions,
} from "@hasna/contracts/client";

export interface ConversationsTransportOptions {
  env?: Record<string, string | undefined>;
  credentials?: CredentialChainOptions;
  fetch?: typeof fetch;
}

export interface ConversationsTransport {
  baseUrl: string;
  apiKey: string | null;
  localExplicit: boolean;
  fetch: typeof fetch;
}

function explicitApiUrl(env: Record<string, string | undefined>): string | undefined {
  const keys = clientTransportEnvKeys("conversations").apiUrlKeys;
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * Resolve Conversations through the shared hosted credential chain. There is
 * no implicit localhost default. A caller may retain an explicitly configured
 * loopback URL for a deliberate local/test setup; ambient hosted credentials
 * are never attached to that caller-chosen authority.
 */
export function resolveConversationsTransport(
  options: ConversationsTransportOptions = {},
): ConversationsTransport {
  const env = options.env ?? process.env;
  const explicitUrl = explicitApiUrl(env);
  if (explicitUrl && isLoopbackUrl(explicitUrl)) {
    return {
      baseUrl: toV1BaseUrl(explicitUrl),
      apiKey: null,
      localExplicit: true,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    };
  }

  const credential = resolveCredential("conversations", env, options.credentials ?? {});
  if (!credential) {
    throw new Error(
      "Conversations notifications require a hosted credential from the Keychain, ~/.hasna/conversations/config/credentials, or HASNA_CONVERSATIONS_API_KEY; refusing localhost fallback",
    );
  }
  const resolution = resolveClientTransport("conversations", env, {
    credentials: { ...(options.credentials ?? {}), apiKey: credential.apiKey },
  });
  return {
    baseUrl: toV1BaseUrl(resolution.baseUrl),
    apiKey: credential.apiKey,
    localExplicit: false,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
  };
}

export async function conversationsRequest(
  path: string,
  init: RequestInit = {},
  options: ConversationsTransportOptions = {},
): Promise<Response> {
  const transport = resolveConversationsTransport(options);
  const headers = new Headers(init.headers ?? {});
  if (transport.apiKey) {
    headers.set("x-api-key", transport.apiKey);
    headers.set("Authorization", `Bearer ${transport.apiKey}`);
  }
  const route = path.startsWith("/") ? path : `/${path}`;
  return transport.fetch(`${transport.baseUrl}${route}`, { ...init, headers });
}
