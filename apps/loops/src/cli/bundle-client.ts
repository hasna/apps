/**
 * The CLI's client for the bundle routes.
 *
 * A hand-written client rather than the generated SDK because two of these
 * calls are not JSON: the upload is `multipart/form-data` and the download is
 * an opaque `application/zstd` body whose headers carry the digests. The
 * generated SDK models JSON request/response pairs, and wrapping binary
 * transport in it would mean base64 in a JSON envelope - doubling the bytes on
 * the wire for the one payload with a hard 2 MiB cap.
 *
 * Credentials come from the shared `@hasna/contracts` resolver, so the CLI
 * honours exactly the same tiers (explicit, environment, credential file) as
 * every other Hasna client. No new environment switch is introduced.
 */
import { clientTransportEnvKeys, resolveCredential, toV1BaseUrl } from "@hasna/contracts/client";
import type { OwnedBytes } from "../lib/bundle/pack.js";
import { ownBytes } from "../lib/bundle/pack.js";

/** Exit code for "credentials or configuration are missing" (EX_CONFIG). */
export const EX_CONFIG = 78;

export class BundleCliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "BundleCliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * HTTP status to CLI exit code.
 *
 * Distinct codes for integrity (2), conflict (3), not-found (4) and scope (5)
 * so a shell script can branch without parsing a message: "the bundle is
 * corrupt" and "someone else pushed first" want different automation.
 */
export function exitCodeForStatus(status: number, errorCode?: string): number {
  if (errorCode) {
    const upper = errorCode.toUpperCase();
    if (upper.includes("DIGEST_MISMATCH") || upper.includes("UNSAFE") || upper.includes("CORRUPT") || upper.includes("SECRET")) return 2;
    if (upper.includes("SCOPE_REQUIRED")) return 5;
  }
  if (status === 401 || status === 403) return 5;
  if (status === 404) return 4;
  if (status === 409) return 3;
  if (status === 400 || status === 413 || status === 422) return 2;
  return 1;
}

export interface BundleApiClient {
  readonly baseUrl: string;
  listVersions(loopId: string, limit?: number): Promise<Record<string, unknown>>;
  getVersion(loopId: string, version: number | "latest"): Promise<Record<string, unknown>>;
  download(loopId: string, version: number | "latest"): Promise<{ bytes: OwnedBytes; digest: string; archiveSha256: string; version: number }>;
  upload(loopId: string, manifestJson: string, archive: Uint8Array, opts?: { adopt?: boolean }): Promise<Record<string, unknown>>;
  rollback(loopId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  pin(loopId: string, version: number | null): Promise<Record<string, unknown>>;
  listBundles(query?: { machine?: string; limit?: number }): Promise<Record<string, unknown>>;
  getLoop(idOrName: string): Promise<Record<string, unknown>>;
  listLoops(query?: { name?: string; limit?: number; offset?: number }): Promise<Record<string, unknown>>;
}

/**
 * Build the client, or refuse.
 *
 * Bundles are a control-plane feature: versions are allocated by the server and
 * objects live in the artifact store. There is no local-only mode for `push`,
 * `pull`, `versions` or `pin`, so missing credentials are EX_CONFIG (78) rather
 * than a silent fall back to something that would appear to work.
 */
export function createBundleApiClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): BundleApiClient {
  const keys = clientTransportEnvKeys("loops");
  const rawUrl = keys.apiUrlKeys.map((key) => env[key]?.trim()).find(Boolean);
  if (!rawUrl) {
    throw new BundleCliError(
      "CREDENTIALS_MISSING",
      `bundle commands talk to the loops control plane; set ${keys.apiUrlKeys[0]} and ${keys.apiKeyKeys[0]}`,
      EX_CONFIG,
    );
  }
  let apiKey: string | null | undefined;
  try {
    // The resolver returns null when no tier holds a credential; a throw means
    // a tier held an unusable one. Both are the same refusal to the operator.
    apiKey = resolveCredential("loops", env)?.apiKey;
  } catch (error) {
    throw new BundleCliError("CREDENTIALS_MISSING", error instanceof Error ? error.message : String(error), EX_CONFIG);
  }
  if (!apiKey) {
    throw new BundleCliError("CREDENTIALS_MISSING", `bundle commands require ${keys.apiKeyKeys[0]}`, EX_CONFIG);
  }
  const key = apiKey;
  const baseUrl = toV1BaseUrl(rawUrl).replace(/\/+$/, "");

  const authorized = (extra: Record<string, string> = {}): Record<string, string> => ({
    authorization: `Bearer ${key}`,
    accept: "application/json",
    ...extra,
  });

  async function json(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers: { ...authorized(), ...(init.headers as Record<string, string> | undefined) } });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!response.ok || body.ok === false) {
      const code = typeof body.error === "string" ? body.error : `http_${response.status}`;
      const message = typeof body.message === "string" ? body.message : code;
      throw new BundleCliError(code, message, exitCodeForStatus(response.status, code));
    }
    return body;
  }

  return {
    baseUrl,
    async listVersions(loopId, limit) {
      const query = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
      return json(`/loops/${encodeURIComponent(loopId)}/versions${query}`);
    },
    async getVersion(loopId, version) {
      return json(`/loops/${encodeURIComponent(loopId)}/versions/${encodeURIComponent(String(version))}`);
    },
    async download(loopId, version) {
      const response = await fetchImpl(
        `${baseUrl}/loops/${encodeURIComponent(loopId)}/versions/${encodeURIComponent(String(version))}/bundle`,
        { headers: authorized({ accept: "application/zstd" }) },
      );
      if (!response.ok) {
        let code = `http_${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === "string") code = body.error;
        } catch {
          // A non-JSON error body is still an error; the status carries it.
        }
        throw new BundleCliError(code, `bundle download failed (${response.status})`, exitCodeForStatus(response.status, code));
      }
      return {
        bytes: ownBytes(new Uint8Array(await response.arrayBuffer())),
        digest: response.headers.get("x-loops-bundle-digest") ?? "",
        archiveSha256: response.headers.get("x-loops-archive-sha256") ?? "",
        version: Number(response.headers.get("x-loops-bundle-version") ?? 0),
      };
    },
    async upload(loopId, manifestJson, archive, opts = {}) {
      const form = new FormData();
      form.set("manifest", manifestJson);
      form.set("bundle", new Blob([ownBytes(archive)], { type: "application/zstd" }), "bundle.tar.zst");
      const query = opts.adopt ? "?adopt=true" : "";
      return json(`/loops/${encodeURIComponent(loopId)}/versions${query}`, { method: "POST", body: form });
    },
    async rollback(loopId, body) {
      return json(`/loops/${encodeURIComponent(loopId)}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async pin(loopId, version) {
      return json(`/loops/${encodeURIComponent(loopId)}/pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });
    },
    async listBundles(query = {}) {
      const params = new URLSearchParams();
      if (query.machine) params.set("machine", query.machine);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return json(`/bundles${suffix}`);
    },
    async getLoop(idOrName) {
      return json(`/loops/${encodeURIComponent(idOrName)}`);
    },
    async listLoops(query = {}) {
      const params = new URLSearchParams();
      if (query.name !== undefined) params.set("name", query.name);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      if (query.offset !== undefined) params.set("offset", String(query.offset));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return json(`/loops${suffix}`);
    },
  };
}
