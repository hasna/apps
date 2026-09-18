import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import type { ConfigStore } from "../data/config-store.js";
import type { Config, ProfileConfigBinding } from "../types/index.js";
import { accountedGlobalSourceSlugs, computeGlobalSourceCoverage } from "./global-source-coverage.js";
import { normalizeProfileConfigBinding, planProfileSessionRender } from "./instruction-graph.js";
import { SESSION_MANAGED_INPUT_MAX_BYTES } from "./project-context.js";
import { applySessionRender, checkSessionRenderDrift, type SessionApplyResult } from "./session-apply.js";
import type { ClaudeOwnedAuthority } from "./session-authority.js";
import {
  SESSION_RENDER_MANIFEST_RELATIVE_PATH,
  SESSION_RENDER_SCHEMA,
  SESSION_RENDER_TOOLS,
  SESSION_RENDERER_OWNER_ID,
  type SessionHostedProfileSelector,
  type SessionRenderManifest,
} from "./session-render.js";
import { stationProfileSource } from "./station-profile.js";
import { normalizeTargetPath } from "./apply.js";

const nonempty = z.string().min(1).max(4096);
const selectorSchema = z.object({
  schema: z.literal("hasna.instructions.hosted-profile-selector/v1"),
  authority: nonempty,
  profileId: nonempty,
  providerVersion: nonempty,
  providerVariant: nonempty.optional(),
  model: nonempty.optional(),
  path: nonempty.optional(),
  manual: z.array(nonempty).max(256),
  codewithNativeImports: z.boolean(),
  allowEmptySources: z.boolean(),
  stationProfile: z.boolean(),
  checkGlobalCoverage: z.boolean(),
  assetSurface: nonempty.optional(),
  assetScope: z.enum(["global", "project", "session"]).optional(),
}).strict();

export interface SessionRefreshResult {
  status: "unchanged" | "updated" | "dry-run" | "blocked";
  checkedAt: string;
  targetHome: string;
  selector: SessionHostedProfileSelector;
  sourceHash: string;
  apply: SessionApplyResult;
}

function authority(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) {
    throw new Error("SESSION_REFRESH_AUTHORITY_INVALID: expected a credential-free Instructions API authority.");
  }
  return url.toString().replace(/\/$/, "");
}

/** Only selector metadata is persisted. Credential values always resolve through
 * the configured application transport on the next invocation. */
export function normalizeSessionHostedProfileSelector(value: unknown): SessionHostedProfileSelector {
  const parsed = selectorSchema.parse(value);
  return { ...parsed, authority: authority(parsed.authority) };
}

/** A successful hosted bindings response must cover the exact membership set.
 * Legacy compiler defaults are for explicit local callers, never a repair for
 * an incomplete remote response that would silently broaden activation. */
export function assertHostedProfileBindings(
  profileId: string,
  configs: readonly Pick<Config, "id">[],
  bindings: readonly (Pick<ProfileConfigBinding, "profile_id" | "config_id"> & { binding?: unknown })[],
): void {
  const configIds = new Set(configs.map((config) => config.id));
  const bindingIds = new Set(bindings.map((binding) => binding.config_id));
  if (configIds.size !== configs.length || bindingIds.size !== bindings.length
    || bindings.some((binding) => binding.profile_id !== profileId || !configIds.has(binding.config_id))
    || [...configIds].some((id) => !bindingIds.has(id))) {
    throw new Error("HOSTED_PROFILE_BINDINGS_INCOMPLETE: exact one-to-one config membership and explicit profile bindings are required; refusing legacy activation fallback.");
  }
  for (const row of bindings) {
    const raw = row.binding;
    const invalid = () => new Error("HOSTED_PROFILE_BINDINGS_INVALID: each hosted binding must contain a complete explicit schema, activation, required flag and fallback; refusing legacy activation defaults.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const record = raw as Record<string, unknown>;
    if (!["schema", "activation", "required", "fallback"].every((key) => Object.hasOwn(record, key))
      || typeof record["required"] !== "boolean") throw invalid();
    try { normalizeProfileConfigBinding(record); } catch { throw invalid(); }
  }
}

function readManagedManifest(targetHome: string): { manifest: SessionRenderManifest; sha256: string } {
  const path = join(targetHome, SESSION_RENDER_MANIFEST_RELATIVE_PATH);
  let ancestor = dirname(path);
  while (true) {
    const stat = lstatSync(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("SESSION_REFRESH_PATH_INVALID: managed target uses a symlink or non-directory ancestor.");
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > SESSION_MANAGED_INPUT_MAX_BYTES) throw new Error("SESSION_REFRESH_MANIFEST_INVALID: expected a bounded regular manifest file.");
    raw = readFileSync(fd);
    if (raw.byteLength > SESSION_MANAGED_INPUT_MAX_BYTES) throw new Error("SESSION_REFRESH_MANIFEST_INVALID: manifest grew beyond the read limit.");
  } finally { closeSync(fd); }
  const manifest = JSON.parse(raw.toString("utf8")) as SessionRenderManifest;
  if (manifest.schema !== SESSION_RENDER_SCHEMA || !SESSION_RENDER_TOOLS.includes(manifest.tool)
    || manifest.targetHome !== targetHome || !manifest.profile?.trim()
    || !["session-home", "project-root"].includes(manifest.targetKind)
    || !Array.isArray(manifest.files) || !manifest.refreshSelector
    || manifest.targetOwner?.writer?.id !== SESSION_RENDERER_OWNER_ID
    || manifest.targetOwner?.targetHome !== targetHome) {
    throw new Error("SESSION_REFRESH_MANIFEST_INVALID: target is not an owned hosted profile render; apply a hosted --compile-profile first.");
  }
  const recordedProjectRoot = manifest.targetOwner.projectRoot;
  if (recordedProjectRoot !== null && recordedProjectRoot !== undefined) {
    if (typeof recordedProjectRoot !== "string" || !isAbsolute(recordedProjectRoot)) {
      throw new Error("SESSION_REFRESH_MANIFEST_INVALID: recorded project root must be an absolute path.");
    }
    const normalizedProjectRoot = resolve(recordedProjectRoot);
    if (normalizedProjectRoot === parse(normalizedProjectRoot).root
      || (manifest.targetKind === "project-root" && normalizedProjectRoot !== targetHome)
      || (manifest.targetKind === "session-home" && manifest.tool !== "opencode")) {
      throw new Error("SESSION_REFRESH_MANIFEST_INVALID: recorded project root does not match the managed target.");
    }
    manifest.targetOwner.projectRoot = normalizedProjectRoot;
  } else if (manifest.targetKind === "project-root") {
    throw new Error("SESSION_REFRESH_MANIFEST_INVALID: project-scoped render is missing its recorded project root.");
  }
  manifest.refreshSelector = normalizeSessionHostedProfileSelector(manifest.refreshSelector);
  return { manifest, sha256: createHash("sha256").update(raw).digest("hex") };
}

/** Fetches all authoritative inputs on every invocation, including unchanged
 * renders. Authentication, authority changes, missing sources, and drift stop
 * refresh before writes; no local source snapshot is a fallback. */
export async function refreshSessionRender(input: {
  targetHome: string;
  store: ConfigStore;
  dryRun?: boolean;
}): Promise<SessionRefreshResult> {
  const { store } = input;
  if (store.mode !== "api" || !store.v1BaseUrl) throw new Error("SESSION_REFRESH_HOSTED_REQUIRED: refresh requires the configured hosted Instructions API.");
  const targetHome = resolve(input.targetHome);
  if (targetHome === parse(targetHome).root) throw new Error("SESSION_REFRESH_PATH_INVALID: filesystem root is not a managed target.");
  const previous = readManagedManifest(targetHome);
  const selector = previous.manifest.refreshSelector!;
  if (authority(store.v1BaseUrl) !== selector.authority) throw new Error("SESSION_REFRESH_AUTHORITY_MISMATCH: configured API differs from the recorded profile authority.");
  const profile = await store.getProfile(selector.profileId);
  if (profile.id !== selector.profileId) throw new Error("SESSION_REFRESH_PROFILE_MISMATCH: hosted profile identity changed.");
  const [configs, bindings, assetBindings] = await Promise.all([
    store.getProfileConfigs(profile.id), store.getProfileConfigBindings(profile.id, { requireExplicit: true }), store.getProfileAssetBindings(profile.id, { requireExplicit: true }),
  ]);
  assertHostedProfileBindings(profile.id, configs, bindings);
  if (configs.length > 2048 || bindings.length > 8192 || assetBindings.length > 1024) throw new Error("SESSION_REFRESH_INPUT_LIMIT: hosted profile exceeds refresh bounds.");
  const totalBytes = configs.reduce((sum, config) => sum + Buffer.byteLength(config.content), 0);
  if (totalBytes > SESSION_MANAGED_INPUT_MAX_BYTES) throw new Error("SESSION_REFRESH_INPUT_LIMIT: hosted instruction payload exceeds refresh byte bounds.");
  const assetConfigs = await Promise.all([...new Set(assetBindings.map((binding) => binding.source_config_id))].map((id) => store.getConfigById(id)));
  if (assetConfigs.reduce((sum, config) => sum + Buffer.byteLength(config.content), totalBytes) > SESSION_MANAGED_INPUT_MAX_BYTES) throw new Error("SESSION_REFRESH_INPUT_LIMIT: hosted source and asset payload exceeds refresh byte bounds.");
  let ownedClaudeAuthorities: ClaudeOwnedAuthority[] | undefined;
  if (previous.manifest.tool === "claude") {
    ownedClaudeAuthorities = (await store.listConfigs({ category: "rules", agent: "claude", kind: "file" }))
      .filter((config) => config.target_path && basename(normalizeTargetPath(config.target_path)) === "AGENTS.md")
      .map((config) => ({ slug: config.slug, targetPath: config.target_path!, content: config.content }));
  }
  const station = selector.stationProfile ? stationProfileSource() : null;
  const plan = planProfileSessionRender({
    tool: previous.manifest.tool,
    profile: previous.manifest.profile,
    profile_id: profile.id,
    provider_version: selector.providerVersion,
    targetHome,
    ...(previous.manifest.targetKind === "project-root"
      ? { projectRoot: targetHome }
      : previous.manifest.targetOwner.projectRoot
        ? { projectRoot: previous.manifest.targetOwner.projectRoot }
        : {}),
    sessionId: previous.manifest.sessionId ?? undefined,
    refreshSelector: selector,
    codewithNativeImports: selector.codewithNativeImports,
    allowEmptySources: selector.allowEmptySources,
    configs, bindings,
    asset_configs: assetConfigs, asset_bindings: assetBindings,
    // The write intent is the same for preview and apply. Including a preview
    // mode in the asset digest falsely changes sourceHash even for zero assets.
    // applySessionRender's dryRun flag controls whether files are written.
    asset_plan_mode: "apply",
    asset_scope: selector.assetScope,
    asset_surface: selector.assetSurface,
    extra_sources: station ? [station] : undefined,
    ownedClaudeAuthorities,
    graph_context: {
      ...(selector.providerVariant ? { provider_variant: selector.providerVariant } : {}),
      ...(selector.model ? { model: selector.model } : {}),
      ...(selector.path ? { path: selector.path } : {}),
      ...(selector.manual.length ? { manual: selector.manual } : {}),
    },
  });
  if (selector.checkGlobalCoverage) {
    const coverage = computeGlobalSourceCoverage(await store.listConfigs({}), accountedGlobalSourceSlugs(plan.manifest));
    if (!coverage.complete) throw new Error(`SESSION_REFRESH_COVERAGE_INCOMPLETE: ${coverage.missingSlugs.length} registered global sources are absent.`);
  }
  const preview = applySessionRender(plan, { dryRun: true, expectedManifestSha256: previous.sha256, ownedClaudeAuthorities });
  const common = { checkedAt: new Date().toISOString(), targetHome, selector, sourceHash: plan.manifest.sourceHash };
  if (preview.conflicts.length) return { ...common, status: "blocked", apply: preview };
  if (!preview.drift.clean) throw new Error("SESSION_REFRESH_DRIFT: generated files changed or disappeared since their last managed render.");
  const sameSources = previous.manifest.sourceHash === plan.manifest.sourceHash;
  const samePayloads = preview.files.filter((file) => file.role !== "manifest").every((file) => file.action === "unchanged");
  if (sameSources && samePayloads) {
    if (readManagedManifest(targetHome).sha256 !== previous.sha256 || !checkSessionRenderDrift(targetHome).clean) throw new Error("SESSION_REFRESH_DRIFT: managed target changed during refresh.");
    return { ...common, status: "unchanged", apply: { ...preview, files: preview.files.map((file) => file.role === "manifest" ? { ...file, action: "unchanged", changed: false, newSha256: previous.sha256, reason: "hosted sources and generated payloads unchanged" } : file) } };
  }
  if (input.dryRun) return { ...common, status: "dry-run", apply: preview };
  const applied = applySessionRender(plan, { expectedManifestSha256: previous.sha256, ownedClaudeAuthorities });
  if (applied.conflicts.length) return { ...common, status: "blocked", apply: applied };
  if (!applied.applied || !checkSessionRenderDrift(targetHome).clean) throw new Error("SESSION_REFRESH_READBACK_FAILED: applied instructions did not verify against their manifest.");
  return { ...common, status: "updated", apply: applied };
}
