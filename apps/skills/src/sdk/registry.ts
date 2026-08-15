/**
 * Registry + version service seam.
 *
 * The registry half wraps the shipped server registry (src/server/registry.ts): the
 * merged catalog, slug resolution, and SKILL.md docs. The version service is the seam
 * for skills_registry versioning — the `version` column a published record carries, and
 * the contract sibling work (hasna.skill.v1, skill-hash) builds on.
 */
import type { SkillMeta } from "../lib/registry-types.js";
import {
  getServerSkill,
  getServerSkillMd,
  isValidSkillSlug,
  listServerSkills,
} from "../server/registry.js";
import type { ServerSkillRecord } from "../server/types.js";

/** The registry an embedder resolves skills against. */
export interface RegistryService {
  list(): SkillMeta[];
  get(slug: string): SkillMeta | null;
  getSkillMd(slug: string): string | null;
  isValidSlug(slug: string): boolean;
}

/** Current implementation: the bundled registry served by the shipped server. */
export const bundledRegistry: RegistryService = {
  list: listServerSkills,
  get: getServerSkill,
  getSkillMd: getServerSkillMd,
  isValidSlug: isValidSkillSlug,
};

/** Resolves the effective version of a published skill record. */
export interface RegistryVersionService {
  resolveVersion(record: Pick<ServerSkillRecord, "version">): string | undefined;
}

/** Current implementation: the version column carried by the published record. */
export const currentVersionService: RegistryVersionService = {
  resolveVersion: (record) => record.version,
};

export { getServerSkill, getServerSkillMd, isValidSkillSlug, listServerSkills };
export type { SkillMeta };
