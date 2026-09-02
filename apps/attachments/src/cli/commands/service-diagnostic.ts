import { resolveStore } from "../../core/store";
import { CONFIG_PATH } from "../../core/config";

/** Diagnostics must prove authenticated access, never imply a local dataset exists. */
export async function serviceDiagnostic(): Promise<{ ok: boolean; lines: string[] }> {
  try {
    const store = resolveStore();
    try {
      const rows = await store.list({ limit: 1 });
      return { ok: true, lines: ["Transport: authenticated HTTPS", "API: " + store.baseUrl, "Health: authorized and reachable", "Sample records: " + rows.length, "Preferences: " + CONFIG_PATH] };
    } finally { store.close(); }
  } catch {
    return { ok: false, lines: ["Health: BLOCKED", "Verify the explicit HTTPS API URL and API key; no local fallback was used."] };
  }
}
