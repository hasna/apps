/**
 * Skills ↔ estate-store sync adapter.
 *
 * The shared `@hasna/estate-sync` engine pushes/pulls named artifacts against an
 * estate store bucket, parameterized by (estate bucket, app prefix). This module
 * is the skills side of that contract: it resolves the skills configuration
 * (`HASNA_SKILLS_S3_BUCKET` + `HASNA_SKILLS_S3_PREFIX`, base prefix `skills/`)
 * and maps a skill bundle onto the engine — push packs the skill directory (the
 * deterministic content address from `packSkillBundle`) and the engine writes
 * `skills/bundles/<digest>` plus the signed `skills/index/<name>.json` pointer;
 * pull resolves the signed index, fetches by digest, verifies sha256, and
 * hydrates atomically.
 *
 * The bundle content address is shared with the existing `skills push`/`pull`
 * HTTP path, so a bundle pushed through either route is byte-comparable with the
 * other (canonical gzip).
 */
import { createEstateSync, type EstateSyncClient, type PullArtifactOptions, type PushArtifactResult } from "@hasna/estate-sync";
import { resolveSigningKey } from "./skill-bundles.js";
import { packSkillBundle } from "./skill-bundle.js";

/** The estate prefix tenant for skills. Matches the verdict's `<app>` prefix. */
export const SKILLS_ESTATE_PREFIX = "skills" as const;

export interface SkillsEstateSyncConfig {
  bucket: string;
  prefix: string;
  signingKey?: string;
}

/**
 * Resolve the skills estate-sync configuration from the environment.
 *
 * `HASNA_SKILLS_S3_BUCKET` is required (there is no vendor default — a sync with
 * nowhere to go must fail loudly, never silently fall back to a local file).
 * `HASNA_SKILLS_S3_PREFIX` defaults to the skills base prefix `skills/`. The
 * signing key is the skills bundle signing key when set.
 */
export function resolveSkillsEstateSyncConfig(
  env: Record<string, string | undefined> = process.env,
): SkillsEstateSyncConfig {
  const bucket = clean(env.HASNA_SKILLS_S3_BUCKET);
  if (!bucket) {
    throw new Error("HASNA_SKILLS_S3_BUCKET is required for estate-sync");
  }
  const prefix = clean(env.HASNA_SKILLS_S3_PREFIX) ?? SKILLS_ESTATE_PREFIX;
  const signingKey = resolveSigningKey(env) ?? undefined;
  return {
    bucket,
    prefix,
    ...(signingKey ? { signingKey } : {}),
  };
}

export function createSkillsEstateSync(options: {
  config?: SkillsEstateSyncConfig;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} = {}): EstateSyncClient {
  const config = options.config ?? resolveSkillsEstateSyncConfig();
  return createEstateSync({
    bucket: config.bucket,
    prefix: config.prefix,
    ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * Push a skill directory's bundle to the estate store. The bundle is packed with
 * the canonical content address; the engine writes the digest bundle and the
 * signed index pointer.
 */
export async function pushSkillBundleToEstate(
  skillName: string,
  dir: string,
  options: { client?: EstateSyncClient } = {},
): Promise<PushArtifactResult> {
  const client = options.client ?? createSkillsEstateSync();
  const packed = packSkillBundle(dir);
  return client.push({
    name: skillName,
    body: packed.bytes,
    contentType: "application/gzip",
  });
}

/**
 * Pull a skill bundle from the estate store and hydrate it atomically to
 * `hydrateTo`. Verifies the index signature when a signing key is configured and
 * always verifies sha256 of the fetched bundle against the digest.
 */
export async function pullSkillBundleFromEstate(
  skillName: string,
  options: Omit<PullArtifactOptions, "name"> & { client?: EstateSyncClient } = {},
) {
  const client = options.client ?? createSkillsEstateSync();
  const { client: _client, ...pullOptions } = options;
  return client.pull({ name: skillName, ...pullOptions });
}

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}
