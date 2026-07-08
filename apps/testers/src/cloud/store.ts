/**
 * @hasna/testers — client storage resolver / facade.
 *
 * Single decision point that makes `mode=self_hosted` real for the testers CLI
 * (and any other client caller). When the client-flip env for the testers app
 * resolves to cloud — i.e. one of
 *
 *   HASNA_TESTERS_STORAGE_MODE=self_hosted   (aliases: cloud/remote/hybrid)
 *   HASNA_TESTERS_API_URL=https://testers.hasna.xyz
 *   HASNA_TESTERS_API_KEY=hasna_testers_...
 *
 * — every read AND write below routes to the app's cloud `/v1` HTTP API with the
 * bearer key. Otherwise it delegates to the on-box SQLite store. There is no DSN
 * on the client and no silent local drift: if cloud is requested but
 * misconfigured, `resolveStorageClient` throws.
 *
 * The functions mirror the `db/*` signatures the CLI already imports, so wiring
 * is an import swap plus `await`.
 */
import { resolveStorageClient, type HasnaStorageClient } from "../generated/storage-client/index.js";
import type {
  CreatePersonaInput,
  CreateProjectInput,
  CreateScenarioInput,
  Persona,
  PersonaFilter,
  Project,
  Scenario,
  ScenarioFilter,
  UpdatePersonaInput,
  UpdateProjectInput,
  UpdateScenarioInput,
} from "../types/index.js";

import * as localPersonas from "../db/personas.js";
import * as localScenarios from "../db/scenarios.js";
import * as localProjects from "../db/projects.js";

export const TESTERS_APP = "testers";

let cached: { transport: "local"; client: null } | { transport: "cloud-http"; client: HasnaStorageClient } | null = null;

/** Resolve (and cache) the client storage transport for the testers app. */
export function resolveTestersStore(): { transport: "local"; client: null } | { transport: "cloud-http"; client: HasnaStorageClient } {
  if (cached) return cached;
  cached = resolveStorageClient(TESTERS_APP, process.env);
  return cached;
}

/** Reset the cached resolution (tests). */
export function resetTestersStore(): void {
  cached = null;
}

/** True when reads/writes should go to the cloud `/v1` API. */
export function isCloud(): boolean {
  return resolveTestersStore().transport === "cloud-http";
}

function cloud(): HasnaStorageClient {
  const r = resolveTestersStore();
  if (r.transport !== "cloud-http") throw new Error("testers: not in cloud mode");
  return r.client;
}

/**
 * Server list routes apply LIMIT/OFFSET in SQL (default 100, hard cap 500) and
 * return neither a total nor a cursor. The facade re-implements the local
 * filter/sort/slice semantics client-side, so it must first pull the WHOLE
 * matching set — not a single server page. Passing the caller's limit/offset to
 * the server and then re-slicing double-paginates (page 2+ returns nothing) and
 * caps counts at the page size. This pages by offset with the server's max page
 * size until a short page is returned, up to a hard safety bound.
 */
const CLOUD_PAGE_SIZE = 500;
const CLOUD_MAX_ROWS = 100_000;
async function fetchAllCloud<T>(resource: string, query: Record<string, string | number | boolean> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < CLOUD_MAX_ROWS; offset += CLOUD_PAGE_SIZE) {
    const page = (await cloud().list<T>(resource, { query: { ...query, limit: CLOUD_PAGE_SIZE, offset } })).items;
    out.push(...page);
    if (page.length < CLOUD_PAGE_SIZE) break;
  }
  return out;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Raised for operations the cloud `/v1` API does not (yet) expose. */
export class CloudUnsupportedError extends Error {
  constructor(op: string) {
    super(
      `testers: '${op}' is not available against the cloud API (HASNA_TESTERS_STORAGE_MODE=self_hosted). ` +
        `Unset HASNA_TESTERS_API_URL/HASNA_TESTERS_API_KEY to use the local store for this operation.`,
    );
    this.name = "CloudUnsupportedError";
  }
}

// ── personas ─────────────────────────────────────────────────────────────────
export async function createPersona(input: CreatePersonaInput): Promise<Persona> {
  if (isCloud()) return cloud().create<Persona>("personas", input);
  return localPersonas.createPersona(input);
}
/** Apply the PersonaFilter semantics client-side over a cloud result set. */
function applyPersonaFilter(items: Persona[], filter?: PersonaFilter): Persona[] {
  let out = items;
  if (filter?.globalOnly) out = out.filter((p) => !p.projectId);
  else if (filter?.projectId) out = out.filter((p) => p.projectId === filter.projectId || !p.projectId);
  if (filter?.enabled !== undefined) out = out.filter((p) => Boolean(p.enabled) === filter.enabled);
  return out;
}

export async function listPersonas(filter?: PersonaFilter): Promise<Persona[]> {
  if (isCloud()) {
    const q: Record<string, string | boolean> = {};
    if (filter?.projectId) q.project_id = filter.projectId;
    if (filter?.globalOnly) q.global = true;
    let items = applyPersonaFilter(await fetchAllCloud<Persona>("personas", q), filter);
    if (filter?.offset) items = items.slice(filter.offset);
    if (filter?.limit) items = items.slice(0, filter.limit);
    return items;
  }
  return localPersonas.listPersonas(filter);
}

export async function countPersonas(filter?: PersonaFilter): Promise<number> {
  if (isCloud()) {
    const q: Record<string, string | boolean> = {};
    if (filter?.projectId) q.project_id = filter.projectId;
    if (filter?.globalOnly) q.global = true;
    return applyPersonaFilter(await fetchAllCloud<Persona>("personas", q), filter).length;
  }
  return localPersonas.countPersonas(filter);
}
export async function getPersona(id: string): Promise<Persona | null> {
  if (isCloud()) {
    const direct = await cloud().get<Persona>("personas", id);
    if (direct) return direct;
    // Allow lookup by shortId too (CLI passes either).
    const items = await fetchAllCloud<Persona>("personas");
    return items.find((p) => p.shortId === id) ?? null;
  }
  return localPersonas.getPersona(id);
}
export async function updatePersona(id: string, updates: UpdatePersonaInput, version: number): Promise<Persona> {
  if (isCloud()) return cloud().update<Persona>("personas", id, { ...updates, version }, { method: "PUT" });
  return localPersonas.updatePersona(id, updates, version);
}
export async function deletePersona(id: string): Promise<boolean> {
  if (isCloud()) {
    await cloud().delete("personas", id);
    return true;
  }
  return localPersonas.deletePersona(id);
}

// ── scenarios ─────────────────────────────────────────────────────────────────
export async function createScenario(input: CreateScenarioInput): Promise<Scenario> {
  if (isCloud()) return cloud().create<Scenario>("scenarios", input);
  return localScenarios.createScenario(input);
}
/** Apply the local ScenarioFilter semantics (filter -> sort -> paginate) to a full set. */
function applyScenarioFilter(all: Scenario[], filter?: ScenarioFilter): Scenario[] {
  let items = all;
  if (filter?.projectId) items = items.filter((s) => s.projectId === filter.projectId);
  if (filter?.tags?.length) items = items.filter((s) => filter.tags!.every((t) => s.tags.includes(t)));
  if (filter?.priority) items = items.filter((s) => s.priority === filter.priority);
  if (filter?.search) {
    const needle = filter.search.toLowerCase();
    items = items.filter((s) => s.name.toLowerCase().includes(needle) || (s.description ?? "").toLowerCase().includes(needle));
  }
  const sort = filter?.sort ?? "date";
  const dir = filter?.desc === false ? 1 : -1;
  items = [...items].sort((a, b) => {
    if (sort === "name") return dir * a.name.localeCompare(b.name);
    if (sort === "priority") {
      const ra = PRIORITY_RANK[a.priority] ?? 4;
      const rb = PRIORITY_RANK[b.priority] ?? 4;
      return dir * (ra - rb);
    }
    return dir * (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  });
  if (filter?.offset) items = items.slice(filter.offset);
  if (filter?.limit) items = items.slice(0, filter.limit);
  return items;
}

export async function listScenarios(filter?: ScenarioFilter): Promise<Scenario[]> {
  if (isCloud()) {
    // Fetch the whole matching set (paged) and apply local filter/sort/paginate
    // client-side. Sending the caller's limit/offset to the server would
    // double-paginate against its SQL LIMIT/OFFSET.
    const q: Record<string, string | number> = {};
    if (filter?.projectId) q.project_id = filter.projectId;
    return applyScenarioFilter(await fetchAllCloud<Scenario>("scenarios", q), filter);
  }
  return localScenarios.listScenarios(filter);
}
export async function countScenarios(filter?: ScenarioFilter): Promise<number> {
  if (isCloud()) {
    // Count all matching rows (ignore pagination) to mirror the local semantics.
    const { limit: _limit, offset: _offset, ...rest } = filter ?? {};
    void _limit;
    void _offset;
    return (await listScenarios(rest as ScenarioFilter)).length;
  }
  return localScenarios.countScenarios(filter);
}
export async function getScenario(id: string): Promise<Scenario | null> {
  if (isCloud()) return cloud().get<Scenario>("scenarios", id);
  return localScenarios.getScenario(id);
}
export async function getScenarioByShortId(shortId: string): Promise<Scenario | null> {
  if (isCloud()) {
    const items = await fetchAllCloud<Scenario>("scenarios");
    return items.find((s) => s.shortId === shortId) ?? null;
  }
  return localScenarios.getScenarioByShortId(shortId);
}
export async function updateScenario(id: string, input: UpdateScenarioInput, version: number): Promise<Scenario> {
  if (isCloud()) return cloud().update<Scenario>("scenarios", id, { ...input, version }, { method: "PUT" });
  return localScenarios.updateScenario(id, input, version);
}
export async function deleteScenario(id: string): Promise<boolean> {
  if (isCloud()) {
    await cloud().delete("scenarios", id);
    return true;
  }
  return localScenarios.deleteScenario(id);
}

// ── projects ──────────────────────────────────────────────────────────────────
export async function createProject(input: CreateProjectInput): Promise<Project> {
  if (isCloud()) return cloud().create<Project>("projects", input);
  return localProjects.createProject(input);
}
export async function listProjects(): Promise<Project[]> {
  if (isCloud()) return (await cloud().list<Project>("projects")).items;
  return localProjects.listProjects();
}
export async function getProject(id: string): Promise<Project | null> {
  if (isCloud()) return cloud().get<Project>("projects", id);
  return localProjects.getProject(id);
}
export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  if (isCloud()) return cloud().update<Project>("projects", id, input, { method: "PUT" });
  return localProjects.updateProject(id, input);
}
export async function ensureProject(name: string, path: string): Promise<Project> {
  if (isCloud()) {
    const all = (await cloud().list<Project>("projects")).items;
    const byPath = path ? all.find((p) => p.path === path) : undefined;
    if (byPath) return byPath;
    const byName = all.find((p) => p.name === name);
    if (byName) return byName;
    return cloud().create<Project>("projects", { name, path } as CreateProjectInput);
  }
  return localProjects.ensureProject(name, path);
}
