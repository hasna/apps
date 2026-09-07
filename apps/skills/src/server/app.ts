import { createHash, randomBytes, randomInt } from "node:crypto";
import pkg from "../../package.json" with { type: "json" };
import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../lib/remote-run-contract.js";
import { signBundleBytes } from "../lib/skill-bundles.js";
import { createCancelService } from "../sdk/cancel.js";
import { GOVERNANCE_ERROR_CODES, GovernanceError } from "../sdk/governance.js";
import { createGovernanceStore, type GovernanceStore } from "../sdk/governance-store.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { seedBundledCorpus } from "./seed-bundled.js";
import { authenticateRequest, hashApiKey, publicPrincipal } from "./auth.js";
import { resolveServerConfig, type SkillsServerConfig } from "./config.js";
import { resolveDatabaseTarget } from "./database-url.js";
import { executeRun } from "./handlers.js";
import {
  SkillRequestError,
  assertPublishableSlug,
  getMergedSkill,
  getMergedSkillMd,
  listMergedSkills,
  listMergedSkillsByTag,
  listOrgTags,
  listPinsByTag,
  parseIfMatch,
  parsePublishRequest,
  pinMetadataField,
  pinPayload,
  readPublishedBundle,
  listSkillVersionsPayload,
  readSkillVersion,
  readSkillVersionBundle,
  skillVersionPayload,
  resolvePublishedSkill,
  revisionEtag,
  storePublishedSkill,
  deletePublishedSkill,
  publishedPayload,
  skillSummary,
} from "./skills-api.js";
import { createStore, type MemorySkillsStore } from "./store.js";
import { SkillRevisionConflictError, SkillVersionExistsError, StaleLeaseGenerationError, type ApiPrincipal, type ServerRunRecord, type SkillsProductStore } from "./types.js";

/**
 * Per-fetch-handler state for surfaces that manage short-lived secrets and
 * per-process identity. Nothing here is durable: a restart drops in-flight
 * login codes, device grants, display names, and uploaded input bytes, which is
 * the honest behaviour for a deterministic server - the platform's durable
 * account/billing store is a different deployment, not this one.
 */
export interface SkillsServerRuntimeState {
  /** email -> one in-flight verification code (6 digits, 10 minute TTL). */
  authCodes: Map<string, { code: string; expiresAt: number }>;
  /** deviceCode -> the grant (10 minute TTL). */
  deviceGrants: Map<string, { userCode: string; expiresAt: number }>;
  /** `${orgId}:${userId}` -> display name, for PATCH /account/profile. */
  displayNames: Map<string, string>;
  /** orgId -> workspace display name, for PATCH /workspaces/current. */
  workspaceNames: Map<string, string>;
  /** `${runId}/${fileName}` -> accepted uploaded input bytes. */
  inputUploads: Map<string, { bytes: Uint8Array; contentType: string; sha256: string }>;
  /** upload targets opened by POST /runs/:id/uploads: `${runId}/${fileName}`. */
  uploadTargets: Set<string>;
}

export function createSkillsServerState(): SkillsServerRuntimeState {
  return {
    authCodes: new Map(),
    deviceGrants: new Map(),
    displayNames: new Map(),
    workspaceNames: new Map(),
    inputUploads: new Map(),
    uploadTargets: new Set(),
  };
}

export interface SkillsServerOptions {
  /** Overrides the artifact storage (tests inject an in-memory S3 stand-in). */
  artifactStorage?: ArtifactStorage;
  config?: Partial<SkillsServerConfig>;
  store?: SkillsProductStore;
  /** Lifecycle ledger and ceiling reads for governance surfaces (cancellation). Defaults to the store's database. */
  governanceStore?: GovernanceStore;
  /** Overrides the per-process auth/upload state (tests inject clean copies). */
  runtimeState?: SkillsServerRuntimeState;
}

/**
 * Refuse to serve traffic from storage that will not survive a restart.
 *
 * /health answering `ok: true` from a process backed by a Map is worse than a crash: it
 * satisfies every load balancer, container orchestrator, and smoke test we have, right
 * up until the process restarts and every run, log, and artifact is gone. Failing at
 * startup puts the problem where an operator will see it.
 *
 * A store that declares no backend is assumed durable - see StoreBackendInfo. This
 * guard's job is to make our own defaults safe, not to audit somebody else's store.
 */
export function assertDurableStore(store: SkillsProductStore, config: Pick<SkillsServerConfig, "allowEphemeralStore">): void {
  const backend = store.backend;
  if (!backend || backend.durable) return;
  assertDurableTarget(backend, config);
}

/** The same refusal, expressed against a resolved target so it can run before anything opens. */
export function assertDurableTarget(
  target: { durable: boolean; label: string },
  config: Pick<SkillsServerConfig, "allowEphemeralStore">,
): void {
  if (target.durable || config.allowEphemeralStore) return;
  throw new Error(
    `refusing to start: the configured store is ${target.label} and does not survive a restart. ` +
      "Leave HASNA_SKILLS_DATABASE_URL unset to use the durable SQLite database in the skills data " +
      "directory, or point it at a postgres:// URL. Set HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1 only if " +
      "losing every run on restart is genuinely what you want.",
  );
}

export async function createSkillsFetchHandler(options: SkillsServerOptions = {}): Promise<(request: Request) => Promise<Response>> {
  const config = { ...resolveServerConfig(), ...options.config };
  // Refuse before opening anything. Resolving the target is pure, so a configuration we
  // are going to reject never gets as far as creating a database file or a connection
  // pool that nothing then closes.
  if (!options.store) assertDurableTarget(resolveDatabaseTarget(config.databaseUrl), config);
  const store = options.store ?? await createStore({
    databaseUrl: config.databaseUrl,
    bootstrapApiKey: config.bootstrapApiKey,
  });
  assertDurableStore(store, config);
  // Governance surfaces (cancellation) need the append-only lifecycle ledger and
  // the ceiling reads over the same database the product store writes. The
  // dialect resolution mirrors createStore's: postgres:// URL -> Postgres, no
  // URL -> the durable SQLite file in the data directory.
  const governanceStore = options.governanceStore ?? (await createGovernanceStore(config.databaseUrl));
  const artifactStorage = options.artifactStorage ?? new ArtifactStorage({
    bucket: config.artifactBucket,
    prefix: config.artifactPrefix,
  });
  const runtimeState = options.runtimeState ?? createSkillsServerState();
  // Seed the registry from the bundled corpus once per package version (hasna/apps#1630).
  // Only on a real boot with a durable store and a bootstrap key: injected test stores skip it.
  if (!options.store && config.bootstrapApiKey && config.seedBundledCorpus) {
    void seedBundledCorpus({ store, artifactStorage, principal: publicPrincipal(), log: (line) => console.log(line) })
      .catch((error) => console.error(`skills: bundled corpus seed failed: ${(error as Error).message}`));
  }

  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The API is mounted at both the legacy `/api/v1` prefix and the fleet
    // `/v1` dialect; both dispatch through the same table, so a deployment of
    // this server answers clients speaking either spelling. The auth endpoints
    // are aliased the same way (`/api/auth/*` and `/v1/auth/*`).
    const pathname = normalizeApiPrefix(url.pathname);
    const segments = pathSegments(pathname);

    try {
      if (request.method === "GET" && pathname === "/health") {
        return json({ ok: true, service: "skills", time: new Date().toISOString() });
      }

      if (request.method === "GET" && pathname === "/ready") {
        return json({ ok: true, service: "skills" });
      }

      // Deploy-gate contract (todos O15-03836): the fleet deploy gate verifies a
      // live build by GET /version -> 200 with the service identity and the
      // package version. It previously fell through to the 404 handler, so the
      // gate could never pass at skills.hasna.xyz.
      if (request.method === "GET" && pathname === "/version") {
        return json({ ok: true, service: "skills", version: pkg.version });
      }

      if (pathname.startsWith("/api/")) {
        const authAction = segments[2];
        const authDetail = segments[3];
        const authActionPath = authDetail ? `${authAction}/${authDetail}` : authAction ?? "";
        // The credential-acquisition routes are deliberately unauthenticated:
        // requesting a code or starting a device grant is the first step of
        // getting a credential, and every other /api/* route stays behind the
        // auth wall (the principle the wall exists to enforce).
        if (segments[1] === "auth" && UNAUTHENTICATED_AUTH_ROUTES.has(`${request.method} ${authActionPath}`)) {
          return await handleUnauthenticatedAuth(store, request, authActionPath, config, runtimeState);
        }
        // The byte-bearing PUT half of the input-upload flow carries no
        // credential by design (the upload target was only opened by an
        // authenticated admission and is single-use): the URL is the
        // capability, like a presigned upload URL.
        if (request.method === "PUT" && segments[1] === "v1" && segments[2] === "runs" && segments[4] === "uploads" && segments[5] && !segments[6]) {
          return await handleApiV1(store, governanceStore, publicPrincipal({ orgId: "org_dev" }), request, segments.slice(2), config, artifactStorage, runtimeState);
        }
        const principal = await authenticateRequest(store, request);
        if (!principal) return json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });

        if (segments[1] === "auth" && authAction === "keys") {
          return await handleApiKeys(store, principal, request, authDetail, config);
        }
        if (segments[1] === "auth" && authAction === "whoami") {
          return json(identityPayload(principal));
        }

        if (segments[1] === "v1") {
          return await handleApiV1(store, governanceStore, principal, request, segments.slice(2), config, artifactStorage, runtimeState);
        }
      }

      return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
    } catch (error) {
      // A SkillRequestError is a statement about the request, not a server fault. Left to
      // the generic handler below, "bundle is 40000000 bytes, over the 25000000 byte
      // limit" would come back as a 500 and read as our bug rather than the caller's.
      if (error instanceof SkillRequestError) {
        return json({ error: error.message, code: error.code }, { status: error.status });
      }
      // The optimistic-concurrency refusal (todos d061fcda): a write raced a newer
      // revision. 409 is the contract's answer — the caller must re-read and retry
      // with the current revision — never the generic 500 a conflict would otherwise
      // read as.
      if (error instanceof SkillVersionExistsError) {
        return json(
          {
            error: error.message,
            code: "SKILL_VERSION_EXISTS",
            slug: error.slug,
            version: error.version,
            existingBundleSha256: error.existingSha256,
            attemptedBundleSha256: error.attemptedSha256,
          },
          { status: 409 },
        );
      }
      if (error instanceof SkillRevisionConflictError) {
        return json(
          {
            error: error.message,
            code: "REVISION_CONFLICT",
            slug: error.slug,
            ...(error.currentRevisionId ? { currentRevisionId: error.currentRevisionId } : {}),
          },
          { status: 409 },
        );
      }
      return json({ error: "internal server error", detail: (error as Error).message }, { status: 500 });
    }
  };
}

export async function startSkillsServer(options: SkillsServerOptions = {}): Promise<Bun.Server<undefined>> {
  const config = { ...resolveServerConfig(), ...options.config };
  const fetch = await createSkillsFetchHandler({ ...options, config });
  return Bun.serve({ hostname: config.host, port: config.port, fetch, ...skillsServeLimits(config) });
}

/**
 * Socket-level body ceiling, derived from the same setting the publish route enforces.
 *
 * Without this the configured bundle limit was only ever advisory: Bun.serve defaults to
 * 128 MB, a chunked request sends no Content-Length for the early check to read, and
 * `request.formData()` materialises the whole body before any per-part check can run. So
 * a 25 MB configured cap admitted 128 MB of buffered request per connection. This refuses
 * it at the socket, before any of that is allocated.
 *
 * Exported so an embedder calling Bun.serve() with our fetch handler gets the same
 * ceiling instead of silently inheriting the default.
 */
export function skillsServeLimits(config: Pick<SkillsServerConfig, "skillBundleLimitBytes" | "requestBodyLimitBytes">): { maxRequestBodySize: number } {
  return { maxRequestBodySize: Math.max(config.skillBundleLimitBytes, config.requestBodyLimitBytes) + BODY_LIMIT_HEADROOM_BYTES };
}

/**
 * Slack between the configured payload cap and the socket cap, for multipart framing:
 * boundaries, per-part headers, and the manifest part that travels beside the bundle. Too
 * small and a bundle exactly at the limit is rejected by the transport with a message
 * about the wrong thing.
 */
const BODY_LIMIT_HEADROOM_BYTES = 1_000_000;

async function handleApiV1(
  store: SkillsProductStore,
  governanceStore: GovernanceStore,
  principal: ApiPrincipal,
  request: Request,
  parts: string[],
  config: SkillsServerConfig,
  artifactStorage: ArtifactStorage,
  runtimeState: SkillsServerRuntimeState,
): Promise<Response> {
  const [resource, id, subresource, childId, grandchild] = parts;

  // Router boundary (defence in depth): no decoded path segment may carry a path
  // separator or `..`. pathSegments() decodes each segment AFTER splitting on '/', so an
  // encoded `%2F`/`%2E%2E` would otherwise smuggle a traversal past the split and into a
  // handler as one opaque segment. Reject before any dispatch, before touching the store
  // or the registry.
  if (parts.some(segmentEscapesPath)) {
    return json({ error: "invalid path segment", code: "INVALID_PATH" }, { status: 400 });
  }

  if (resource === "capabilities") {
    // The capability contract the client gates remote submission and uploads on.
    // This server advertises exactly the surface it implements: bounded credit
    // approval with a zero-credit deterministic price list, and input uploads.
    if (request.method === "GET" && !id) {
      return json({
        product: "skills",
        contractVersion: 1,
        apiVersion: 1,
        capabilities: ["runs.submit", "runs.uploads"],
        billing: { unit: "credits", boundedRunApproval: true },
      });
    }
  }

  if (resource === "skills") {
    // The incremental updated-since feed (feed T9's sync reconciliation verb).
    // The cursor is an opaque compound of the last page's final (updatedAt,
    // slug) pair, so entries published within the same millisecond still page
    // deterministically instead of vanishing behind a strict timestamp bound.
    if (request.method === "GET" && id === "updated" && !subresource) {
      const query = new URL(request.url).searchParams;
      const since = query.get("since") ?? "";
      if (!since || Number.isNaN(Date.parse(since))) {
        return json({ error: "updated requires a valid ISO-8601 since parameter", code: "INVALID_SINCE" }, { status: 400 });
      }
      const cursor = parseFeedCursor(query.get("cursor"));
      const limit = clampInt(query.get("limit"), 20, 100);
      const updatedAtOf = (skill: unknown): string => {
        const record = skill as { updatedAt?: unknown };
        return typeof record.updatedAt === "string" ? record.updatedAt : "";
      };
      const slugOf = (skill: unknown): string => {
        const record = skill as { slug?: unknown };
        return typeof record.slug === "string" ? record.slug : "";
      };
      const merged = await listMergedSkills(store, principal);
      const changed = merged
        .filter((skill) => {
          const stamp = updatedAtOf(skill);
          if (stamp < since) return false;
          if (!cursor) return true;
          return stamp > cursor.updatedAt || (stamp === cursor.updatedAt && slugOf(skill) > cursor.slug);
        })
        .sort((a, b) => {
          const ta = updatedAtOf(a);
          const tb = updatedAtOf(b);
          if (ta !== tb) return ta.localeCompare(tb);
          return slugOf(a).localeCompare(slugOf(b));
        });
      const page = changed.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = last && page.length === limit && changed.length > limit
        ? `${updatedAtOf(last)}|${slugOf(last)}`
        : null;
      const payload: { skills: Array<{ slug: string; updatedAt: string }>; nextCursor?: string } = {
        skills: page.map((skill) => {
          const record = skill as { slug?: unknown; displayName?: unknown; version?: unknown };
          return {
            slug: typeof record.slug === "string" ? record.slug : "",
            ...(typeof record.displayName === "string" && record.displayName ? { name: record.displayName } : {}),
            ...(typeof record.version === "string" && record.version ? { version: record.version } : {}),
            updatedAt: updatedAtOf(skill),
          };
        }),
      };
      if (nextCursor) payload.nextCursor = nextCursor;
      return json(payload);
    }

    if (request.method === "GET" && !id) {
      const tag = new URL(request.url).searchParams.get("tag");
      if (tag !== null && tag !== "") return json(await listMergedSkillsByTag(store, principal, tag));
      return json(await listMergedSkills(store, principal));
    }

    // Publish. The only route that reads config.skillBundleLimitBytes. Guarded by the
    // optimistic-concurrency contract (todos d061fcda): a publish against a slug this
    // org already has live must carry If-Match naming the current revision, or the
    // write is refused with 409 - never a silent overwrite.
    if (request.method === "POST" && !id) {
      const expectedRevisionId = parseIfMatch(request.headers.get("if-match"));
      const parsed = await parsePublishRequest(request, config);
      const { record, alreadyPublished } = await storePublishedSkill(store, artifactStorage, principal, parsed, expectedRevisionId);
      return json(publishedPayload(record, { alreadyPublished }), { status: 201, headers: { ETag: revisionEtag(record.revisionId) } });
    }

    if (request.method === "GET" && id && subresource === "skill.md") {
      // Traversal defence for this route lives at the router boundary (segmentEscapesPath,
      // #65) and inside the getServerSkillMd() fallback getMergedSkillMd() delegates to;
      // no per-route slug assertion is re-applied here.
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      const docs = await getMergedSkillMd(store, artifactStorage, principal, id);
      return docs
        ? new Response(docs, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } })
        : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "GET" && id && subresource === "versions" && !childId) {
      return json(await listSkillVersionsPayload(store, principal, id));
    }
    if (request.method === "GET" && id && subresource === "versions" && childId && !parts[4]) {
      const version = await readSkillVersion(store, principal, id, childId);
      const current = (await store.getSkill(principal, id))?.bundleSha256;
      return json(skillVersionPayload(version, current));
    }
    if (request.method === "GET" && id && subresource === "versions" && childId && parts[4] === "bundle" && !parts[5]) {
      const { version, bytes } = await readSkillVersionBundle(store, artifactStorage, principal, id, childId);
      const headers: Record<string, string> = {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${version.slug}-${version.version}.tar.gz"`,
        "X-Skill-Bundle-Sha256": version.bundleSha256,
        "X-Skill-Version": version.version,
        ETag: `"${version.bundleSha256}"`,
        "Cache-Control": "no-store",
      };
      if (config.bundleSigningKey) headers["X-Skill-Bundle-Signature"] = signBundleBytes(bytes, config.bundleSigningKey);
      return new Response(bytes, { headers });
    }
    if (request.method === "GET" && id && subresource === "bundle") {
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      if (resolved.kind === "absent") {
        return json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
      }
      const { record, bytes } = await readPublishedBundle(store, artifactStorage, principal, id);
      const headers: Record<string, string> = {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${record.slug}.tar.gz"`,
        // The digest a client should verify against, so an intermediary cannot swap the
        // body without the client being able to notice.
        "X-Skill-Bundle-Sha256": record.bundleSha256 ?? "",
        // Revision identity (todos d061fcda): the same ETag GET /skills/:slug issues,
        // so a pull can prove WHICH revision the bytes belong to and record it in its
        // marker. Also the plain ETag, for generic HTTP caching semantics.
        "X-Skill-Revision-Id": record.revisionId,
        "X-Skill-Revision-Number": String(record.revisionNumber),
        ETag: revisionEtag(record.revisionId),
        "Cache-Control": "no-store",
      };
      // Sign the exact bytes being served so a client holding the same key can tell this
      // server's bundle from anything else, even if the digest header is stripped in
      // transit. The key is never echoed anywhere.
      if (config.bundleSigningKey) {
        headers["X-Skill-Bundle-Signature"] = signBundleBytes(bytes, config.bundleSigningKey);
      }
      return new Response(bytes, { headers });
    }

    if (request.method === "GET" && id && !subresource) {
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      if (resolved.kind === "published") {
        return json(publishedPayload(resolved.record), { headers: { ETag: revisionEtag(resolved.record.revisionId) } });
      }
      // Absent from this org's registry: the bundled corpus may still serve the slug.
      const skill = await getMergedSkill(store, artifactStorage, principal, id);
      return skill ? json(skill) : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    // Quote before submission (the client's bounded-credit admission step). The
    // deterministic server prices every skill at zero credits; a skill that does
    // not exist is a hard 404, everything else is quotable.
    if (request.method === "POST" && id && subresource === "quote" && !childId) {
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      const exists = resolved.kind === "published" || (await getMergedSkill(store, artifactStorage, principal, id)) !== null;
      if (!exists) return json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
      return json({
        skill: id,
        availability: { status: "available" },
        pricing: { costCredits: 0, costCents: 0 },
      });
    }

    if ((request.method === "PUT" || request.method === "PATCH") && id && !subresource) {
      const expectedRevisionId = parseIfMatch(request.headers.get("if-match"));
      const body = await readJson(request, config.requestBodyLimitBytes);
      const updated = await store.updateSkill(principal, id, skillPatch(body), expectedRevisionId);
      // 404 rather than an implicit create: PUT against a slug this org has not published
      // would otherwise silently mint a bundle-less skill from a typo'd name.
      return updated
        ? json(publishedPayload(updated), { headers: { ETag: revisionEtag(updated.revisionId) } })
        : json({ error: "published skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "DELETE" && id && !subresource) {
      const removed = await deletePublishedSkill(store, artifactStorage, principal, id, config.tombstoneWindowMs);
      return removed
        ? json({
            deleted: true,
            slug: id,
            ...(removed.tombstonedAt ? { tombstonedAt: removed.tombstonedAt, tombstonePurgeAfter: removed.tombstonePurgeAfter } : {}),
          })
        : json({ error: "published skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }
  }

  if (resource === "pins") {
    if (request.method === "GET" && !id) {
      const tag = new URL(request.url).searchParams.get("tag");
      if (tag !== null && tag !== "") return json(await listPinsByTag(store, principal, tag));
      return json((await store.listPins(principal)).map(pinPayload));
    }

    if (request.method === "PUT" && id && !subresource) {
      // The slug grammar is the published-skill one, re-asserted here: a pin
      // names the same space of slugs, and the route never builds a path or a
      // storage key from it, but an unanchored slug could still smuggle
      // separators into a future consumer. Reject before touching the store.
      assertPublishableSlug(id);
      const body = await readJson(request, config.requestBodyLimitBytes);
      const pin = await store.pinSkill(principal, id, pinMetadataField(body));
      return json(pinPayload(pin));
    }

    if (request.method === "DELETE" && id && !subresource) {
      assertPublishableSlug(id);
      const removed = await store.unpinSkill(principal, id);
      return removed
        ? json({ deleted: true, slug: id })
        : json({ error: "pin not found", code: "PIN_NOT_FOUND" }, { status: 404 });
    }
  }

  if (resource === "tags") {
    if (request.method === "GET" && !id) {
      return json(await listOrgTags(store, principal));
    }

    if (request.method === "GET" && id && subresource === "skills") {
      // The tag is a decoded path segment (traversal-checked at the router
      // boundary) but not slug-validated: a tag is free text, and the store
      // filters exact-match. Empty results, never an error, for an unknown tag.
      return json((await listMergedSkillsByTag(store, principal, id)).map(skillSummary));
    }
  }

  if (resource === "runs") {
    if (request.method === "GET" && !id) {
      const limit = clampInt(new URL(request.url).searchParams.get("limit"), 20, 100);
      return json((await store.listRuns(principal, limit)).map(runPayload));
    }

    if (request.method === "POST" && id && !subresource) {
      const body = await readJson(request, config.requestBodyLimitBytes);
      const input = isRecord(body.input) ? body.input : {};
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      const run = await store.createRun({
        principal,
        slug: id,
        input,
        args,
        idempotencyKey: request.headers.get("idempotency-key") || stringField(body.idempotencyKey),
      });
      if (config.inlineWorker) void executeRun(store, run, artifactStorage);
      return json(runPayload(run), { status: 202 });
    }

    if (request.method === "GET" && id && !subresource) {
      const run = await store.getRun(principal, id);
      return run ? json(runPayload(run)) : json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "GET" && id && subresource === "logs") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      return json(await store.listLogs(principal, id));
    }

    if (request.method === "GET" && id && subresource === "artifacts" && !childId) {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      const artifacts = await store.listArtifacts(principal, id);
      return json(artifacts.map(({ bodyText, ...artifact }) => artifact));
    }

    if (request.method === "GET" && id && subresource === "artifacts" && childId && !grandchild) {
      const artifact = await store.getArtifact(principal, id, childId);
      if (!artifact) return json({ error: "artifact not found", code: "ARTIFACT_NOT_FOUND" }, { status: 404 });
      const body = await artifactStorage.readText(artifact);
      if (body === null) {
        return json({ error: "artifact storage backend unavailable", code: "ARTIFACT_BACKEND_UNAVAILABLE" }, { status: 503 });
      }
      return new Response(body, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName.replace(/"/g, "")}"`,
        },
      });
    }

    // The client dials the explicit /download suffix; older clients dial the raw
    // artifact id. Both answer the same bytes.
    if (request.method === "GET" && id && subresource === "artifacts" && childId && grandchild === "download") {
      const artifact = await store.getArtifact(principal, id, childId);
      if (!artifact) return json({ error: "artifact not found", code: "ARTIFACT_NOT_FOUND" }, { status: 404 });
      const body = await artifactStorage.readText(artifact);
      if (body === null) {
        return json({ error: "artifact storage backend unavailable", code: "ARTIFACT_BACKEND_UNAVAILABLE" }, { status: 503 });
      }
      return new Response(body, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName.replace(/"/g, "")}"`,
        },
      });
    }

    if (request.method === "POST" && id && subresource === "cancel") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      // The shipped cancel service fences the run's lease_generation in the same
      // statement that moves it to cancel_requested, then transitions it to the
      // terminal cancelled state, quarantines partial artifacts, and appends a
      // cancellation receipt. An unfenced updateRun here let a worker that
      // finished after the cancel overwrite the cancellation, and stranded
      // queued runs in the non-terminal cancel_requested state forever (todos
      // b72cc950).
      try {
        const outcome = await createCancelService({ store, governanceStore, storage: artifactStorage }).cancel(principal, id, principal.email);
        return json(runPayload(outcome.run));
      } catch (error) {
        // A generation race while cancelling (the run moved between the read
        // above and the fenced transition) is the caller's problem to re-read,
        // not a server fault.
        if (error instanceof GovernanceError && error.code === GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION) {
          return json({ error: error.message, code: error.code }, { status: 409 });
        }
        if (error instanceof StaleLeaseGenerationError) {
          return json({ error: error.message, code: GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION }, { status: 409 });
        }
        throw error;
      }
    }

    if (request.method === "POST" && id && subresource === "resume" && !childId) {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      if (run.status !== "queued") {
        return json({ error: "run is not resumable from its current status", code: "RUN_NOT_RESUMABLE" }, { status: 409 });
      }
      if (config.inlineWorker) void executeRun(store, run, artifactStorage);
      return json(runPayload(run), { status: 202 });
    }

    // Input-upload admission: opens one PUT target per declared file. The
    // targets exist only after an authenticated admission, and the subsequent
    // PUT carries no credential by design (the URL is the capability, like a
    // signed upload URL on the platform's S3-backed deployment).
    if (request.method === "POST" && id && subresource === "uploads" && !childId) {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        return json({ error: "run is not accepting uploads", code: "RUN_NOT_QUEUED" }, { status: 409 });
      }
      const body = await readJson(request, config.requestBodyLimitBytes);
      const declared = Array.isArray(body.files) ? body.files : [];
      const targets: Array<{ name: string; uploadUrl: string }> = [];
      const seen = new Set<string>();
      for (const entry of declared) {
        const name = isRecord(entry) && typeof entry.name === "string" ? entry.name : "";
        const sizeBytes = isRecord(entry) && typeof entry.sizeBytes === "number" ? entry.sizeBytes : NaN;
        const sha = isRecord(entry) && typeof entry.sha256 === "string" ? entry.sha256 : "";
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name === "." || name === ".." || seen.has(name)) {
          return json({ error: "invalid input file name", code: "INVALID_UPLOAD" }, { status: 400 });
        }
        seen.add(name);
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha)) {
          return json({ error: "invalid input file descriptor", code: "INVALID_UPLOAD" }, { status: 400 });
        }
        runtimeState.uploadTargets.add(`${id}/${name}`);
        const origin = new URL(request.url).origin;
        targets.push({ name, uploadUrl: `${origin}/api/v1/runs/${encodeURIComponent(id)}/uploads/${encodeURIComponent(name)}` });
      }
      return json({ files: targets });
    }

    // The anonymous PUT half of the upload flow: only a target opened by the
    // authenticated admission above is writable. The admission already proved
    // the run existed and was accepting uploads, so the PUT itself only checks
    // the opened-target marker — there is no credential to re-verify with.
    if (request.method === "PUT" && id && subresource === "uploads" && childId && !grandchild) {
      if (!runtimeState.uploadTargets.has(`${id}/${childId}`)) {
        return json({ error: "unknown input upload target", code: "UPLOAD_TARGET_NOT_FOUND" }, { status: 404 });
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > 20 * 1024 * 1024) {
        return json({ error: "input file exceeds the 20 MiB limit", code: "INVALID_UPLOAD" }, { status: 413 });
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      runtimeState.inputUploads.set(`${id}/${childId}`, { bytes, sha256, contentType: request.headers.get("content-type") ?? "application/octet-stream" });
      return json({ uploaded: true, name: childId, sha256 });
    }
  }

  if (resource === "account" && request.method === "PATCH" && id === "profile" && !subresource) {
    const body = await readJson(request, config.requestBodyLimitBytes);
    const displayName = body.displayName;
    if (typeof displayName !== "string" || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(displayName) || !displayName.trim() || [...displayName.trim()].length > 100) {
      return json({ error: "Use a name of 1-100 characters without control characters or newlines.", code: "INVALID_DISPLAY_NAME" }, { status: 400 });
    }
    const trimmed = displayName.trim();
    runtimeState.displayNames.set(`${principal.orgId}:${principal.userId}`, trimmed);
    return json({ user: { id: principal.userId, email: principal.email, displayName: trimmed, role: principal.role } });
  }

  if (resource === "workspaces" && request.method === "PATCH" && id === "current" && !subresource) {
    const body = await readJson(request, config.requestBodyLimitBytes);
    const name = body.name;
    if (typeof name !== "string" || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(name) || !name.trim() || [...name.trim()].length > 100) {
      return json({ error: "Use a name of 1-100 characters without control characters or newlines.", code: "INVALID_WORKSPACE_NAME" }, { status: 400 });
    }
    const trimmed = name.trim();
    runtimeState.workspaceNames.set(principal.orgId, trimmed);
    return json({ organization: { id: principal.orgId, slug: principal.orgSlug, name: trimmed } });
  }

  if (resource === "billing") {
    // The deterministic server operates a zero-credit balance: status and packs
    // answer truthfully, checkout/portal cannot be created and fail with the
    // client-recognised capability code instead of inventing a payment link.
    if (request.method === "GET" && id === "status" && !subresource) {
      return json({ creditBalance: 0, plan: "oss", hasPaymentMethod: false });
    }
    if (request.method === "GET" && id === "usage" && !subresource) {
      return json([]);
    }
    if (request.method === "GET" && id === "invoices" && !subresource) {
      return json([]);
    }
    if (request.method === "POST" && id === "checkout" && !subresource) {
      return json({ error: "Subscription checkout is unavailable on this server; use skills credits packs and skills billing portal.", code: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" }, { status: 503 });
    }
    if (request.method === "POST" && id === "portal" && !subresource) {
      return json({ error: "The billing portal is unavailable on this server; manage account credits through the enabled surfaces.", code: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" }, { status: 503 });
    }
    if (request.method === "GET" && id === "credits" && !subresource) {
      return json([]);
    }
    if (request.method === "POST" && id === "credits" && !subresource) {
      return json({ error: "Credit purchases are unavailable on this server; the deterministic price list is zero credits.", code: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" }, { status: 503 });
    }
  }

  return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
}

function identityPayload(principal: ApiPrincipal): Record<string, unknown> {
  return {
    user: { id: principal.userId, email: principal.email, role: principal.role },
    organization: { id: principal.orgId, slug: principal.orgSlug, name: principal.orgName },
  };
}

/**
 * Map the `/v1` fleet dialect onto the dispatch table's `/api/v1` spelling.
 *
 * The server answers both prefixes with the same handlers (the legacy `/api/v1`
 * spelling is what the deployed fleet gateway and the published client dial);
 * the `/v1` alias is the canonical fleet dialect (contracts toV1BaseUrl, every
 * sibling serve app). `/v1/auth/*` likewise maps onto `/api/auth/*`.
 */
function normalizeApiPrefix(pathname: string): string {
  if (pathname.startsWith("/v1/auth/")) return `/api/auth/${pathname.slice("/v1/auth/".length)}`;
  if (pathname.startsWith("/v1/")) return `/api/v1/${pathname.slice("/v1/".length)}`;
  return pathname;
}

/** Credential-acquisition routes that must work before any credential exists. */
const UNAUTHENTICATED_AUTH_ROUTES = new Set([
  "POST login",
  "POST verify",
  "POST device/start",
  "POST device/token",
]);

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

function newAuthCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * The account every credential resolves to on the deterministic server: the
 * bootstrap key's org/identity, or null when the server was booted without one.
 */
async function accountPrincipal(store: SkillsProductStore, config: SkillsServerConfig): Promise<ApiPrincipal | null> {
  if (!config.bootstrapApiKey) return null;
  return store.authenticateApiKeyHash(hashApiKey(config.bootstrapApiKey));
}

async function handleUnauthenticatedAuth(
  store: SkillsProductStore,
  request: Request,
  action: string,
  config: SkillsServerConfig,
  runtimeState: SkillsServerRuntimeState,
): Promise<Response> {
  const body = await readJson(request, config.requestBodyLimitBytes);

  if (request.method === "POST" && action === "login") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "a valid email address is required", code: "INVALID_EMAIL" }, { status: 400 });
    }
    const code = newAuthCode();
    runtimeState.authCodes.set(email, { code, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
    // The deterministic server has no mailer: the code is delivered to the
    // server console and returned in the response envelope (the CLI prints it
    // when present). A platform deployment with a real mailer never returns it.
    console.log(`skills: login code for ${email}: ${code}`);
    return json({ status: "code_sent", email, verificationCode: code });
  }

  if (request.method === "POST" && action === "verify") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const pending = runtimeState.authCodes.get(email);
    // A wrong attempt must not consume the pending code: the operator retries
    // with the SAME delivered code. Only expiry or success clears it.
    if (!email || !pending || pending.code !== code) {
      return json({ error: "invalid or expired verification code", code: "INVALID_CODE" }, { status: 401 });
    }
    if (pending.expiresAt < Date.now()) {
      runtimeState.authCodes.delete(email);
      return json({ error: "invalid or expired verification code", code: "INVALID_CODE" }, { status: 401 });
    }
    runtimeState.authCodes.delete(email);
    const account = await accountPrincipal(store, config);
    if (!account) {
      return json({ error: "sign-in is not configured on this server: boot it with a bootstrap API key", code: "SIGNIN_UNCONFIGURED" }, { status: 503 });
    }
    const key = await store.createApiKey?.(account, { name: "session" });
    if (!key) {
      return json({ error: "this server cannot mint sessions", code: "SIGNIN_UNCONFIGURED" }, { status: 503 });
    }
    return json(sessionPayload(key.key, account));
  }

  if (request.method === "POST" && action === "device/start") {
    const deviceCode = newAuthCode();
    const userCode = newAuthCode();
    const expiresAt = Date.now() + AUTH_CODE_TTL_MS;
    runtimeState.deviceGrants.set(deviceCode, { userCode, expiresAt });
    const origin = new URL(request.url).origin;
    return json({
      deviceCode,
      userCode,
      verificationUri: `${origin}/v1/auth/device`,
      verificationUriComplete: `${origin}/v1/auth/device?code=${userCode}`,
      expiresIn: AUTH_CODE_TTL_MS / 1000,
      interval: 5,
    });
  }

  if (request.method === "POST" && action === "device/token") {
    const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
    const grant = runtimeState.deviceGrants.get(deviceCode);
    if (!grant || grant.expiresAt < Date.now()) {
      runtimeState.deviceGrants.delete(deviceCode);
      return json({ error: "invalid or expired device grant", code: "INVALID_DEVICE_GRANT" }, { status: 401 });
    }
    // The deterministic server has no browser surface, so the terminal polling
    // for the token IS the operator: the first poll confirms the grant. A
    // platform deployment answers authorization_pending until its browser flow
    // confirms.
    const account = await accountPrincipal(store, config);
    if (!account) {
      return json({ error: "sign-in is not configured on this server: boot it with a bootstrap API key", code: "SIGNIN_UNCONFIGURED" }, { status: 503 });
    }
    const key = await store.createApiKey?.(account, { name: "session" });
    if (!key) {
      return json({ error: "this server cannot mint sessions", code: "SIGNIN_UNCONFIGURED" }, { status: 503 });
    }
    runtimeState.deviceGrants.delete(deviceCode);
    return json(sessionPayload(key.key, account));
  }

  return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
}

function sessionPayload(token: string, account: ApiPrincipal): Record<string, unknown> {
  return {
    token,
    firstLogin: true,
    user: { id: account.userId, email: account.email, role: account.role },
    organization: { id: account.orgId, slug: account.orgSlug, name: account.orgName },
  };
}

async function handleApiKeys(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  request: Request,
  keyId: string | undefined,
  config: SkillsServerConfig,
): Promise<Response> {
  // Key management is only meaningful on a store that can persist keys.
  if (!store.createApiKey || !store.listApiKeys || !store.revokeApiKey) {
    return json({ error: "this server cannot manage API keys", code: "KEY_STORE_UNSUPPORTED" }, { status: 501 });
  }
  if (request.method === "GET" && !keyId) {
    return json(await store.listApiKeys(principal));
  }
  if (request.method === "POST" && !keyId) {
    const body = await readJson(request, config.requestBodyLimitBytes);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100 || /[\p{Cc}\p{Cs}]/u.test(name)) {
      return json({ error: "API key name must be 1-100 characters without control characters", code: "INVALID_KEY_NAME" }, { status: 400 });
    }
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is string => typeof scope === "string" && /^[a-z][a-z0-9_:.-]*$/.test(scope))
      : undefined;
    const created = await store.createApiKey(principal, { name, scopes });
    const rows = await store.listApiKeys(principal);
    const row = rows.find((candidate) => candidate.id === created.id);
    return json({ key: created.key, id: created.id, name, scopes: row?.scopes ?? scopes ?? principal.scopes, createdAt: row?.createdAt });
  }
  if (request.method === "DELETE" && keyId) {
    const revoked = await store.revokeApiKey(principal, keyId);
    if (!revoked) return json({ error: "api key not found", code: "KEY_NOT_FOUND" }, { status: 404 });
    return json({ revoked: true, id: keyId });
  }
  return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
}

function runPayload(run: ServerRunRecord): Record<string, unknown> {
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    id: run.id,
    skill: run.skill,
    requestedSlug: run.requestedSlug,
    status: run.status,
    correlationId: run.correlationId,
    costCents: run.costCents,
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.outputType ? { outputType: run.outputType } : {}),
    ...(run.outputPreview ? { outputPreview: run.outputPreview } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode, code: run.errorCode } : {}),
    ...(run.errorMessage ? { errorMessage: run.errorMessage, error: run.errorMessage } : {}),
  };
}

/**
 * Metadata-only patch from a JSON body.
 *
 * Absent keys are absent, not null: spreading `{version: undefined}` over the current
 * record would erase the version on every PATCH that did not mention it.
 */
function skillPatch(body: Record<string, unknown>): Parameters<SkillsProductStore["updateSkill"]>[2] {
  const patch: Record<string, unknown> = {};
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.category === "string") patch.category = body.category;
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof body.version === "string") patch.version = body.version;
  if (typeof body.skillMd === "string") patch.skillMd = body.skillMd;
  if (body.kind === "executable" || body.kind === "instruction") patch.kind = body.kind;
  return patch;
}

async function readJson(request: Request, limitBytes: number): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > limitBytes) throw new Error("request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limitBytes) throw new Error("request body too large");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  return isRecord(parsed) ? parsed : {};
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeSegment);
}

/**
 * decodeURIComponent throws URIError on malformed input — a lone `%`, a truncated
 * `%2`, or an overlong UTF-8 sequence like `%c0%af`. This runs before the request
 * try/catch, so a throw here would surface as a 500 with a stack trace rather than a
 * clean rejection. A malformed segment is never a legitimate route, so keep it in its
 * raw (still-encoded) form: it then fails segmentEscapesPath (if it still carries `..`)
 * or the isValidSkillSlug guard (its `%` is not slug-shaped), yielding a 400/404.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A decoded path segment that must never reach a handler: one carrying a path separator
 * (`/` or `\`) or a `..` parent reference. After pathSegments() decodes, these can only
 * appear when a client percent-encoded them to slip past the split-on-'/' — i.e. a
 * traversal attempt. Legitimate segments (slugs, run ids, `skill.md`) contain none.
 */
function segmentEscapesPath(segment: string): boolean {
  return segment.includes("/") || segment.includes("\\") || segment.includes("..");
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** The opaque updated-feed cursor: `<updatedAt ISO>|<slug>`. Invalid tokens are ignored. */
function parseFeedCursor(token: string | null): { updatedAt: string; slug: string } | null {
  if (!token) return null;
  const separator = token.lastIndexOf("|");
  if (separator < 1) return null;
  const updatedAt = token.slice(0, separator);
  const slug = token.slice(separator + 1);
  if (!slug || Number.isNaN(Date.parse(updatedAt))) return null;
  return { updatedAt, slug };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clampInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export type { MemorySkillsStore };
