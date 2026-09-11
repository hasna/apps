/**
 * TEST-ONLY writer for the station credential shape.
 *
 * The package itself writes no credential file any more (fail-closed re-cut,
 * owner ruling 2026-09-07 / hasna/apps#1720; fleet credential rule 2026-09-09):
 * a test that needs a provisioned station simulates the operator's provisioning
 * step with this helper instead. The `*test-utils` name keeps it out of the
 * runtime classification and the published declarations.
 */
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultFleetGatewayBaseUrl } from "@hasna/contracts/client";
import { getAuthFilePath, getIdentityFilePath, type AuthIdentity } from "./auth-store.js";
import { normalizeSkillsApiOrigin, SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "./fleet-credentials.js";
import { SKILLS_BOUND_API_URL } from "./instance-credentials.js";

type Env = Record<string, string | undefined>;

export interface CredentialFixture {
  apiKey: string;
  /** Instance origin, written as the URL and the instance binding. Omit for the gateway default. */
  apiUrl?: string;
  /** Display identity written beside the credential as identity.json (never the key). */
  identity?: AuthIdentity;
  /** Raw lines written first and preserved verbatim (comments, unrelated variables). */
  extraLines?: string[];
}

/** Write the credentials file (and identity.json when an identity is given) at mode 0600. Returns the credentials path. */
export function writeSkillsCredentialFixture(env: Env, fixture: CredentialFixture): string {
  const file = getAuthFilePath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lines = [...(fixture.extraLines ?? []), `${SKILLS_API_KEY_ENV}=${fixture.apiKey}`];
  const origin = fixture.apiUrl ? normalizeSkillsApiOrigin(fixture.apiUrl) : null;
  if (origin) lines.push(`${SKILLS_API_URL_ENV}=${origin}`, `${SKILLS_BOUND_API_URL}=${origin}`);
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);

  const identityFile = getIdentityFilePath(env);
  if (fixture.identity && Object.keys(fixture.identity).length > 0) {
    const apiUrl = origin ?? defaultFleetGatewayBaseUrl("skills");
    writeFileSync(identityFile, JSON.stringify({ ...fixture.identity, apiUrl }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(identityFile, 0o600);
  } else {
    try { unlinkSync(identityFile); } catch {}
  }
  return file;
}
