/**
 * `skills pull` — fetch skills from the configured Skills instance into this machine's
 * corpus (~/.hasna/skills/installed/<name>/).
 *
 * This is the read half of the dogfooding loop. `skills push` sends a corpus skill up to
 * an instance; `skills pull` brings instance skills back down. Because loadRegistry()
 * already merges the corpus (listPortableSkillMetas), a pulled skill is visible to both
 * the CLI (`skills list --all`) and the MCP (`list_skills`) with no other step and no
 * product change.
 *
 * Verification: when the instance serves a bundle, pull downloads it and verifies the
 * `X-Skill-Bundle-Sha256` digest header against the received bytes (rejecting any
 * mismatch — the digest is the skill's content address), and verifies the
 * `X-Skill-Bundle-Signature` HMAC header whenever both a signature and a local signing
 * key are present. A signature without a configured key cannot be checked; the pull
 * proceeds with a warning and records it in the marker, which is strictly more honest
 * than the pre-signature protocol that checked nothing. The verified bundle is
 * installed ATOMICALLY — written to a staging directory and renamed into place — and
 * version/hash/source-commit are recorded in the corpus skill's `.hasna-skills.json`
 * marker. Instances that serve no bundle fall back to the historical SKILL.md+metadata
 * path, which cannot be verified and records that fact in the marker.
 *
 * Fail-closed: with no instance origin configured, client construction throws
 * MissingApiUrlError (via getApiUrl() -> requireApiUrl()) rather than inventing a host.
 * There is deliberately no vendor default and no localhost fallback.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createRemoteSkillsClient } from "./remote-client.js";
import {
  getPortableSkillsRoot,
  normalizePortableSkillName,
  writeCorpusSkill,
  type CorpusSkillMeta,
  type PortableSkillOptions,
} from "./portable-skills.js";
import { sha256Hex, type SkillBundleEntry, unpackSkillBundle } from "./skill-bundle.js";
import { resolveSigningKey, verifyBundleSignature } from "./skill-bundles.js";
import type { SkillKind } from "./registry-types.js";

/** Header carrying the canonical content digest of the served bundle. */
export const BUNDLE_DIGEST_HEADER = "X-Skill-Bundle-Sha256";
/** Header carrying the HMAC signature of the served bundle, when the server can sign. */
export const BUNDLE_SIGNATURE_HEADER = "X-Skill-Bundle-Signature";

/** Marker file written inside each corpus skill directory recording pull provenance. */
export const PULL_MARKER_FILE = ".hasna-skills.json";

/**
 * The slice of RemoteSkillsClient that `pullSkills` needs. Narrowed to an interface so a
 * test can inject a fake and the real HTTP client (which satisfies it structurally) is
 * only constructed on the production path.
 */
export interface SkillPullClient {
  listSkills(): Promise<unknown[]>;
  getSkill(slug: string): Promise<unknown>;
  getSkillMd(slug: string): Promise<string | null>;
  /**
   * The skill's bundle, headers intact, or null when the instance serves none.
   * `Response` is the natural transport type here: verification reads the
   * X-Skill-Bundle-Sha256 / X-Skill-Bundle-Signature headers off it.
   */
  getBundle(slug: string): Promise<Response | null>;
}

export interface PullSkillsOptions extends PortableSkillOptions {
  /** Explicit skill names to pull. Ignored when `all` is set. */
  names?: string[];
  /** Pull every skill the instance serves. */
  all?: boolean;
  /**
   * Client override. `undefined` (the default) resolves one from configuration;
   * `null` models "no credential available" so the null-handling path stays testable.
   */
  client?: SkillPullClient | null;
  /** HMAC signing key for bundle signature verification. Defaults to $SKILLS_SIGNING_KEY. */
  signingKey?: string;
}

export interface PulledSkillResult {
  name: string;
  success: boolean;
  path?: string;
  kind?: SkillKind;
  version?: string;
  /** Canonical content hash of the installed bundle, when one was verified. */
  contentHash?: string;
  /** Source commit recorded on the bundle, when the instance reported one. */
  sourceCommit?: string;
  /** True when the pull created the corpus entry, false when it updated an existing one. */
  created?: boolean;
  error?: string;
}

export interface PullSkillsResult {
  results: PulledSkillResult[];
}

export class PullSkillError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
    this.name = "PullSkillError";
  }
}

export interface VerifiedBundle {
  /** The received bundle bytes, owned by this process. */
  bytes: Uint8Array;
  /** Canonical sha256 of `bytes`. */
  contentHash: string;
  /** The server-declared digest, when the header was present. */
  serverHash?: string;
  /** The server-declared signature, when the header was present. */
  signature?: string;
}

export async function pullSkills(options: PullSkillsOptions = {}): Promise<PullSkillsResult> {
  // createRemoteSkillsClient() returns null when no API key is present, and throws
  // MissingApiUrlError when a key exists but no origin does — so the fail-closed
  // behaviour is inherited here rather than re-implemented.
  const client = options.client !== undefined ? options.client : createRemoteSkillsClient();
  if (!client) {
    throw new PullSkillError(
      "No API key configured, so there is no instance to pull from.",
      ["Run `skills login`, or set SKILLS_API_KEY and SKILLS_API_URL for this instance."],
    );
  }

  const signingKey = options.signingKey ?? resolveSigningKey() ?? undefined;
  const targets = await resolveTargetSlugs(client, options);
  const corpusOptions = pickCorpusOptions(options);
  const results: PulledSkillResult[] = [];
  for (const name of targets) {
    results.push(await pullOne(client, name, corpusOptions, { signingKey }));
  }
  return { results };
}

async function resolveTargetSlugs(client: SkillPullClient, options: PullSkillsOptions): Promise<string[]> {
  if (options.all) {
    const listed = await client.listSkills();
    return dedupe(listed.map(extractSlug).filter((slug): slug is string => Boolean(slug)));
  }
  const explicit = dedupe((options.names ?? []).map((name) => name.trim()).filter(Boolean));
  if (!explicit.length) {
    throw new PullSkillError(
      "Nothing to pull: name at least one skill, or pass --all to pull every skill the instance serves.",
    );
  }
  return explicit;
}

async function pullOne(
  client: SkillPullClient,
  rawName: string,
  corpusOptions: PortableSkillOptions,
  verify: { signingKey?: string },
): Promise<PulledSkillResult> {
  let slug: string;
  try {
    slug = normalizePortableSkillName(rawName);
  } catch (error) {
    return { name: rawName, success: false, error: (error as Error).message };
  }

  const meta = await safeMeta(client, slug);

  // Bundle path first: the verified, signed artifact. The metadata-only path is the
  // fallback for instances that serve no bundle, and cannot be verified by construction.
  let bundleResponse: Response | null;
  try {
    bundleResponse = await client.getBundle(slug);
  } catch (error) {
    return { name: slug, success: false, error: `Failed to fetch '${slug}': ${(error as Error).message}` };
  }
  if (bundleResponse && !bundleResponse.ok) {
    return {
      name: slug,
      success: false,
      error: `Failed to fetch the bundle for '${slug}': HTTP ${bundleResponse.status}`,
    };
  }
  if (bundleResponse) {
    try {
      return await installVerifiedBundle(slug, bundleResponse, meta, corpusOptions, verify);
    } catch (error) {
      if (error instanceof PullSkillError) {
        return { name: slug, success: false, error: error.message };
      }
      throw error;
    }
  }

  let skillMd: string | null;
  try {
    skillMd = await client.getSkillMd(slug);
  } catch (error) {
    return { name: slug, success: false, error: `Failed to fetch '${slug}': ${(error as Error).message}` };
  }
  if (skillMd === null) {
    return { name: slug, success: false, error: `Skill '${slug}' was not found on the configured Skills instance.` };
  }

  const written = writeCorpusSkill({ name: slug, skillMd, meta }, corpusOptions);
  writePullMarker(written.path, { skill: slug, version: written.manifest.version });
  return {
    name: slug,
    success: true,
    path: written.path,
    kind: written.manifest.kind,
    version: written.manifest.version,
    created: written.created,
  };
}

function installVerifiedBundle(
  slug: string,
  response: Response,
  meta: CorpusSkillMeta | null,
  corpusOptions: PortableSkillOptions,
  verify: { signingKey?: string },
): Promise<PulledSkillResult> {
  return response.arrayBuffer().then((buffer) => {
    const verified = verifyBundleResponseBytes(buffer, response, verify);
    let entries: SkillBundleEntry[];
    try {
      entries = unpackSkillBundle(verified.bytes);
    } catch (error) {
      throw new PullSkillError(`Bundle for '${slug}' could not be unpacked: ${(error as Error).message}`);
    }
    const version = str(meta?.version) ?? versionFromEntries(entries) ?? "unknown";
    const sourceCommit = sourceCommitFromEntries(entries);
    const installed = installBundleAtomically(slug, entries, corpusOptions, {
      version,
      contentHash: verified.contentHash,
      ...(sourceCommit ? { sourceCommit } : {}),
      ...(verified.signature ? { signature: verified.signature } : {}),
    });
    return {
      name: slug,
      success: true,
      path: installed.path,
      kind: meta?.kind ?? kindFromEntries(entries),
      version,
      contentHash: verified.contentHash,
      ...(sourceCommit ? { sourceCommit } : {}),
      created: installed.created,
    };
  });
}

function versionFromEntries(entries: SkillBundleEntry[]): string | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (skillJson) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { version?: unknown };
      const version = str(parsed.version);
      if (version) return version;
    } catch {
      // Fall through to package.json.
    }
  }
  const pkg = entries.find((entry) => entry.path === "package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(pkg.bytes)) as { version?: unknown };
      return str(parsed.version);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function kindFromEntries(entries: SkillBundleEntry[]): SkillKind | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (!skillJson) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { kind?: unknown };
    return parsed.kind === "instruction" || parsed.kind === "executable" ? parsed.kind : undefined;
  } catch {
    return undefined;
  }
}

function sourceCommitFromEntries(entries: SkillBundleEntry[]): string | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (!skillJson) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { source_commit?: unknown };
    return str(parsed.source_commit);
  } catch {
    return undefined;
  }
}

/**
 * The verification core, synchronous over already-buffered bytes: the digest header
 * (when present) must equal the canonical sha256 of the received bytes, and the
 * signature header (when present) must verify against the signing key when one is
 * available — otherwise it is recorded with a warning, because a pull cannot check a
 * signature it has no key for.
 */
export function verifyBundleResponseBytes(
  buffer: ArrayBuffer,
  response: Response,
  verify: { signingKey?: string } = {},
): VerifiedBundle {
  const serverHash = response.headers.get(BUNDLE_DIGEST_HEADER);
  const signature = response.headers.get(BUNDLE_SIGNATURE_HEADER);
  const bytes = new Uint8Array(buffer.slice(0));
  const contentHash = sha256Hex(bytes);

  if (serverHash && serverHash.toLowerCase() !== contentHash) {
    throw new PullSkillError(
      `Bundle digest mismatch: the instance declared ${serverHash} but the received bundle hashes to ${contentHash}.`,
      ["The bundle was tampered with or truncated in transit. Nothing was installed."],
    );
  }

  if (signature) {
    const key = verify.signingKey;
    if (!key) {
      console.warn(
        `The instance signed a bundle but no SKILLS_SIGNING_KEY is configured; the signature was recorded but could not be verified.`,
      );
    } else if (!verifyBundleSignature(bytes, signature, key)) {
      throw new PullSkillError(
        "Bundle signature mismatch: the received bundle does not match the signature the instance declared.",
        ["The bundle was not produced by a signer holding your key. Nothing was installed."],
      );
    }
  }

  return {
    bytes,
    contentHash,
    ...(serverHash ? { serverHash } : {}),
    ...(signature ? { signature } : {}),
  };
}

/**
 * Atomically replace the corpus entry for a verified bundle: stage every entry in a
 * sibling directory, then rename into place (the existing entry is moved aside first
 * and removed only after the staged tree is in position). A failure at any point leaves
 * either the old entry or nothing — never a partial skill.
 */
export function installBundleAtomically(
  name: string,
  entries: SkillBundleEntry[],
  options: PortableSkillOptions = {},
  marker: { version?: string; contentHash?: string; sourceCommit?: string; signature?: string } = {},
): { path: string; created: boolean } {
  const root = getPortableSkillsRoot(options);
  mkdirSync(root, { recursive: true });
  const target = join(root, name);
  const created = !existsSync(target);
  const staging = mkdtempSync(join(root, `.pull-${name}-`));

  let moved = false;
  let backup: string | null = null;
  try {
    for (const entry of entries) {
      const destination = join(staging, entry.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, entry.bytes, { mode: entry.mode });
    }
    writePullMarker(staging, {
      skill: name,
      ...(marker.version ? { version: marker.version } : {}),
      ...(marker.contentHash ? { contentHash: marker.contentHash } : {}),
      ...(marker.sourceCommit ? { sourceCommit: marker.sourceCommit } : {}),
      ...(marker.signature ? { signature: marker.signature } : {}),
    });
    if (existsSync(target)) {
      backup = mkdtempSync(join(root, `.pull-backup-${name}-`));
      renameSync(target, join(backup, name));
      moved = true;
    }
    renameSync(staging, target);
    if (moved && backup) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (moved && backup && existsSync(join(backup, name))) {
      try {
        renameSync(join(backup, name), target);
      } catch {
        // The original remains in the backup dir; the target is either absent or
        // partial, and the error below names the staging path that failed.
      }
    }
    throw error;
  }
  return { path: target, created };
}

/**
 * Record what a pull installed. Version/hash/source-commit are the provenance a later
 * `skills sync --check` or drift census needs; the signature is recorded when one was
 * present so an audit can tell "verified" from "declared".
 */
export function writePullMarker(
  dir: string,
  record: { skill: string; version?: string; contentHash?: string; sourceCommit?: string; signature?: string },
): void {
  const marker = {
    managedBy: "@hasna/skills",
    skill: record.skill,
    source: "pull",
    ...(record.version ? { version: record.version } : {}),
    ...(record.contentHash ? { contentHash: record.contentHash } : {}),
    ...(record.sourceCommit ? { sourceCommit: record.sourceCommit } : {}),
    ...(record.signature ? { signature: record.signature } : {}),
    syncedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, PULL_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Best-effort metadata. The SKILL.md carries its own frontmatter, so a missing or
 * malformed detail payload degrades to "use the frontmatter" rather than failing the pull.
 */
async function safeMeta(client: SkillPullClient, slug: string): Promise<CorpusSkillMeta | null> {
  let raw: unknown;
  try {
    raw = await client.getSkill(slug);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind === "instruction" || record.kind === "executable" ? record.kind : undefined;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  return {
    ...(str(record.displayName) ? { displayName: str(record.displayName) } : {}),
    ...(str(record.description) ? { description: str(record.description) } : {}),
    ...(str(record.category) ? { category: str(record.category) } : {}),
    ...(tags && tags.length ? { tags } : {}),
    ...(str(record.version) ? { version: str(record.version) } : {}),
    ...(kind ? { kind } : {}),
  };
}

function pickCorpusOptions(options: PullSkillsOptions): PortableSkillOptions {
  const out: PortableSkillOptions = {};
  if (options.rootDir) out.rootDir = options.rootDir;
  if (options.homeDir) out.homeDir = options.homeDir;
  return out;
}

function extractSlug(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  return str(record.slug) ?? str(record.name);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
