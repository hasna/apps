/**
 * Seed the hosted registry from the bundled corpus (hasna/apps#1630).
 *
 * Until now every catalog entry an instance served was `source: bundled`:
 * read from the package's static skill directory on each request, never published, so no
 * bundle ever reached S3 and `skills versions` had nothing to list. This turns the static
 * corpus into ordinary published skills once per package version: each bundled skill that
 * has no version row for the running package version is packed exactly like `skills push`
 * does, stored (content-addressed + version-addressed), and recorded as slug@<pkg version>.
 *
 * The corpus is seeded verbatim: bundled skills are SKILL.md-first instruction skills, most
 * without a portable skill.json, and the package already ships them as they are - the seed
 * makes them addressable by version, it does not re-certify them.
 *
 * Idempotent and non-fatal: re-running skips what exists; one bad skill is logged and
 * skipped, never a boot failure. Runs under the bootstrap principal (the org the bootstrap
 * API key belongs to), which is the org station keys are minted for.
 */
import { existsSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };
import { getSkillPath } from "../lib/installer.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { readPortableSkillManifest } from "../lib/portable-skills.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactStorage } from "./artifact-storage.js";
import { listServerSkills } from "./registry.js";
import { storePublishedSkill } from "./skills-api.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

export interface SeedBundledCorpusOptions {
  store: SkillsProductStore;
  artifactStorage: ArtifactStorage;
  principal: ApiPrincipal;
  /** Version recorded for every seeded skill. Defaults to the package version. */
  version?: string;
  log?: (line: string) => void;
}

export interface SeedBundledCorpusResult {
  version: string;
  seeded: string[];
  skipped: string[];
  failed: Array<{ slug: string; error: string }>;
}

export async function seedBundledCorpus(options: SeedBundledCorpusOptions): Promise<SeedBundledCorpusResult> {
  const version = options.version ?? pkg.version;
  const log = options.log ?? (() => {});
  const result: SeedBundledCorpusResult = { version, seeded: [], skipped: [], failed: [] };
  for (const skill of listServerSkills()) {
    const slug = skill.name;
    try {
      if (await options.store.getSkillVersion(options.principal, slug, version)) {
        result.skipped.push(slug);
        continue;
      }
      const dir = getSkillPath(slug);
      if (!existsSync(dir)) {
        result.skipped.push(slug);
        continue;
      }
      const manifest = readPortableSkillManifest(dir, slug);
      const packed = packSkillBundle(dir, { maxUnpackedBytes: 50_000_000 });
      const skillMdPath = join(dir, "SKILL.md");
      const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : undefined;
      const current = await options.store.getSkill(options.principal, slug);
      const record = await storePublishedSkill(
        options.store,
        options.artifactStorage,
        options.principal,
        {
          input: {
            slug,
            displayName: manifest.displayName ?? skill.displayName ?? slug,
            description: manifest.description ?? skill.description ?? slug,
            category: manifest.category ?? skill.category ?? "Development Tools",
            tags: manifest.tags ?? skill.tags ?? [],
            source: "bundled",
            kind: manifest.kind ?? "instruction",
            version,
            ...(skillMd ? { skillMd } : {}),
            bundle: { sha256: packed.sha256, byteSize: packed.bytes.byteLength, contentType: "application/gzip", storageKind: "db" },
            versionManifest: {
              files: packed.paths,
              fileCount: packed.fileCount,
              unpackedByteSize: packed.unpackedByteSize,
              bundleSha256: packed.sha256,
              provenance: { seededFrom: "bundled-corpus", packageVersion: pkg.version },
            },
          },
          bundleBytes: packed.bytes,
        },
        current?.revisionId,
      );
      result.seeded.push(`${record.slug}@${version}`);
    } catch (error) {
      result.failed.push({ slug, error: (error as Error).message });
    }
  }
  log(`skills: bundled corpus seed v${version}: ${result.seeded.length} seeded, ${result.skipped.length} skipped, ${result.failed.length} failed`);
  for (const failure of result.failed) log(`skills: seed failed for ${failure.slug}: ${failure.error}`);
  return result;
}
