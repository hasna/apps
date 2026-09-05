/**
 * Remote registry client.
 *
 * Local registry behavior remains the default. These helpers are opt-in: the
 * authority and the credential both come from the shared fleet ladder
 * (lib/fleet-credentials.ts), so a service can expose a compatible registry API
 * without this package hard-coding anything about where it is deployed.
 */

import { z } from "zod";
import { resolveApiUrl } from "./api-url.js";
import { getApiKey } from "./auth-store.js";
import { SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "./fleet-credentials.js";
import { sanitizePublicDiscoveryText } from "./discovery.js";
import { mergeSkillRegistryLists } from "./registry-merge.js";
import type { SkillMeta } from "./registry.js";

const remoteAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable"]),
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.array(z.string()).optional(),
}).passthrough();

const remoteSkillSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  version: z.string().optional(),
  availability: remoteAvailabilitySchema.optional(),
}).passthrough().refine((skill) => skill.name || skill.slug, {
  message: "Remote skill requires name or slug",
});

const secretValuePatterns: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[opsur]_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bnpm_[A-Za-z0-9_]{8,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  new RegExp("\\bsecret" + "-token:\\s*[A-Za-z0-9._-]+", "gi"),
  /\bctx7sk\-[A-Za-z0-9_-]{8,}\b/g,
  /\bxai\-[A-Za-z0-9_-]{8,}\b/g,
];

const remoteSkillDetailSchema = z.union([
  remoteSkillSchema,
  z.object({ skill: remoteSkillSchema }),
  z.object({ data: remoteSkillSchema }),
]);

const remoteRegistrySchema = z.union([
  z.array(remoteSkillSchema),
  z.object({ skills: z.array(remoteSkillSchema) }),
  z.object({ data: z.array(remoteSkillSchema) }),
]);

export interface RemoteRegistryOptions {
  apiUrl?: string;
  endpoint?: string;
  timeoutMs?: number;
  authToken?: string | null;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export function getConfiguredApiUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  // Read paths fail closed: no credential means no remote registry, never a
  // fallback host. Resolution lives in one place so auth/write paths and read
  // paths cannot drift apart again.
  return resolveApiUrl(env);
}

export function buildSkillsApiUrl(apiUrl: string, endpoint = "/skills"): string {
  const url = new URL(apiUrl);
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/skills")) {
    if (cleanEndpoint === "/skills") {
      url.pathname = pathname;
    } else {
      url.pathname = `${pathname.slice(0, -"/skills".length)}${cleanEndpoint}` || cleanEndpoint;
    }
    return url.toString();
  }

  if (pathname.endsWith("/api") || pathname.endsWith("/api/v1")) {
    url.pathname = `${pathname}${cleanEndpoint}`;
    return url.toString();
  }

  url.pathname = `${pathname}/api/v1${cleanEndpoint}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function titleize(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRemoteSkill(skill: z.infer<typeof remoteSkillSchema>): SkillMeta {
  const name = skill.name || skill.slug;
  if (!name) throw new Error("Remote skill requires name or slug");
  return {
    name,
    displayName: skill.displayName || titleize(name),
    description: skill.description || "",
    category: skill.category || "Remote",
    tags: skill.tags || ["remote"],
    dependencies: skill.dependencies,
    ...(skill.version ? { version: skill.version } : {}),
    availability: normalizeRemoteAvailability(skill.availability),
    source: "remote",
  };
}

function normalizeRemoteAvailability(
  availability?: z.infer<typeof remoteAvailabilitySchema>,
): NonNullable<SkillMeta["availability"]> {
  if (!availability) return { status: "available" };
  if (availability.status === "available") return { status: "available" };
  return {
    status: availability.status,
    ...(safeAvailabilityCode(availability.code) ? { code: safeAvailabilityCode(availability.code) } : {}),
    ...(availability.message ? { message: sanitizeAvailabilityText(availability.message) } : {}),
    ...(availability.details ? { details: availability.details.map(sanitizeAvailabilityText).filter(Boolean) } : {}),
  };
}

function safeAvailabilityCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

function sanitizeAvailabilityText(text: string): string {
  return secretValuePatterns.reduce(
    (value, pattern) => value.replace(pattern, "credential"),
    sanitizePublicDiscoveryText(text)
      .replace(/\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|CREDENTIAL)[A-Z0-9_]*\b/g, "credential"),
  )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseRemoteRegistryPayload(payload: unknown): SkillMeta[] {
  const parsed = parseRemoteContract(
    remoteRegistrySchema,
    payload,
    "Remote registry payload did not match the expected skills contract",
  );
  const rawSkills = Array.isArray(parsed) ? parsed : "skills" in parsed ? parsed.skills : parsed.data;

  return rawSkills.map(normalizeRemoteSkill);
}

export function parseRemoteSkillPayload(payload: unknown): SkillMeta {
  const parsed = parseRemoteContract(
    remoteSkillDetailSchema,
    payload,
    "Remote skill payload did not match the expected skills contract",
  );
  const skill = ("skill" in parsed ? parsed.skill : "data" in parsed ? parsed.data : parsed) as z.infer<typeof remoteSkillSchema>;
  return normalizeRemoteSkill(skill);
}

function parseRemoteContract<T>(schema: z.ZodType<T>, payload: unknown, message: string): T {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(message, { cause: error });
    throw error;
  }
}

function remoteRequestHeaders(options: RemoteRegistryOptions): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const token = options.authToken !== undefined ? options.authToken : getApiKey();
  const trimmed = token?.trim();
  if (trimmed) headers.set("Authorization", `Bearer ${trimmed}`);
  return headers;
}

async function fetchRemoteJson(url: string, options: RemoteRegistryOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetchImpl(url, {
      headers: remoteRequestHeaders(options),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote registry request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadRemoteRegistry(options: RemoteRegistryOptions = {}): Promise<SkillMeta[]> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error(`Remote registry requires a Skills credential (${SKILLS_API_KEY_ENV}, the Keychain item, or ~/.hasna/skills/config/credentials) and, for your own instance, ${SKILLS_API_URL_ENV}`);
  }

  const url = buildSkillsApiUrl(apiUrl, options.endpoint);
  return parseRemoteRegistryPayload(await fetchRemoteJson(url, options));
}

/**
 * Merge the authenticated remote registry into a local listing, whenever the
 * install is pointed at a hosted instance.
 *
 * This is the fail-closed (R1) default-read merge: a client configured with an
 * origin sees the folder UNION cloud in the plain `list`/`search` path, while
 * every other install keeps today's exact local behavior.
 *
 *   - Nothing configured (no credential, no authority) -> the local list is
 *     returned unchanged and no request is attempted. An install running on
 *     this machine must stay byte-identical to the pre-merge output.
 *   - An authority configured with NO credential -> this throws, from the
 *     shared ladder. It used to return the local half silently, which is the
 *     false green the 2026-09-04 ruling removes: an operator who pointed this
 *     CLI at an instance and lost the key was shown a healthy local listing.
 *   - Credential (+ authority, else the fleet gateway) -> the remote registry is fetched and merged under
 *     the precedence in registry-merge.ts (custom > extension > private >
 *     private-hosted > remote > upstream > official), remote rows tagged
 *     `source: "remote"`.
 *   - A configured, authenticated read that FAILS (auth rejection, HTTP
 *     error, network failure) throws a clear error rather than silently
 *     returning the local half — a silent partial listing would report
 *     success for a union the caller asked to include.
 *
 * The explicit `--remote` path stays on loadRemoteRegistry(): an explicit
 * request has always been fatal on failure, and that contract is unchanged.
 */
export async function mergeRemoteRegistry(
  local: SkillMeta[],
  options: RemoteRegistryOptions = {},
): Promise<SkillMeta[]> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) return local;
  const token = options.authToken !== undefined ? options.authToken : getApiKey();
  if (!token?.trim()) return local;
  const remote = await loadRemoteRegistry({ ...options, apiUrl, authToken: token });
  return mergeSkillRegistryLists(local, remote);
}

export async function loadRemoteSkill(name: string, options: RemoteRegistryOptions = {}): Promise<SkillMeta> {
  const apiUrl = options.apiUrl || getConfiguredApiUrl();
  if (!apiUrl) {
    throw new Error(`Remote registry requires a Skills credential (${SKILLS_API_KEY_ENV}, the Keychain item, or ~/.hasna/skills/config/credentials) and, for your own instance, ${SKILLS_API_URL_ENV}`);
  }

  const slug = encodeURIComponent(name);
  const url = buildSkillsApiUrl(apiUrl, options.endpoint ?? `/skills/${slug}`);
  return parseRemoteSkillPayload(await fetchRemoteJson(url, options));
}
