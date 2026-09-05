import { readFileSync } from "node:fs";
import { credentialDiskSourceList } from "@hasna/contracts/client";

export const SKILLS_BOUND_API_URL = "HASNA_SKILLS_BOUND_API_URL";
type Env = Record<string, string | undefined>;

/** Match the shared resolver's profile syntax before using its path helper. */
export function selectedSkillsProfile(env: Env, explicit?: string): string | null {
  const selected = explicit ?? env.HASNA_PROFILE;
  if (selected === undefined) return null;
  const profile = selected.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(profile)) throw new Error("Invalid Skills credential profile");
  return profile;
}

export function skillsProfileCredentialFiles(env: Env, explicit?: string): string[] {
  return credentialDiskSourceList("skills", env, selectedSkillsProfile(env, explicit)).map(source => source.path);
}

/** Read only known non-secret routing fields, never export an API key or an arbitrary field. */
export function readSkillsInstanceMetadata(file: string): { apiUrl?: string; binding?: string } {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Cannot read Skills instance configuration");
  }
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(HASNA_SKILLS_API_URL|SKILLS_API_URL|HASNA_SKILLS_BOUND_API_URL)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!value || /[\x00-\x20\x7f]/.test(value) || values.has(match[1]!)) throw new Error("Invalid Skills instance configuration");
    values.set(match[1]!, value);
  }
  const urls = [values.get("HASNA_SKILLS_API_URL"), values.get("SKILLS_API_URL")].filter(Boolean);
  if (new Set(urls).size > 1) throw new Error("Skills API URL aliases disagree");
  return { apiUrl: urls[0], binding: values.get(SKILLS_BOUND_API_URL) };
}
