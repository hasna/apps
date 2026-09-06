import { resolveStore } from "../../core/store";
import { CONFIG_PATH } from "../../core/config";
import { attachmentsClientEnvKeys, resolveAttachmentsTransport, type Env } from "../../core/client-config";

/**
 * Diagnostics must prove authenticated access, never imply a local dataset
 * exists. Fail closed: without a resolvable credential the blocked report
 * names the required configuration, and no local fallback is ever offered.
 *
 * The report never reads a credential value and never reads the API env pair
 * past the shared seam — the resolver decides, and only its SOURCE names are
 * echoed.
 */
export async function serviceDiagnostic(
  env: Env = process.env,
): Promise<{ ok: boolean; lines: string[] }> {
  try {
    const resolved = resolveAttachmentsTransport(env);
    const store = resolveStore(env);
    try {
      const rows = await store.list({ limit: 1 });
      return {
        ok: true,
        lines: [
          "Transport: authenticated HTTPS",
          "API: " + resolved.url,
          "API key source: " + (resolved.apiKeySource ?? "unknown") + " (" + resolved.apiKeyTier + ")",
          "Health: authorized and reachable",
          "Sample records: " + rows.length,
          "Preferences: " + CONFIG_PATH,
        ],
      };
    } finally {
      store.close();
    }
  } catch (error) {
    const { apiUrlKeys, apiKeyKeys } = attachmentsClientEnvKeys();
    const configError =
      error instanceof Error &&
      /configuration|credential|blank|disagree|resolve/i.test(error.message);
    if (configError) {
      return {
        ok: false,
        lines: [
          "Health: BLOCKED",
          `Missing fleet API configuration: set ${apiUrlKeys[0]} and ${apiKeyKeys[0]} (aliases ` +
            `${apiUrlKeys[1]} / ${apiKeyKeys[1]}); the shared chain also checks the Keychain item ` +
            `hasna.credentials.attachments.api-key and ~/.hasna/attachments/config/credentials. ` +
            "No local fallback exists; attachments is remote-only.",
        ],
      };
    }
    return {
      ok: false,
      lines: [
        "Health: BLOCKED",
        `The service rejected the request or is unreachable; check ${apiUrlKeys[0]} / ${apiKeyKeys[0]}.`,
      ],
    };
  }
}