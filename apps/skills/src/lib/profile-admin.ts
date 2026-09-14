import { resolveSkillsConnection, skillsApiRequestUrl } from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";
import type { SkillProfile, SkillSelection, StationSkillState } from "../types/skill-selection.js";
import { selectionAliasError, selectionSnapshotsEqual } from "./selection-aliases.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, profileDocumentBytes, requiresProfileCapacity, assertAdvertisedProfileCapacity } from "./profile-limits.js";

function id(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) throw new Error("Invalid Skills profile or station id");
  return encodeURIComponent(value);
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const connection = await resolveSkillsConnection();
  if (!connection) throw new Error("Profile administration requires a configured Skills API");
  const response = await fetch(skillsApiRequestUrl(connection.apiOrigin, `/api/v1${path}`), {
    ...init, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "hasna-skills", "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}`, ...init.headers },
  });
  if (!response.ok) { void response.body?.cancel(); throw new Error(`Skills profile request failed (HTTP ${response.status})`); }
  return JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, MAX_PROFILE_DOCUMENT_BYTES)));
}
export async function readSkillProfile(profileId: string): Promise<SkillProfile> {
  const value = await request(`/profiles/${id(profileId)}`) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || value.selections.length > MAX_PROFILE_SELECTIONS || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  return value;
}
export async function saveSkillProfile(profileId: string, selections: SkillSelection[], revision?: string): Promise<SkillProfile> {
  if (!Array.isArray(selections) || selections.length > MAX_PROFILE_SELECTIONS) throw new Error(`A profile requires at most ${MAX_PROFILE_SELECTIONS} exact selections`);
  id(profileId);
  const aliasError = selectionAliasError(selections);
  if (aliasError) throw new Error(aliasError);
  if (revision !== undefined) id(revision);
  const input = { selections }, bodyBytes = profileDocumentBytes(input);
  if (bodyBytes > MAX_PROFILE_DOCUMENT_BYTES) throw new Error("Profile input exceeds the size limit");
  const large = requiresProfileCapacity(selections, bodyBytes);
  const aliases = selections.some(selection => selection.aliases?.length);
  if (aliases || large) {
    const capabilities = await request("/capabilities") as { selectionAliases?: boolean };
    if (aliases && capabilities?.selectionAliases !== true) throw new Error("This Skills API does not advertise selection aliases. Upgrade the API before saving this profile.");
    if (large) assertAdvertisedProfileCapacity(capabilities, selections.length, bodyBytes);
  }
  const value = await request(`/profiles/${id(profileId)}`, {
    method: "PUT", headers: revision ? { "If-Match": `"${revision}"` } : { "If-None-Match": "*" }, body: JSON.stringify(input),
  }) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  if (selectionAliasError(value.selections) || !selectionSnapshotsEqual(selections, value.selections)) throw new Error("The Skills API did not preserve the complete selections; read the profile before retrying.");
  return value;
}
export async function readStationSkillState(stationId: string): Promise<StationSkillState> {
  const value = await request(`/stations/${id(stationId)}/state`) as StationSkillState;
  if (value.stationId !== stationId || !Array.isArray(value.selections) || value.selections.length > MAX_PROFILE_SELECTIONS) throw new Error("Invalid Skills station response");
  return value;
}
