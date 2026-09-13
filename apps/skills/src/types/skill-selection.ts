/** Published selections are immutable references; credentials never define ownership. */
export interface SkillSelection {
  slug: string;
  version: string;
  bundleDigest: string;
  triggers?: { keywords?: string[]; paths?: string[]; always?: boolean };
}
export interface SkillProfile {
  id: string;
  workspaceId: string;
  revision: string;
  selections: SkillSelection[];
  updatedAt: string;
}
export interface ResolvedSkillSelection extends SkillSelection {
  authority: string;
  workspaceId: string;
  profileRevision: string;
}
export interface ResolvedSkillProfile {
  profileId: string;
  workspaceId: string;
  profileRevision: string;
  authority: string;
  selections: ResolvedSkillSelection[];
}
export interface StationSkillStateInput {
  profileId: string;
  profileRevision: string;
  selections: SkillSelection[];
}
export interface StationSkillState extends StationSkillStateInput {
  stationId: string;
  workspaceId: string;
  actorId: string;
  appliedAt: string;
}
