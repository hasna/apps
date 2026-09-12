import { resolveSkillsConnection, skillsApiRequestUrl } from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";
import type { SkillProfile, SkillSelection, StationSkillState } from "../types/skill-selection.js";

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
  return JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, 1024 * 1024)));
}
export async function readSkillProfile(profileId: string): Promise<SkillProfile> {
  const value = await request(`/profiles/${id(profileId)}`) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  return value;
}
export async function saveSkillProfile(profileId: string, selections: SkillSelection[], revision?: string): Promise<SkillProfile> {
  if (!Array.isArray(selections) || selections.length > 256) throw new Error("A profile requires at most 256 exact selections");
  if (revision !== undefined) id(revision);
  const value = await request(`/profiles/${id(profileId)}`, {
    method: "PUT", headers: revision ? { "If-Match": `"${revision}"` } : { "If-None-Match": "*" }, body: JSON.stringify({ selections }),
  }) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  return value;
}
export async function readStationSkillState(stationId: string): Promise<StationSkillState> {
  const value = await request(`/stations/${id(stationId)}/state`) as StationSkillState;
  if (value.stationId !== stationId || !Array.isArray(value.selections)) throw new Error("Invalid Skills station response");
  return value;
}
