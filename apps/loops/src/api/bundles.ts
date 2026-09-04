/**
 * The bundle routes: `/v1/loops/{id}/versions…`, `/v1/loops/{id}/rollback`,
 * `/v1/loops/{id}/pin` and the tenant-wide `/v1/bundles` index.
 *
 * Two rules shape everything here.
 *
 * 1. **Versions are immutable.** The server allocates the version inside the
 *    same transaction that inserts the `loop_revisions` row, then writes the
 *    objects. A rollback does not rewrite history — it APPENDS a new revision
 *    carrying the older one's digest and storage key, with `rolledBackFrom`
 *    set. Nothing in the ledger is ever updated or deleted.
 *
 * 2. **A prompt never reaches a lower-scoped caller.** `publicTarget()` strips
 *    `prompt`/`promptSource` from every agent target on read, which is correct
 *    and does not change — so the bundle is the ONLY round trip for an agent
 *    prompt, and every surface that can materialise one requires the
 *    `loops:bundle` scope (see `route-policy.ts`, where `machine` tokens are
 *    excluded from these routes entirely). `carriesPrompt` is derived
 *    server-side from the uploaded `loop.json`, never trusted from the client,
 *    so a bundle cannot be mislabelled as prompt-free to widen its audience.
 */
import { hasAllScopes } from "@hasna/contracts/auth";
import type { Loop, LoopBundleSummary, LoopRevision } from "../types.js";
import type { TenantAuthContext } from "../lib/auth/tenant-auth.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import { LoopArchivedError, LoopNotFoundError, LoopVersionNotFoundError } from "../lib/errors.js";
import {
  BundleArtifactStorage,
  BUNDLE_ARCHIVE_CONTENT_TYPE,
} from "../lib/bundle/artifact-storage.js";
import {
  assertBundleName,
  BundleIntegrityError,
  LOOP_JSON_FILE,
  MAX_ARCHIVE_BYTES,
  MAX_MANIFEST_BYTES,
  validateBundleManifest,
  type BundleManifest,
} from "../lib/bundle/manifest.js";
import { definitionCarriesPrompt, parseDefinition, type LoopBundleDefinition } from "../lib/bundle/local.js";
import { unpackBundle, verifyArchiveSha256, verifyBundleAgainstManifest } from "../lib/bundle/unpack.js";
import { assertNoCredentials, ownBytes } from "../lib/bundle/pack.js";

/** The scope that gates every surface able to materialise an agent prompt. */
export const BUNDLE_SCOPE = "loops:bundle";

/** Default cap for the multipart upload body. Separate from the JSON body limit. */
export const DEFAULT_BUNDLE_LIMIT_BYTES = MAX_ARCHIVE_BYTES + MAX_MANIFEST_BYTES + 64 * 1024;

/**
 * HTTP status for each integrity/conflict code the bundle paths raise.
 *
 * Kept as data rather than as throw sites so `errorResponse` in api/index.ts
 * can map a code that crossed a dist bundle boundary (where `instanceof` is
 * useless) without duplicating the table.
 */
export const BUNDLE_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  BUNDLE_NAME_INVALID: 422,
  BUNDLE_PATH_INVALID: 422,
  BUNDLE_MANIFEST_INVALID: 422,
  BUNDLE_DIGEST_MISMATCH: 400,
  ARCHIVE_DIGEST_MISMATCH: 400,
  MANIFEST_FILE_MISMATCH: 400,
  BUNDLE_ENTRY_UNSAFE: 400,
  BUNDLE_ARCHIVE_CORRUPT: 400,
  BUNDLE_EMPTY: 400,
  BUNDLE_FILE_TOO_LARGE: 413,
  BUNDLE_TOO_LARGE: 413,
  BUNDLE_TOO_MANY_FILES: 413,
  BUNDLE_CONTAINS_SECRET: 422,
  BUNDLE_VERSION_INVALID: 422,
  LOOP_JSON_INVALID: 422,
  LOOP_VERSION_EXISTS: 409,
  BUNDLE_NAME_TAKEN: 409,
  LOOP_VERSION_NOT_FOUND: 404,
  BUNDLE_LOOP_MISMATCH: 409,
  BUNDLE_SCOPE_REQUIRED: 403,
  BUNDLE_OBJECT_MISSING: 503,
});

/** The slice of the v1 request context the bundle routes need. */
export interface BundleRequestContext {
  request: Request;
  url: URL;
  storage?: LoopStorageContract;
  auth: TenantAuthContext;
  bodyLimitBytes: number;
  bundleLimitBytes?: number;
  now: () => Date;
  /** Injected by tests; production builds one from the environment. */
  artifacts?: BundleArtifactStorage;
}

function ok(payload: Record<string, unknown>, init?: ResponseInit): Response {
  return Response.json({ ok: true, ...payload }, init);
}

function bundleError(code: keyof typeof BUNDLE_ERROR_STATUS | string, message: string): BundleIntegrityError {
  return new BundleIntegrityError(String(code), message);
}

function requireStorage(storage: LoopStorageContract | undefined): LoopStorageContract {
  if (!storage) throw bundleError("BUNDLE_STORAGE_UNAVAILABLE", "storage is not configured");
  return storage;
}

/**
 * Whether this key may see prompt bytes.
 *
 * Delegated to the shared scope matcher rather than a string compare, so a
 * wildcard grant (`loops:*`) is honoured here exactly as the route-policy gate
 * honours it. A hand-rolled `includes()` would have made an admin key with
 * `loops:*` fail the download while passing the policy - two different answers
 * to the same question, which is how a scope check stops being one.
 */
function hasBundleScope(auth: TenantAuthContext): boolean {
  return hasAllScopes(auth.scopes, [BUNDLE_SCOPE]);
}

function artifactsFor(ctx: BundleRequestContext): BundleArtifactStorage {
  return ctx.artifacts ?? new BundleArtifactStorage();
}

// ── projections ──────────────────────────────────────────────────────────────

function publicRevision(revision: LoopRevision, state: "complete" | "incomplete"): Record<string, unknown> {
  return {
    version: revision.version,
    bundleName: revision.bundleName,
    bundleDigest: revision.bundleDigest,
    archiveSha256: revision.archiveSha256,
    archiveBytes: revision.archiveBytes,
    fileCount: Array.isArray((revision.manifest as { files?: unknown[] }).files)
      ? (revision.manifest as { files: unknown[] }).files.length
      : 0,
    carriesPrompt: revision.carriesPrompt,
    author: revision.author,
    source: { station: revision.sourceStation ?? null, agent: revision.sourceAgent ?? null },
    reason: revision.reason ?? null,
    rolledBackFrom: revision.rolledBackFrom ?? null,
    storage: revision.storageKind,
    state,
    createdAt: revision.createdAt,
  };
}

/**
 * Project a stored `loop.json` for a JSON response.
 *
 * Without `loops:bundle` the agent branch loses `prompt` and `promptSource`,
 * matching what `publicTarget()` does everywhere else. The stripped shape is
 * still a valid definition to READ; it is simply not a runnable one, which is
 * exactly why the download route exists and why it is scoped.
 */
export function publicRevisionLoop(loopJson: Record<string, unknown>, includePrompt: boolean): Record<string, unknown> {
  if (includePrompt) return loopJson;
  const target = loopJson.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return loopJson;
  const { prompt: _prompt, promptSource: _promptSource, ...rest } = target as Record<string, unknown>;
  return { ...loopJson, target: rest };
}

/**
 * The manifest as served, with the two fields the SERVER owns rewritten.
 *
 * `version` is allocated by the insert, and the uploaded manifest necessarily
 * carried 0 (the client cannot know its version before asking). `carriesPrompt`
 * is derived from the uploaded `loop.json`, never trusted from the client. The
 * stored blob keeps exactly what was uploaded, for provenance; this is what a
 * reader gets, so a pulled manifest always names the version it actually is.
 */
function servedManifest(revision: LoopRevision): Record<string, unknown> {
  return { ...revision.manifest, version: revision.version, carriesPrompt: revision.carriesPrompt };
}

/**
 * Completeness keys on the KEY, not on the kind.
 *
 * Every placement records a storage key - the local-directory fallback uses the
 * same key scheme as the bucket - so "a key was recorded and the object is not
 * there" is the whole of incompleteness, and a no-bucket install gets the same
 * detection a hosted one does.
 */
function revisionState(revision: LoopRevision, objectPresent: boolean): "complete" | "incomplete" {
  return revision.storageKey && !objectPresent ? "incomplete" : "complete";
}

// ── routes ───────────────────────────────────────────────────────────────────

/**
 * `/v1/loops/{id}/…` bundle sub-routes. Returns `undefined` when the path is
 * not one of ours, so the caller can fall through to its own 404.
 */
export async function handleLoopBundleRequest(
  ctx: BundleRequestContext,
  loopId: string,
  segments: string[],
): Promise<Response | undefined> {
  const method = ctx.request.method;
  if (segments[0] === "versions") {
    if (segments.length === 1 && method === "GET") return listVersions(ctx, loopId);
    if (segments.length === 1 && method === "POST") return createVersion(ctx, loopId);
    if (segments.length === 2 && method === "GET") return getVersion(ctx, loopId, segments[1]!);
    if (segments.length === 3 && segments[2] === "bundle" && method === "GET") {
      return downloadVersion(ctx, loopId, segments[1]!);
    }
    return undefined;
  }
  if (segments.length === 1 && segments[0] === "rollback" && method === "POST") return rollback(ctx, loopId);
  if (segments.length === 1 && segments[0] === "pin" && method === "POST") return pin(ctx, loopId);
  return undefined;
}

/** `GET /v1/bundles` — the tenant-wide index `loops bundle sync` reads. */
export async function handleBundlesIndexRequest(ctx: BundleRequestContext): Promise<Response | undefined> {
  if (ctx.request.method !== "GET") return undefined;
  const storage = requireStorage(ctx.storage);
  const params = ctx.url.searchParams;
  const page = await storage.listLoopBundles({
    machine: params.get("machine")?.trim() || undefined,
    limit: numberParam(params.get("limit")),
    offset: numberParam(params.get("offset")),
  });
  return ok({
    bundles: page.bundles.map((bundle: LoopBundleSummary) => ({ ...bundle })),
    total: page.total,
  });
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function requireLoop(storage: LoopStorageContract, loopId: string) {
  const loop = await storage.getLoop(loopId);
  if (!loop) throw new LoopNotFoundError(loopId);
  return loop;
}

async function listVersions(ctx: BundleRequestContext, loopId: string): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  const loop = await requireLoop(storage, loopId);
  const page = await storage.listLoopRevisions(loopId, {
    limit: numberParam(ctx.url.searchParams.get("limit")),
    offset: numberParam(ctx.url.searchParams.get("offset")),
  });
  const artifacts = artifactsFor(ctx);
  const versions = [];
  for (const revision of page.revisions) {
    const present = revision.storageKey ? await artifacts.objectExists(revision.storageKey) : true;
    versions.push(publicRevision(revision, revisionState(revision, present)));
  }
  const head = page.revisions[0] ?? (await storage.latestLoopRevision(loopId));
  return ok({
    loopId: loop.id,
    bundleName: loop.bundleName ?? null,
    pinnedVersion: loop.bundlePinnedVersion ?? null,
    latestVersion: head?.version ?? null,
    versions,
    total: page.total,
  });
}

/** Resolve `{version}` — an integer, or the literal `latest`. */
async function resolveRevision(storage: LoopStorageContract, loopId: string, raw: string): Promise<LoopRevision> {
  if (raw === "latest") {
    const head = await storage.latestLoopRevision(loopId);
    if (!head) throw new LoopVersionNotFoundError(loopId, "latest");
    return head;
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) throw new LoopVersionNotFoundError(loopId, raw);
  const revision = await storage.getLoopRevision(loopId, version);
  if (!revision) throw new LoopVersionNotFoundError(loopId, version);
  return revision;
}

async function getVersion(ctx: BundleRequestContext, loopId: string, raw: string): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  await requireLoop(storage, loopId);
  const revision = await resolveRevision(storage, loopId, raw);
  const artifacts = artifactsFor(ctx);
  const present = revision.storageKey ? await artifacts.objectExists(revision.storageKey) : true;
  return ok({
    loopId,
    revision: publicRevision(revision, revisionState(revision, present)),
    manifest: servedManifest(revision),
    loop: publicRevisionLoop(revision.loopJson, hasBundleScope(ctx.auth)),
  });
}

interface UploadParts {
  manifest: BundleManifest;
  archive: Uint8Array;
}

/**
 * Read the two-part multipart body.
 *
 * Part discipline is strict — exactly `manifest` and `bundle`, each at most
 * once — because a permissive reader is how a second `bundle` part ends up
 * deciding which bytes were stored while the first decided which digest was
 * checked.
 */
async function readUploadParts(ctx: BundleRequestContext): Promise<UploadParts> {
  const limit = ctx.bundleLimitBytes ?? DEFAULT_BUNDLE_LIMIT_BYTES;
  const declared = Number(ctx.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw bundleError("BUNDLE_TOO_LARGE", `upload is ${declared} bytes, over the ${limit} byte limit`);
  }
  const contentType = ctx.request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw bundleError("BUNDLE_MANIFEST_INVALID", "bundle upload must be multipart/form-data with 'manifest' and 'bundle' parts");
  }
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw bundleError("BUNDLE_MANIFEST_INVALID", "bundle upload body could not be parsed as multipart/form-data");
  }
  const names = [...form.keys()];
  for (const name of names) {
    if (name !== "manifest" && name !== "bundle") throw bundleError("UNEXPECTED_PART", `unexpected multipart field '${name}'`);
    if (form.getAll(name).length > 1) throw bundleError("DUPLICATE_PART", `multipart field '${name}' appears more than once`);
  }
  const manifestPart = form.get("manifest");
  const bundlePart = form.get("bundle");
  if (manifestPart === null || bundlePart === null) throw bundleError("BUNDLE_MANIFEST_INVALID", "bundle upload requires both a 'manifest' and a 'bundle' part");
  const manifestText = typeof manifestPart === "string" ? manifestPart : await manifestPart.text();
  if (manifestText.length > MAX_MANIFEST_BYTES) throw bundleError("BUNDLE_TOO_LARGE", `manifest is over the ${MAX_MANIFEST_BYTES} byte limit`);
  if (typeof bundlePart === "string") throw bundleError("BUNDLE_NOT_A_FILE", "the 'bundle' part must be a file, not a string");
  const archive = ownBytes(new Uint8Array(await bundlePart.arrayBuffer()));
  if (archive.byteLength === 0) throw bundleError("BUNDLE_EMPTY", "the 'bundle' part is empty");
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw bundleError("BUNDLE_TOO_LARGE", `archive is ${archive.byteLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte cap`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw bundleError("BUNDLE_MANIFEST_INVALID", "manifest part is not valid JSON");
  }
  return { manifest: validateBundleManifest(parsed), archive };
}

/**
 * `POST /v1/loops/{id}/versions` — upload a bundle and append a revision.
 *
 * Every validation fails closed, in this order: manifest schema, archive
 * digest, safe unpack, manifest/archive set equality, `loop.json` shape and
 * identity, credential scan. Only then is a version allocated. Nothing is
 * written to the object store before a row exists to point at it.
 */
async function createVersion(ctx: BundleRequestContext, loopId: string): Promise<Response> {
  if (!hasBundleScope(ctx.auth)) {
    throw bundleError("BUNDLE_SCOPE_REQUIRED", `publishing a bundle requires the ${BUNDLE_SCOPE} scope`);
  }
  const storage = requireStorage(ctx.storage);
  const loop = await requireLoop(storage, loopId);
  if (loop.archivedAt) throw new LoopArchivedError(loop.name || loopId);

  const { manifest, archive } = await readUploadParts(ctx);
  if (manifest.archiveSha256 === undefined) {
    throw bundleError("BUNDLE_MANIFEST_INVALID", "an uploaded manifest must declare archiveSha256");
  }
  verifyArchiveSha256(archive, manifest.archiveSha256);
  const entries = unpackBundle(archive);
  verifyBundleAgainstManifest(entries, manifest);

  const loopJsonEntry = entries.find((entry) => entry.path === LOOP_JSON_FILE);
  if (!loopJsonEntry) throw bundleError("LOOP_JSON_INVALID", `the archive does not contain ${LOOP_JSON_FILE}`);
  let definition: LoopBundleDefinition;
  try {
    definition = parseDefinition(JSON.parse(new TextDecoder().decode(loopJsonEntry.bytes)));
  } catch (error) {
    if (error instanceof BundleIntegrityError) throw error;
    throw bundleError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE} is not valid JSON`);
  }
  const adopt = ctx.url.searchParams.get("adopt") === "true";
  if (definition.id !== loopId && !adopt) {
    throw bundleError("BUNDLE_LOOP_MISMATCH", `${LOOP_JSON_FILE}.id is ${definition.id} but this route targets ${loopId}; pass adopt=true to re-home it`);
  }
  // The scan runs server-side too. A client can be an old CLI, a script, or
  // someone's curl; the immutable object is what everyone else will read.
  assertNoCredentials(entries);

  const bundleName = assertBundleName(manifest.name);
  if (loop.bundleName && loop.bundleName !== bundleName) {
    throw bundleError("BUNDLE_NAME_TAKEN", `loop ${loopId} is already bundled as '${loop.bundleName}'`);
  }
  const holder = await storage.findLoopByBundleName(bundleName);
  if (holder && holder.id !== loopId) {
    throw bundleError("BUNDLE_NAME_TAKEN", `bundle name '${bundleName}' already belongs to loop ${holder.id}`);
  }

  // Idempotent re-push: the content digest is framing-independent, so an
  // unchanged tree re-packed anywhere lands on its existing revision instead of
  // allocating a duplicate version.
  const existing = await storage.findLoopRevisionByDigest(loopId, manifest.bundleDigest);
  if (existing) {
    return ok({
      created: false,
      version: existing.version,
      bundleName: existing.bundleName,
      bundleDigest: existing.bundleDigest,
      storageKey: existing.storageKey ?? null,
    });
  }

  const carriesPrompt = definitionCarriesPrompt(definition);
  const artifacts = artifactsFor(ctx);
  const revision = await storage.createLoopRevision(
    {
      loopId,
      bundleName,
      bundleDigest: manifest.bundleDigest,
      archiveSha256: manifest.archiveSha256,
      archiveBytes: archive.byteLength,
      storageKind: artifacts.storageKind,
      // Recorded BEFORE the object exists, and built from the version the
      // insert actually allocated: a crash between here and the put leaves a
      // diagnosable row, never an unreferenced object, and a racing push can
      // never record a key it did not write.
      storageKeyFor: (version) => artifacts.placement(ctx.auth.tenantId, bundleName, version).storageKey,
      manifest: { ...manifest, carriesPrompt },
      loopJson: { ...definition, ...(adopt ? { id: loopId, adoptedFrom: definition.id } : {}) },
      carriesPrompt,
      author: ctx.auth.principalId,
      sourceStation: manifest.source.station,
      sourceAgent: manifest.source.agent,
      reason: manifest.source.reason,
    },
    { now: ctx.now() },
  );

  const placement = await artifacts.putVersion(
    ctx.auth.tenantId,
    bundleName,
    revision.version,
    archive,
    { ...manifest, carriesPrompt, version: revision.version },
  );
  await artifacts.putLatest(ctx.auth.tenantId, bundleName, {
    version: revision.version,
    bundleDigest: manifest.bundleDigest,
    archiveSha256: manifest.archiveSha256,
    updatedAt: ctx.now().toISOString(),
  });

  return ok(
    {
      created: true,
      version: revision.version,
      bundleName,
      bundleDigest: revision.bundleDigest,
      storageKey: placement.storageKey,
      carriesPrompt,
    },
    { status: 201 },
  );
}

/**
 * `GET /v1/loops/{id}/versions/{version}/bundle` — stream the archive.
 *
 * The server reads the object itself and returns the bytes. No presigned URL is
 * ever handed out: a presigned URL is a bearer credential for whoever holds the
 * link, and these bytes can contain an agent prompt.
 */
async function downloadVersion(ctx: BundleRequestContext, loopId: string, raw: string): Promise<Response> {
  if (!hasBundleScope(ctx.auth)) {
    throw bundleError("BUNDLE_SCOPE_REQUIRED", `downloading a bundle requires the ${BUNDLE_SCOPE} scope`);
  }
  const storage = requireStorage(ctx.storage);
  await requireLoop(storage, loopId);
  const revision = await resolveRevision(storage, loopId, raw);
  if (!revision.storageKey) throw bundleError("BUNDLE_OBJECT_MISSING", `revision ${revision.version} has no stored archive`);
  const bytes = await artifactsFor(ctx).readArchive(revision.storageKey);
  if (!bytes) throw bundleError("BUNDLE_OBJECT_MISSING", `revision ${revision.version} is incomplete: its archive object is missing`);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": BUNDLE_ARCHIVE_CONTENT_TYPE,
      "content-length": String(bytes.byteLength),
      "x-loops-bundle-digest": revision.bundleDigest,
      "x-loops-archive-sha256": revision.archiveSha256,
      "x-loops-bundle-version": String(revision.version),
      "content-disposition": `attachment; filename="${revision.bundleName}-${revision.version}.tar.zst"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * `POST /v1/loops/{id}/rollback` — forward-only.
 *
 * The definition from the target revision is applied to the row and a NEW
 * revision is appended with the same digest and storage key. Going back is
 * itself an event in the history, which is what makes "what was this loop on
 * Tuesday?" answerable after a rollback rather than in spite of one.
 */
async function rollback(ctx: BundleRequestContext, loopId: string): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  const loop = await requireLoop(storage, loopId);
  if (loop.archivedAt) throw new LoopArchivedError(loop.name || loopId);
  const body = (await readJson(ctx)) as { version?: unknown; reason?: unknown; dryRun?: unknown };
  const version = Number(body.version);
  if (!Number.isSafeInteger(version) || version < 1) throw bundleError("BUNDLE_VERSION_INVALID", "rollback requires an integer 'version' >= 1");
  const target = await storage.getLoopRevision(loopId, version);
  if (!target) throw new LoopVersionNotFoundError(loopId, version);
  if (target.storageKey) {
    // Presence, not content: a HEAD is enough to refuse a rollback to an
    // incomplete revision, and the archive itself can be a MAX_ARCHIVE_BYTES
    // object.
    const present = await artifactsFor(ctx).objectExists(target.storageKey);
    if (!present) throw bundleError("BUNDLE_OBJECT_MISSING", `revision ${version} is incomplete and cannot be rolled back to`);
  }
  const runningRuns = (await storage.listRuns({ loopId, status: "running", limit: 50 })).length;

  if (body.dryRun === true) {
    return ok({
      applied: false,
      version,
      runningRuns,
      diff: {
        from: publicRevisionLoop((await storage.latestLoopRevision(loopId))?.loopJson ?? {}, hasBundleScope(ctx.auth)),
        to: publicRevisionLoop(target.loopJson, hasBundleScope(ctx.auth)),
      },
    });
  }

  const definition = parseDefinition(target.loopJson);
  await applyDefinitionToLoop(storage, loop, definition, ctx.now());
  const appended = await storage.createLoopRevision(
    {
      loopId,
      bundleName: target.bundleName,
      bundleDigest: target.bundleDigest,
      archiveSha256: target.archiveSha256,
      archiveBytes: target.archiveBytes,
      storageKind: target.storageKind,
      storageKey: target.storageKey,
      manifest: target.manifest,
      loopJson: target.loopJson,
      carriesPrompt: target.carriesPrompt,
      author: ctx.auth.principalId,
      sourceStation: target.sourceStation,
      sourceAgent: target.sourceAgent,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 512) : `rollback to version ${version}`,
      rolledBackFrom: version,
    },
    { now: ctx.now() },
  );
  const updated = await storage.getLoop(loopId);
  return ok({
    applied: true,
    version: appended.version,
    rolledBackFrom: version,
    runningRuns,
    loop: updated ? { id: updated.id, name: updated.name, status: updated.status, bundleName: updated.bundleName ?? null } : null,
  });
}

/**
 * Apply a bundled definition to the live row.
 *
 * `upsertMigrationLoop(…, { replace: true })` rather than `updateLoop`: a
 * rollback has to restore the SCHEDULE and the TARGET, and `updateLoop`'s patch
 * surface deliberately covers only status/labels/limits. This is the same
 * id-preserving row-write path `POST /v1/import` already uses.
 *
 * The runtime columns are carried over from the CURRENT row, never from the
 * bundle: `nextRunAt`, `retryScheduledFor`, `createdAt` and the archive fields
 * belong to the running loop, and taking them from a three-week-old bundle
 * would make the loop instantly due on every station that pulled it.
 *
 * Only `active | paused | stopped` are applied from the bundle. `expired` is a
 * terminal runtime verdict, not a definition, and resurrecting one from an old
 * bundle would restart a loop its own ceiling had already stopped.
 */
async function applyDefinitionToLoop(
  storage: LoopStorageContract,
  current: Loop,
  definition: LoopBundleDefinition,
  now: Date,
): Promise<void> {
  const status = definition.status;
  const applied: Loop = {
    ...current,
    name: typeof definition.name === "string" ? definition.name : current.name,
    description: typeof definition.description === "string" ? definition.description : undefined,
    labels: Array.isArray(definition.labels) ? (definition.labels as string[]) : current.labels,
    status: status === "active" || status === "paused" || status === "stopped" ? status : current.status,
    schedule: definition.schedule as Loop["schedule"],
    target: definition.target as Loop["target"],
    goal: (definition.goal ?? undefined) as Loop["goal"],
    machine: (definition.machine ?? undefined) as Loop["machine"],
    catchUp: (definition.catchUp ?? current.catchUp) as Loop["catchUp"],
    catchUpLimit: typeof definition.catchUpLimit === "number" ? definition.catchUpLimit : current.catchUpLimit,
    overlap: (definition.overlap ?? current.overlap) as Loop["overlap"],
    maxAttempts: typeof definition.maxAttempts === "number" ? definition.maxAttempts : current.maxAttempts,
    retryDelayMs: typeof definition.retryDelayMs === "number" ? definition.retryDelayMs : current.retryDelayMs,
    leaseMs: typeof definition.leaseMs === "number" ? definition.leaseMs : current.leaseMs,
    expiresAt: (definition.expiresAt ?? undefined) as string | undefined,
    expiresAfterRuns: (definition.expiresAfterRuns ?? undefined) as number | undefined,
    updatedAt: now.toISOString(),
  };
  await storage.upsertMigrationLoop(applied, { replace: true });
}

/** `POST /v1/loops/{id}/pin` — `{ version: N }` or `{ version: null }` to follow latest. */
async function pin(ctx: BundleRequestContext, loopId: string): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  await requireLoop(storage, loopId);
  const body = (await readJson(ctx)) as { version?: unknown };
  if (body.version === null) {
    const loop = await storage.setLoopBundlePin(loopId, null, { now: ctx.now() });
    return ok({ pinnedVersion: loop.bundlePinnedVersion ?? null });
  }
  const version = Number(body.version);
  if (!Number.isSafeInteger(version) || version < 1) throw bundleError("BUNDLE_VERSION_INVALID", "pin requires an integer 'version' >= 1, or null to unpin");
  const loop = await storage.setLoopBundlePin(loopId, version, { now: ctx.now() });
  return ok({ pinnedVersion: loop.bundlePinnedVersion ?? null });
}

async function readJson(ctx: BundleRequestContext): Promise<Record<string, unknown>> {
  const text = await ctx.request.text();
  if (text.length > ctx.bodyLimitBytes) throw bundleError("BUNDLE_TOO_LARGE", "request body is over the limit");
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw bundleError("BUNDLE_MANIFEST_INVALID", "request body must be a JSON object");
  }
}
