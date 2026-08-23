export type SkillKind = "executable" | "instruction";

/**
 * Provenance sources for a skill. Kept in sync with VALID_PROVENANCE_SOURCES in
 * skill-validation.ts (plus "extension" for private extension overlays).
 */
export type SkillSource =
  | "official"
  | "custom"
  | "remote"
  | "private"
  | "private-hosted"
  | "upstream"
  | "extension";

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  dependencies?: string[];
  version?: string;
  /**
   * Artifact class of the skill. "executable" skills carry a runnable
   * package.json/bin/src; "instruction" skills are SKILL.md-primary prose for
   * agents. Missing kind defaults to "executable" during migration.
   */
  kind?: SkillKind;
  availability?: SkillAvailabilityMetadata;
  source?: SkillSource;
  /**
   * Execution is server-owned per the published-skill contract: the skill's
   * package.json declares `skills.runtime: "hosted"` or `skills.source:
   * "remote" | "private-hosted"` (see isHostedMetadataPackage in
   * hosted-skill-set.ts). A server-owned skill is submitted to the configured
   * Skills API and never falls back to local execution (see resolveRunRouting
   * in run-routing.ts). Absent means local execution is the contract.
   */
  serverOwned?: boolean;
}

export interface SkillAvailabilityMetadata {
  status: "available" | "unavailable";
  code?: string;
  message?: string;
  details?: string[];
}

export const CATEGORIES = [
  "Development Tools",
  "Business & Marketing",
  "Productivity & Organization",
  "Project Management",
  "Content Generation",
  "Finance & Compliance",
  "Data & Analysis",
  "Media Processing",
  "Design & Branding",
  "Web & Browser",
  "Research & Writing",
  "Science & Academic",
  "Education & Learning",
  "Communication",
  "Health & Wellness",
  "Travel & Lifestyle",
  "Event Management",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Compact "basic" profile: a curated subset of the shipped declarative catalog.
// The OSS catalog is declarative-only (every skill is kind: "instruction"), so
// this list must stay a subset of the shipped instruction skills. To reshape the
// basic profile, add or remove names here — each must be a shipped skill name.
export const BASIC_SKILL_NAMES = [
  "blog-article",
  "ad-creative-pack",
  "email-sequence",
  "seo-content-pack",
  "social-content-calendar",
  "pitch-deck",
  "proposal-pack",
  "market-research-report",
] as const;

export type SkillRegistryProfile = "basic" | "all";
