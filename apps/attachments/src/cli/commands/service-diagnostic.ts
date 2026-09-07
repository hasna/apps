import { resolveStore } from "../../core/store";
import { CONFIG_PATH } from "../../core/config";
import { attachmentsClientEnvKeys, resolveAttachmentsTransport, type Env } from "../../core/client-config";
import { ClientTransportConfigurationError, CredentialResolutionError } from "@hasna/contracts/client";

/**
 * Diagnostics must prove authenticated access, never imply a local dataset
 * exists. Fail closed: without a resolvable credential the blocked report
 * names the required configuration, and no local fallback is ever offered.
 *
 * The report never reads a credential value and never reads the API env pair
 * past the shared seam — the resolver decides, and only its SOURCE names are
 * echoed.
 */
const RESOLVER_ERROR_NAMES = new Set([
  "ClientTransportConfigurationError",
  "CredentialResolutionError",
  "CredentialFileUnsafeError",
]);

/**
 * True for the shared seam's own configuration refusals. Matched by class and
 * by `name` so a duplicated @hasna/contracts module instance (bundled vs
 * linked) never demotes a refusal to the generic "unreachable" branch.
 */
function isResolverRefusal(error: unknown): error is Error {
  if (error instanceof ClientTransportConfigurationError || error instanceof CredentialResolutionError) return true;
  return error instanceof Error && RESOLVER_ERROR_NAMES.has(error.name);
}

/** Write a diagnostic report: healthy reports go to stdout, BLOCKED reports to stderr (exit 1). */
export function writeDiagnosticReport(result: { ok: boolean; lines: string[] }): void {
  (result.ok ? process.stdout : process.stderr).write(result.lines.join("\n") + "\n");
  if (!result.ok) process.exitCode = 1;
}

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
    if (isResolverRefusal(error)) {
      // The resolver's own message is the diagnosis: it distinguishes "no
      // credential resolved" from an authority conflict (e.g. env URL vs
      // keychain:hasna.credentials.attachments.api-url) and names only
      // credential SOURCES, never values. Relabelling every refusal as
      // "missing" misdirected the operator (#1720 validation).
      return {
        ok: false,
        lines: [
          "Health: BLOCKED",
          error.message,
          `Fleet API configuration: set ${apiUrlKeys[0]} and ${apiKeyKeys[0]} (aliases ` +
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