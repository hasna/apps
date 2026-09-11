/**
 * Read-only profile authority for the workspace verbs.
 *
 * `prepareWorkspaceEnrollment` — the flow that minted a workspace key and WROTE
 * it into the named profile's credentials file — was removed in the fail-closed
 * re-cut (owner ruling 2026-09-07 / hasna/apps#1720; fleet credential rule
 * 2026-09-09): this package writes no credential file. What remains only reads
 * the selected profile and proves its key's identity before a fresh-auth
 * mutation.
 */
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, type Stats } from "node:fs";
import { getApiUrl, getIdentityFilePath } from "./auth-store.js";
import { resolveSkillsConnection } from "./fleet-credentials.js";
import { captureSkillsCredentialFiles, selectedSkillsProfile, skillsProfileCredentialFiles } from "./instance-credentials.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { parseWorkspaceIdentity, workspaceExpectedUserId, type RemoteWorkspaceContext, type RemoteWorkspaceIdentity } from "./remote-workspace-selection.js";

type Env = Record<string, string | undefined>;
export class WorkspaceProfileError extends Error {}
const fail = (message: string): never => { throw new WorkspaceProfileError(message); };
function stat(path: string): Stats | null {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function safeText(file: string): string | null {
  if (stat(file) === null) return null;
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 65536 || ![0o400, 0o600].includes(s.mode & 0o7777) || (process.getuid && s.uid !== process.getuid()))
      return fail("The selected profile must use bounded owner-only regular files.");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
function checkIdentityMetadata(file: string, identity: RemoteWorkspaceIdentity): void {
  const text = safeText(file); if (text === null) return;
  let value: Record<string, unknown>;
  try { value = JSON.parse(text); } catch { return fail("The profile identity metadata is invalid. Sign in again before managing this workspace."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("The profile identity metadata is invalid.");
  for (const [key, expected] of Object.entries({ userId: identity.user.id, orgId: identity.organization.id })) {
    if (value[key] !== undefined && value[key] !== expected) return fail("The profile identity metadata does not match its authenticated key. Sign in again before managing this workspace.");
  }
}
async function keyIdentity(key: string, origin: string): Promise<RemoteWorkspaceIdentity> {
  const value = await new RemoteSkillsClient(key, origin).getIdentity();
  if (value.authMethod !== "api_key") return fail("The selected credential is not a workspace API key.");
  const user = value.user as { id?: unknown } | undefined;
  return parseWorkspaceIdentity(value, workspaceExpectedUserId(user?.id));
}

/** Capture actual key authority before OTP; cached identity never supplies authority. */
export function prepareProfileWorkspace(action: string, source: Env = process.env) {
  const env = { ...source }, origin = getApiUrl(action, env), profile = selectedSkillsProfile(env);
  const unchanged = captureSkillsCredentialFiles(skillsProfileCredentialFiles(env));
  return { origin, async resolve() {
    unchanged();
    if (!profile) return { origin, context: undefined, unchanged };
    const connection = await resolveSkillsConnection(env);
    if (!connection || connection.apiOrigin !== origin) return fail("The selected profile has no usable credential for this server.");
    const identity = await keyIdentity(connection.apiKey, origin);
    checkIdentityMetadata(getIdentityFilePath(env), identity);
    unchanged();
    const context: RemoteWorkspaceContext = { userId: identity.user.id, membershipId: identity.user.membershipId };
    return { origin, context, unchanged };
  } };
}
export async function captureProfileWorkspace(action: string, source: Env = process.env) {
  return prepareProfileWorkspace(action, source).resolve();
}
