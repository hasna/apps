import { getApiUrl } from "./auth-store.js";
import { normalizeSkillsApiOrigin, resolveSkillsConnection } from "./fleet-credentials.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";
import { creditCount, parseRemoteBillingStatus, parseRemoteCheckout, parseRemoteCreditPacks, parseRemoteRunQuote, RemoteCreditApprovalError, type RemoteCreditPack, type RemoteRunApproval, type RemoteRunQuote } from "./remote-account.js";
import { describeRemoteFiles, readBoundedResponse, sha256, MAX_REMOTE_FILE_BYTES, type RemoteInputFile } from "./remote-files.js";

/**
 * A server that predates this client's pin/tag/incremental-sync routes answered
 * 404/405 for them. The caller must never mistake that for "no pins" or "empty
 * listing" — a silently-empty sync would look like success and drop nothing on
 * the next push. This error is how the version-skew surfaces fail-closed.
 */
export class RemoteRouteUnsupportedError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly instance: string,
  ) {
    super(
      `The configured Skills instance does not support ${path} (HTTP ${status}). ` +
        `The instance at ${instance} predates this client feature — upgrade the server, or ` +
        `use a client version that matches it.`,
    );
    this.name = "RemoteRouteUnsupportedError";
  }
}

/** Any other non-ok response on the new-route methods, with the status attached. */
export class RemoteRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`Remote request to ${path} failed: HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "RemoteRequestError";
  }
}

/**
 * A remote pin on a skill, matching the hosted-pins wire shape
 * (`{ slug, pinnedAt, metadata }`). `pinnedAt`/`metadata` are server-reported
 * and may be absent.
 */
export interface RemoteSkillVersion {
  slug: string;
  version: string;
  bundleSha256: string;
  bundleByteSize: number;
  storageKind?: string;
  manifest?: Record<string, unknown>;
  createdAt: string;
  current?: boolean;
}

export interface RemotePin {
  slug: string;
  pinnedAt?: string;
  metadata?: Record<string, unknown>;
}

/** The minimal per-skill row the pin/tag/updated-since routes serve. */
export interface RemoteSkillSummary {
  slug: string;
  name?: string;
  version?: string;
  updatedAt?: string;
}

/**
 * One page of an incremental listing. `nextCursor` is an opaque continuation
 * token; null (or an absent field) means the listing is complete.
 */
export interface UpdatedSincePage {
  skills: RemoteSkillSummary[];
  nextCursor: string | null;
}

export class RemoteSkillsClient {
  private apiUrl: string;
  private apiKey: string;
  private capabilities?: Promise<{ contractVersion: 1; apiVersion: 1; capabilities: string[]; billing?: { boundedRunApproval?: boolean; unit?: string } }>;

  constructor(apiKey: string, apiUrl = getApiUrl()) {
    this.apiKey = apiKey;
    this.apiUrl = normalizeSkillsApiOrigin(apiUrl);
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      redirect: "error",
      signal: options?.signal ?? AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  }

  /**
   * Fail-closed version-skew guard for the pin/tag/updated-since routes.
   *
   * A server that predates these routes answers 404 (unmatched path) or 405
   * (unmatched method). Both are surfaced as `RemoteRouteUnsupportedError` —
   * never as an empty listing, which would read as "no pins / no changes" and
   * silently desynchronize the caller. Every other non-ok response becomes a
   * `RemoteRequestError` carrying the status.
   *
   * `domainNotFoundCodes` is the one deliberate exception: a route the server
   * DOES have can 404 for a domain reason (the hosted-pins DELETE answers
   * `{ code: "PIN_NOT_FOUND" }` when no pin exists). A 404 whose JSON body
   * carries one of those codes is returned to the caller (status intact) so it
   * can apply domain semantics instead of misreporting version skew. Every
   * other 404 — including the dispatcher's `{ code: "NOT_FOUND" }` on a route
   * the server lacks — still throws `RemoteRouteUnsupportedError`.
   */
  private async requestNewRoute(
    path: string,
    options?: RequestInit,
    opts: { domainNotFoundCodes?: string[] } = {},
  ): Promise<Response> {
    const response = await this.request(path, options);
    // Route identity for the error excludes the query string — the query is
    // caller data (cursor/since), not the route that is missing.
    const routePath = path.split("?")[0];
    if (response.status === 404 || response.status === 405) {
      if (
        response.status === 404 &&
        opts.domainNotFoundCodes?.length &&
        (await responseBodyCarriesCode(response, opts.domainNotFoundCodes))
      ) {
        return response;
      }
      throw new RemoteRouteUnsupportedError(routePath, response.status, this.apiUrl);
    }
    if (!response.ok) {
      throw new RemoteRequestError(routePath, response.status, response.statusText);
    }
    return response;
  }

  async listSkills(): Promise<any[]> {
    return this.arrayResponse("/api/v1/skills");
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const res = await this.request(`/api/v1/skills/${slug}/skill.md`);
    if (!res.ok) return null;
    return res.text();
  }

  async getSkill(slug: string): Promise<any | null> {
    const res = await this.request(`/api/v1/skills/${slug}`);
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * Raw GET for one skill, with the HTTP status surfaced. Used by the reconcile
   * re-check (registry-reconcile.ts) so it can distinguish "no such skill" (404) from
   * "the registry failed to answer" (any other non-success status) instead of treating
   * both as absent.
   */
  async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
    const res = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "GET" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON body still leaves the status usable.
    }
    return { status: res.status, body };
  }

  /** Low-level admission transport; interactive surfaces use submitQuotedRun. */
  async submitRun(slug: string, input?: Record<string, unknown>, args?: string[], approval: RemoteRunApproval = {}): Promise<RemoteSkillRunContract> {
    if (approval.idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(approval.idempotencyKey)) throw new Error("Idempotency key must be 1-128 URL-safe characters");
    if (approval.maxCostCents !== undefined) creditCount(approval.maxCostCents);
    if (approval.maxCredits !== undefined) creditCount(approval.maxCredits);
    if (approval.maxCredits !== undefined && approval.maxCostCents !== undefined && approval.maxCredits !== approval.maxCostCents) throw new Error("Credit approval fields disagree");
    const res = await this.request(`/api/v1/runs/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify({ input, args,
        ...(approval.maxCredits !== undefined ? { maxCredits: approval.maxCredits } : {}),
        ...(approval.maxCostCents !== undefined ? { maxCostCents: approval.maxCostCents } : {}),
        ...(approval.idempotencyKey !== undefined ? { idempotencyKey: approval.idempotencyKey } : {}),
        ...(approval.inputFiles !== undefined ? { files: approval.inputFiles } : {}),
      }),
    });
    return normalizeRemoteSkillRunContract(await res.json(), slug);
  }

  async quoteRun(slug: string, input: Record<string, unknown> = {}, args: string[] = []): Promise<RemoteRunQuote> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/quote`, {
      method: "POST", body: JSON.stringify({ input, args }),
    });
    return parseRemoteRunQuote(await response.json());
  }

  getCapabilities() {
    if (!this.capabilities) this.capabilities = (async () => {
      const value = await (await this.requestNewRoute("/api/v1/capabilities")).json() as Record<string, unknown>;
      if (value.contractVersion !== 1 || value.apiVersion !== 1 || !Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== "string")) throw new Error("Unsupported Skills server capability contract");
      const billing = value.billing as { boundedRunApproval?: boolean; unit?: string } | undefined;
      return { contractVersion: 1 as const, apiVersion: 1 as const, capabilities: value.capabilities as string[], ...(billing ? { billing } : {}) };
    })();
    return this.capabilities;
  }

  /** Quote first and fail closed when the caller has not approved the required credits. */
  async submitQuotedRun(slug: string, input: Record<string, unknown> = {}, args: string[] = [], approval: RemoteRunApproval = {}): Promise<RemoteSkillRunContract> {
    const maximum = creditCount(approval.maxCredits ?? approval.maxCostCents ?? 0);
    if (approval.maxCostCents !== undefined && approval.maxCostCents !== maximum) throw new Error("Credit approval fields disagree");
    const quote = await this.quoteRun(slug, input, args);
    if (quote.pricing.costCents > maximum) throw new RemoteCreditApprovalError(quote.pricing.costCents, maximum);
    const capabilities = await this.getCapabilities();
    if (!capabilities.capabilities.includes("runs.submit") || capabilities.billing?.boundedRunApproval !== true || capabilities.billing.unit !== "credits") {
      throw new Error("The configured server does not support bounded credit approval; refusing remote submission");
    }
    return this.submitRun(quote.skill, input, args, { ...approval, maxCredits: maximum, maxCostCents: maximum });
  }

  async getIdentity(): Promise<Record<string, unknown>> {
    return (await this.requestNewRoute("/api/auth/whoami")).json();
  }
  async listApiKeys(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/auth/keys"); }
  async createApiKey(name: string, scopes?: string[]): Promise<{ key: string; [field: string]: unknown }> {
    if (!name.trim() || name.length > 100) throw new Error("API key name must be 1-100 characters");
    const value = await (await this.requestNewRoute("/api/auth/keys", { method: "POST", body: JSON.stringify({ name, ...(scopes ? { scopes } : {}) }) })).json() as { key?: unknown };
    if (!value || typeof value.key !== "string" || !value.key.trim()) throw new Error("The server did not return a created API key");
    return value as { key: string; [field: string]: unknown };
  }
  async revokeApiKey(keyId: string): Promise<Record<string, unknown>> {
    return (await this.requestNewRoute(`/api/auth/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" })).json();
  }

  async getBillingStatus() {
    return parseRemoteBillingStatus(await (await this.requestNewRoute("/api/v1/billing/status")).json());
  }

  async listCreditPacks(): Promise<RemoteCreditPack[]> {
    return parseRemoteCreditPacks(await (await this.requestNewRoute("/api/v1/billing/credits")).json());
  }

  async createCreditCheckout(packId: string): Promise<{ url: string }> {
    const packs = await this.listCreditPacks();
    if (!packs.some(pack => pack.id === packId)) throw new Error("Choose a credit pack returned by skills credits packs");
    return parseRemoteCheckout(await (await this.requestNewRoute("/api/v1/billing/credits", {
      method: "POST", body: JSON.stringify({ packId }),
    })).json());
  }

  async getUsage(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/v1/billing/usage"); }
  async listInvoices(): Promise<Record<string, unknown>[]> { return this.arrayResponse("/api/v1/billing/invoices"); }
  async createBillingCheckout(): Promise<{ url: string }> { return this.checkoutResponse("/api/v1/billing/checkout"); }
  async createBillingPortal(): Promise<{ url: string }> { return this.checkoutResponse("/api/v1/billing/portal"); }
  async cancelRun(runId: string): Promise<RemoteSkillRunContract> { return this.controlRun(runId, "cancel"); }
  async resumeRun(runId: string): Promise<RemoteSkillRunContract> { return this.controlRun(runId, "resume"); }

  private async controlRun(runId: string, action: "cancel" | "resume") {
    const response = await this.requestNewRoute(`/api/v1/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST", body: "{}" });
    return normalizeRemoteSkillRunContract(await response.json());
  }

  private async checkoutResponse(path: string) {
    return parseRemoteCheckout(await (await this.requestNewRoute(path, { method: "POST", body: "{}" })).json());
  }

  private async arrayResponse(path: string): Promise<Record<string, unknown>[]> {
    const rows: unknown = await (await this.requestNewRoute(path)).json();
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid Skills server list response");
    return rows;
  }

  async getRun(runId: string): Promise<RemoteSkillRunContract | null> {
    const path = `/api/v1/runs/${encodeURIComponent(runId)}`;
    const res = await this.request(path);
    if (res.status === 404) return null;
    if (!res.ok) throw new RemoteRequestError(path, res.status, res.statusText);
    return normalizeRemoteSkillRunContract(await res.json());
  }

  async getRunLogs(runId: string): Promise<any[]> {
    return this.arrayResponse(`/api/v1/runs/${encodeURIComponent(runId)}/logs`);
  }

  async listRuns(limit = 20): Promise<any[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Run limit must be an integer from 1 to 100");
    return this.arrayResponse(`/api/v1/runs?limit=${limit}`);
  }

  async getRunArtifacts(runId: string): Promise<any[]> {
    return this.arrayResponse(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts`);
  }

  async downloadRunArtifact(runId: string, artifactId: string): Promise<Response> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`, {
      method: "GET",
    });
  }

  async getVerifiedRunArtifact(runId: string, artifactId: string, maximumBytes = MAX_REMOTE_FILE_BYTES) {
    const artifacts = await this.getRunArtifacts(runId);
    const artifact = artifacts.find(row => row.id === artifactId);
    if (!artifact) throw new Error("Run artifact not found");
    if (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize < 0 || artifact.byteSize > maximumBytes ||
        typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("The server does not provide valid artifact integrity metadata");
    const response = await this.downloadRunArtifact(runId, artifactId);
    if (!response.ok) throw new RemoteRequestError("artifact download", response.status, response.statusText);
    const bytes = await readBoundedResponse(response, artifact.byteSize);
    if (bytes.byteLength !== artifact.byteSize || sha256(bytes) !== artifact.sha256) throw new Error("Artifact integrity verification failed");
    return { id: artifactId, fileName: String(artifact.fileName ?? artifactId), bytes, byteSize: bytes.byteLength, sha256: artifact.sha256 };
  }

  async submitQuotedRunWithFiles(slug: string, input: Record<string, unknown>, args: string[], files: RemoteInputFile[], approval: RemoteRunApproval = {}) {
    const inputFiles = describeRemoteFiles(files);
    if (files.length && !(await this.getCapabilities()).capabilities.includes("runs.uploads")) throw new Error("The configured server does not support input uploads");
    const run = await this.submitQuotedRun(slug, input, args, { ...approval, inputFiles });
    if (run.error || !run.id || !files.length) return run;
    try { await this.uploadRunFiles(run.id, files); }
    catch {
      let cancellationRequested = false;
      try { await this.cancelRun(run.id); cancellationRequested = true; } catch {}
      throw new Error(`Input upload failed for run ${run.id}; ${cancellationRequested ? "cancellation requested" : "check its status and cancel the run"}`);
    }
    return run;
  }

  async uploadRunFiles(runId: string, files: RemoteInputFile[]): Promise<void> {
    const descriptors = describeRemoteFiles(files);
    const response = await this.requestNewRoute(`/api/v1/runs/${encodeURIComponent(runId)}/uploads`, { method: "POST", body: JSON.stringify({ files: descriptors }) });
    const payload = await response.json() as { files?: Array<{ name: string; uploadUrl: string }> };
    if (!Array.isArray(payload.files) || payload.files.length !== files.length || new Set(payload.files.map(file => file.name)).size !== files.length) throw new Error("Invalid input upload response");
    for (const file of files) {
      const upload = payload.files.find(row => row.name === file.name);
      if (!upload) throw new Error("Missing input upload URL");
      const url = new URL(upload.uploadUrl);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Unsafe input upload URL");
      // Storage receives only file bytes and their type, never the account credential.
      const uploaded = await fetch(url, { method: "PUT", body: file.bytes as BodyInit, headers: { "Content-Type": file.contentType ?? "application/octet-stream" }, redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!uploaded.ok) throw new Error("Input upload failed");
      await uploaded.body?.cancel();
    }
  }

  /**
   * Publish a skill to the configured instance.
   *
   * Sent as multipart rather than as JSON with a base64 field. A base64 body would inflate
   * the bundle by a third and would have to pass through the server's JSON reader, whose
   * 1 MB cap exists to keep JSON bodies sane; multipart keeps the tarball on its own path
   * with its own, larger limit.
   *
   * Note the deliberate absence of `request()`: that helper pins
   * `Content-Type: application/json`, and a multipart body whose Content-Type does not
   * carry the generated boundary is unparseable at the other end.
   *
   * Optimistic concurrency (todos d061fcda): pass the revision id this client last read
   * for the slug (from getSkill().revisionId) as `ifMatch`. The instance refuses a
   * publish against a live slug that does not name its current revision with 409 — this
   * is how a push never silently overwrites a newer remote revision.
   */
  async publishSkill(manifest: Record<string, unknown>, bundle?: Uint8Array, ifMatch?: string): Promise<Response> {
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    if (bundle) {
      form.set("bundle", new Blob([bundle as BlobPart], { type: "application/gzip" }), `${String(manifest.slug ?? "skill")}.tar.gz`);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (ifMatch) headers["If-Match"] = ifMatch;
    return fetch(`${this.apiUrl}/api/v1/skills`, {
      method: "POST",
      headers,
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  }

  async deleteSkill(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }

  async downloadSkillBundle(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}/bundle`, { method: "GET" });
  }

  /**
   * Bundle fetch for the verified-pull path. Returns the raw Response so the caller can
   * read the X-Skill-Bundle-Sha256 / X-Skill-Bundle-Signature headers, or null when the
   * instance serves no bundle for this skill (the metadata-only fallback path).
   */
  async getBundle(slug: string, version?: string): Promise<Response | null> {
    const path = version
      ? `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`
      : `/api/v1/skills/${encodeURIComponent(slug)}/bundle`;
    const response = await this.request(path, { method: "GET" });
    if (response.status === 404) return null;
    return response;
  }

  /** Every published version of a slug, newest first (hasna/apps#1630). */
  async listSkillVersions(slug: string): Promise<RemoteSkillVersion[]> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND"] });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`versions request failed: ${response.status}`);
    const body = (await response.json()) as { versions?: RemoteSkillVersion[] };
    return Array.isArray(body.versions) ? body.versions : [];
  }

  /** One version's manifest, or null when the slug@version was never published. */
  async getSkillVersion(slug: string, version: string): Promise<RemoteSkillVersion | null> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND", "SKILL_VERSION_NOT_FOUND"] });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`version request failed: ${response.status}`);
    return (await response.json()) as RemoteSkillVersion;
  }

  /** List the pins the instance holds for this principal. */
  async listPins(): Promise<RemotePin[]> {
    const response = await this.requestNewRoute("/api/v1/pins");
    return normalizePinList(await response.json());
  }

  /**
   * Pin a skill on the instance (upsert — pinning again refreshes it). The
   * wire contract matches the hosted-pins routes: a PUT with an optional
   * `{ metadata }` body, answered with the stored pin (`slug`, `pinnedAt`,
   * `metadata`).
   */
  async pin(slug: string, metadata?: Record<string, unknown>): Promise<RemotePin> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, {
      method: "PUT",
      body: JSON.stringify({ ...(metadata ? { metadata } : {}) }),
    });
    return normalizePin(await response.json());
  }

  /**
   * Unpin a skill on the instance. Resolves true when a pin existed and was
   * deleted; false when the instance has no pin for this slug (its 404
   * carries `code: "PIN_NOT_FOUND"` — a domain answer, not version skew). A
   * bare 404 (route not deployed) still throws `RemoteRouteUnsupportedError`.
   */
  async unpin(slug: string): Promise<boolean> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, { method: "DELETE" }, { domainNotFoundCodes: ["PIN_NOT_FOUND"] });
    return response.status !== 404;
  }

  /** List the tag names the instance serves. */
  async listTags(): Promise<string[]> {
    const response = await this.requestNewRoute("/api/v1/tags");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Remote tags payload did not match the expected contract (expected an array of tag names)");
    }
    // Instances expose either names or counted tag records. Accept one whole
    // contract at a time; filtering malformed or mixed rows would hide drift.
    const isName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
    if (payload.every(isName)) return payload;
    if (payload.every(tag => tag !== null && typeof tag === "object" && !Array.isArray(tag)
      && isName(tag.name) && Number.isSafeInteger(tag.count) && tag.count >= 0)) {
      return payload.map(tag => tag.name as string);
    }
    throw new Error("Remote tags payload did not match the expected contract (every element must be a non-empty tag name, or every element must be a counted tag record)");
  }

  /** List the skills carrying a tag on the instance. */
  async skillsByTag(tag: string): Promise<RemoteSkillSummary[]> {
    const path = `/api/v1/tags/${encodeURIComponent(tag)}/skills`;
    const response = await this.requestNewRoute(path);
    return normalizeSkillSummaryList(await response.json());
  }

  /**
   * Cursor-based incremental listing of skills updated after `since` (ISO 8601).
   * Each page carries an opaque `nextCursor`; null means the listing is complete.
   * This is the feed T9's sync reconciliation verb consumes.
   */
  async listUpdatedSince(since: string, options: { cursor?: string; limit?: number } = {}): Promise<UpdatedSincePage> {
    const params = new URLSearchParams({ since });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const response = await this.requestNewRoute(`/api/v1/skills/updated?${params.toString()}`);
    return normalizeUpdatedSincePage(await response.json());
  }
}

/** Present-but-wrong-typed optional fields fail the contract instead of being dropped. */
function requireOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  if (record[field] === undefined) return undefined;
  if (typeof record[field] !== "string") {
    throw new Error(`Remote payload did not match the expected contract (${field} must be a string when present)`);
  }
  return record[field] as string;
}

function normalizePin(entry: unknown): RemotePin {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote pin payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote pin payload did not match the expected contract (missing slug)");
  }
  let metadata: Record<string, unknown> | undefined;
  if (record.metadata !== undefined) {
    if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      throw new Error("Remote pin payload did not match the expected contract (metadata must be a JSON object when present)");
    }
    metadata = record.metadata as Record<string, unknown>;
  }
  const pinnedAt = requireOptionalString(record, "pinnedAt");
  return {
    slug,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizePinList(payload: unknown): RemotePin[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote pins payload did not match the expected contract (expected an array of pins)");
  }
  return payload.map(normalizePin);
}

function normalizeSkillSummary(entry: unknown): RemoteSkillSummary {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote skill payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote skill payload did not match the expected contract (missing slug)");
  }
  return {
    slug,
    ...(requireOptionalString(record, "name") !== undefined ? { name: requireOptionalString(record, "name") } : {}),
    ...(requireOptionalString(record, "version") !== undefined ? { version: requireOptionalString(record, "version") } : {}),
    ...(requireOptionalString(record, "updatedAt") !== undefined ? { updatedAt: requireOptionalString(record, "updatedAt") } : {}),
  };
}

function normalizeSkillSummaryList(payload: unknown): RemoteSkillSummary[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote skills payload did not match the expected contract (expected an array of skills)");
  }
  return payload.map(normalizeSkillSummary);
}

/** True when a 404's JSON body carries one of the given `code` values. */
async function responseBodyCarriesCode(response: Response, codes: string[]): Promise<boolean> {
  try {
    const payload: unknown = await response.clone().json();
    if (!payload || typeof payload !== "object") return false;
    const code = (payload as Record<string, unknown>).code;
    return typeof code === "string" && codes.includes(code);
  } catch {
    // A bare 404 (route missing, no domain body) does not parse as JSON.
    return false;
  }
}

function normalizeUpdatedSincePage(payload: unknown): UpdatedSincePage {
  if (!payload || typeof payload !== "object") {
    throw new Error("Updated-since payload did not match the expected contract (expected an object)");
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.skills)) {
    throw new Error("Updated-since payload did not match the expected contract (missing skills array)");
  }
  const skills = record.skills.map(normalizeSkillSummary);
  const nextCursor = record.nextCursor === undefined || record.nextCursor === null ? null : record.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("Updated-since payload did not match the expected contract (nextCursor must be a string or absent)");
  }
  return { skills, nextCursor };
}

/**
 * The client for the configured instance, or null when this install runs on
 * this machine (no credential and no authority).
 *
 * A configured authority with no credential does NOT return null: the shared
 * ladder throws, so the caller fails loudly instead of quietly reading the
 * bundled corpus while authentication is unconfigured.
 *
 * ASYNC because the credential ladder is: a vault pointer
 * (`HASNA_SKILLS_API_KEY_REF`) is completed through the secrets vault before a
 * client is built, so this never hands `RemoteSkillsClient` an empty key to put
 * behind `Authorization: Bearer `.
 */
export async function createRemoteSkillsClient(
  env: Record<string, string | undefined> = process.env,
): Promise<RemoteSkillsClient | null> {
  const connection = await resolveSkillsConnection(env);
  return connection ? new RemoteSkillsClient(connection.apiKey, connection.apiOrigin) : null;
}

/**
 * Write-free client resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * Identical to createRemoteSkillsClient() now that resolution is the shared
 * ladder, which reads the Keychain and the credentials file per call and writes
 * nothing. Kept as a separate name so read-only callers keep reading as
 * read-only, and so the distinction survives if a write ever creeps back in.
 */
export function createRemoteSkillsClientReadOnly(
  env: Record<string, string | undefined> = process.env,
): Promise<RemoteSkillsClient | null> {
  return createRemoteSkillsClient(env);
}
