import { resolveStore } from "../../core/store";
import { CONFIG_PATH } from "../../core/config";

/**
 * Diagnostics must prove authenticated access, never imply a local dataset
 * exists. Fail closed: without the API env the blocked report names the
 * required variables, and no local fallback is ever offered.
 */
export async function serviceDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; lines: string[] }> {
  try {
    const store = resolveStore(env);
    try {
      const rows = await store.list({ limit: 1 });
      return { ok: true, lines: ["Transport: authenticated HTTPS", "API: " + store.baseUrl, "Health: authorized and reachable", "Sample records: " + rows.length, "Preferences: " + CONFIG_PATH] };
    } finally { store.close(); }
  } catch {
    const url = (env.HASNA_ATTACHMENTS_API_URL ?? env.ATTACHMENTS_API_URL ?? "").trim();
    const key = (env.HASNA_ATTACHMENTS_API_KEY ?? env.ATTACHMENTS_API_KEY ?? "").trim();
    if (!url || !key) {
      return {
        ok: false,
        lines: [
          "Health: BLOCKED",
          "Missing fleet API configuration: set HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY (aliases ATTACHMENTS_API_URL / ATTACHMENTS_API_KEY). No local fallback exists; attachments is remote-only.",
        ],
      };
    }
    return {
      ok: false,
      lines: [
        "Health: BLOCKED",
        "The service rejected the request or is unreachable; check HASNA_ATTACHMENTS_API_URL / HASNA_ATTACHMENTS_API_KEY.",
      ],
    };
  }
}
