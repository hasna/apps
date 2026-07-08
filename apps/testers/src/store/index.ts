/**
 * @hasna/testers — the single client Store abstraction.
 *
 * THE storage boundary for every client caller (CLI, MCP, SDK, runner). There is
 * exactly ONE {@link Store} interface with two transports behind it:
 *
 *   - {@link LocalStore}  — on-box SQLite (delegates to `db/*`). First-class.
 *   - {@link ApiStore}    — the app's cloud `/v1` HTTP API + bearer key.
 *
 * The transport is resolved ONCE, from the environment, by {@link getStore}
 * (cached). `self_hosted` and `cloud` both resolve to {@link ApiStore} (identical
 * client code — only the URL/key differ; tenancy is a server concern). Everything
 * else resolves to {@link LocalStore}. There is NO per-call `if (isCloud())`
 * branch, NO DSN on the client, and NO raw `fetch`/`bun:sqlite` in command code:
 * callers only ever touch `getStore()`.
 *
 * If cloud is requested but misconfigured, {@link getStore} throws (via the
 * resolver) so a caller can never silently read/write the wrong dataset.
 */
import { resolveStorageClient, type HasnaStorageClient } from "../generated/storage-client/index.js";

import * as dbScenarios from "../db/scenarios.js";
import * as dbProjects from "../db/projects.js";
import * as dbPersonas from "../db/personas.js";
import * as dbRuns from "../db/runs.js";
import * as dbResults from "../db/results.js";
import * as dbScreenshots from "../db/screenshots.js";
import * as dbStepResults from "../db/step-results.js";
import * as dbApiChecks from "../db/api-checks.js";
import * as dbSchedules from "../db/schedules.js";
import * as dbAuthPresets from "../db/auth-presets.js";
import * as dbFlows from "../db/flows.js";
import * as dbWorkflows from "../db/workflows.js";
import * as dbEnvironments from "../db/environments.js";
import * as dbSessions from "../db/sessions.js";
import * as dbAgents from "../db/agents.js";
import * as dbScanIssues from "../db/scan-issues.js";

import type {
  ApiCheck,
  ApiCheckResult,
  Flow,
  PersistedScanIssue,
  Persona,
  Project,
  Result,
  Run,
  Scenario,
  Schedule,
  Screenshot,
  TestingWorkflow,
} from "../types/index.js";
import type { StepResult } from "../db/step-results.js";
import type { AuthPreset } from "../db/auth-presets.js";
import type { Environment } from "../db/environments.js";
import type { Session } from "../db/sessions.js";

export const TESTERS_APP = "testers";

/** Promise-wrap a db function's return type. */
type A<F extends (...args: never[]) => unknown> = (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>;

/**
 * The one storage interface. Signatures are derived from the local `db/*`
 * functions (so parity is enforced by the type system) but every method is
 * async — the ApiStore transport is over HTTP.
 */
export interface Store {
  readonly transport: "local" | "cloud-http";

  // ── scenarios ──
  createScenario: A<typeof dbScenarios.createScenario>;
  getScenario: A<typeof dbScenarios.getScenario>;
  getScenarioByShortId: A<typeof dbScenarios.getScenarioByShortId>;
  listScenarios: A<typeof dbScenarios.listScenarios>;
  updateScenario: A<typeof dbScenarios.updateScenario>;
  deleteScenario: A<typeof dbScenarios.deleteScenario>;
  countScenarios: A<typeof dbScenarios.countScenarios>;
  findStaleScenarios: A<typeof dbScenarios.findStaleScenarios>;
  updateScenarioPassedCache: A<typeof dbScenarios.updateScenarioPassedCache>;

  // ── projects ──
  createProject: A<typeof dbProjects.createProject>;
  getProject: A<typeof dbProjects.getProject>;
  getProjectByPath: A<typeof dbProjects.getProjectByPath>;
  listProjects: A<typeof dbProjects.listProjects>;
  updateProject: A<typeof dbProjects.updateProject>;
  ensureProject: A<typeof dbProjects.ensureProject>;

  // ── personas ──
  createPersona: A<typeof dbPersonas.createPersona>;
  getPersona: A<typeof dbPersonas.getPersona>;
  listPersonas: A<typeof dbPersonas.listPersonas>;
  countPersonas: A<typeof dbPersonas.countPersonas>;
  updatePersona: A<typeof dbPersonas.updatePersona>;
  deletePersona: A<typeof dbPersonas.deletePersona>;
  getGlobalPersonas: A<typeof dbPersonas.getGlobalPersonas>;
  listAuthenticatedPersonas: A<typeof dbPersonas.listAuthenticatedPersonas>;
  savePersonaAuthCookies: A<typeof dbPersonas.savePersonaAuthCookies>;

  // ── runs ──
  createRun: A<typeof dbRuns.createRun>;
  getRun: A<typeof dbRuns.getRun>;
  listRuns: A<typeof dbRuns.listRuns>;
  countRuns: A<typeof dbRuns.countRuns>;
  updateRun: A<typeof dbRuns.updateRun>;
  deleteRun: A<typeof dbRuns.deleteRun>;

  // ── results ──
  createResult: A<typeof dbResults.createResult>;
  getResult: A<typeof dbResults.getResult>;
  listResults: A<typeof dbResults.listResults>;
  getResultsByRun: A<typeof dbResults.getResultsByRun>;
  updateResult: A<typeof dbResults.updateResult>;

  // ── screenshots ──
  createScreenshot: A<typeof dbScreenshots.createScreenshot>;
  listScreenshots: A<typeof dbScreenshots.listScreenshots>;

  // ── step results ──
  createStepResult: A<typeof dbStepResults.createStepResult>;
  getStepResult: A<typeof dbStepResults.getStepResult>;
  listStepResults: A<typeof dbStepResults.listStepResults>;
  updateStepResult: A<typeof dbStepResults.updateStepResult>;

  // ── api checks ──
  createApiCheck: A<typeof dbApiChecks.createApiCheck>;
  getApiCheck: A<typeof dbApiChecks.getApiCheck>;
  listApiChecks: A<typeof dbApiChecks.listApiChecks>;
  countApiChecks: A<typeof dbApiChecks.countApiChecks>;
  updateApiCheck: A<typeof dbApiChecks.updateApiCheck>;
  deleteApiCheck: A<typeof dbApiChecks.deleteApiCheck>;
  createApiCheckResult: A<typeof dbApiChecks.createApiCheckResult>;
  listApiCheckResults: A<typeof dbApiChecks.listApiCheckResults>;
  getLatestApiCheckResult: A<typeof dbApiChecks.getLatestApiCheckResult>;

  // ── schedules ──
  createSchedule: A<typeof dbSchedules.createSchedule>;
  getSchedule: A<typeof dbSchedules.getSchedule>;
  listSchedules: A<typeof dbSchedules.listSchedules>;
  updateSchedule: A<typeof dbSchedules.updateSchedule>;
  deleteSchedule: A<typeof dbSchedules.deleteSchedule>;
  getEnabledSchedules: A<typeof dbSchedules.getEnabledSchedules>;
  updateLastRun: A<typeof dbSchedules.updateLastRun>;

  // ── auth presets ──
  createAuthPreset: A<typeof dbAuthPresets.createAuthPreset>;
  getAuthPreset: A<typeof dbAuthPresets.getAuthPreset>;
  listAuthPresets: A<typeof dbAuthPresets.listAuthPresets>;
  deleteAuthPreset: A<typeof dbAuthPresets.deleteAuthPreset>;

  // ── flows ──
  addDependency: A<typeof dbFlows.addDependency>;
  removeDependency: A<typeof dbFlows.removeDependency>;
  getDependencies: A<typeof dbFlows.getDependencies>;
  getDependents: A<typeof dbFlows.getDependents>;
  createFlow: A<typeof dbFlows.createFlow>;
  getFlow: A<typeof dbFlows.getFlow>;
  listFlows: A<typeof dbFlows.listFlows>;
  deleteFlow: A<typeof dbFlows.deleteFlow>;

  // ── testing workflows ──
  createTestingWorkflow: A<typeof dbWorkflows.createTestingWorkflow>;
  getTestingWorkflow: A<typeof dbWorkflows.getTestingWorkflow>;
  listTestingWorkflows: A<typeof dbWorkflows.listTestingWorkflows>;
  updateTestingWorkflow: A<typeof dbWorkflows.updateTestingWorkflow>;
  deleteTestingWorkflow: A<typeof dbWorkflows.deleteTestingWorkflow>;

  // ── environments ──
  createEnvironment: A<typeof dbEnvironments.createEnvironment>;
  getEnvironment: A<typeof dbEnvironments.getEnvironment>;
  listEnvironments: A<typeof dbEnvironments.listEnvironments>;
  deleteEnvironment: A<typeof dbEnvironments.deleteEnvironment>;
  setDefaultEnvironment: A<typeof dbEnvironments.setDefaultEnvironment>;
  getDefaultEnvironment: A<typeof dbEnvironments.getDefaultEnvironment>;

  // ── sessions ──
  createSession: A<typeof dbSessions.createSession>;
  listSessions: A<typeof dbSessions.listSessions>;
  getSession: A<typeof dbSessions.getSession>;
  deleteSession: A<typeof dbSessions.deleteSession>;
  countSessions: A<typeof dbSessions.countSessions>;
  searchSessions: A<typeof dbSessions.searchSessions>;

  // ── agents ──
  registerAgent: A<typeof dbAgents.registerAgent>;
  listAgents: A<typeof dbAgents.listAgents>;
  heartbeatAgent: A<typeof dbAgents.heartbeatAgent>;
  setAgentFocus: A<typeof dbAgents.setAgentFocus>;

  // ── scan issues ──
  listScanIssues: A<typeof dbScanIssues.listScanIssues>;
  getScanIssue: A<typeof dbScanIssues.getScanIssue>;
  resolveScanIssue: A<typeof dbScanIssues.resolveScanIssue>;
  upsertScanIssue: A<typeof dbScanIssues.upsertScanIssue>;
  setScanIssueTodoTaskId: A<typeof dbScanIssues.setScanIssueTodoTaskId>;
}

// ────────────────────────────────────────────────────────────────────────────
// LocalStore — on-box SQLite. Delegates verbatim to `db/*`, wrapped async.
// ────────────────────────────────────────────────────────────────────────────
class LocalStore implements Store {
  readonly transport = "local" as const;

  async createScenario(...a: Parameters<typeof dbScenarios.createScenario>) { return dbScenarios.createScenario(...a); }
  async getScenario(...a: Parameters<typeof dbScenarios.getScenario>) { return dbScenarios.getScenario(...a); }
  async getScenarioByShortId(...a: Parameters<typeof dbScenarios.getScenarioByShortId>) { return dbScenarios.getScenarioByShortId(...a); }
  async listScenarios(...a: Parameters<typeof dbScenarios.listScenarios>) { return dbScenarios.listScenarios(...a); }
  async updateScenario(...a: Parameters<typeof dbScenarios.updateScenario>) { return dbScenarios.updateScenario(...a); }
  async deleteScenario(...a: Parameters<typeof dbScenarios.deleteScenario>) { return dbScenarios.deleteScenario(...a); }
  async countScenarios(...a: Parameters<typeof dbScenarios.countScenarios>) { return dbScenarios.countScenarios(...a); }
  async findStaleScenarios(...a: Parameters<typeof dbScenarios.findStaleScenarios>) { return dbScenarios.findStaleScenarios(...a); }
  async updateScenarioPassedCache(...a: Parameters<typeof dbScenarios.updateScenarioPassedCache>) { return dbScenarios.updateScenarioPassedCache(...a); }

  async createProject(...a: Parameters<typeof dbProjects.createProject>) { return dbProjects.createProject(...a); }
  async getProject(...a: Parameters<typeof dbProjects.getProject>) { return dbProjects.getProject(...a); }
  async getProjectByPath(...a: Parameters<typeof dbProjects.getProjectByPath>) { return dbProjects.getProjectByPath(...a); }
  async listProjects(...a: Parameters<typeof dbProjects.listProjects>) { return dbProjects.listProjects(...a); }
  async updateProject(...a: Parameters<typeof dbProjects.updateProject>) { return dbProjects.updateProject(...a); }
  async ensureProject(...a: Parameters<typeof dbProjects.ensureProject>) { return dbProjects.ensureProject(...a); }

  async createPersona(...a: Parameters<typeof dbPersonas.createPersona>) { return dbPersonas.createPersona(...a); }
  async getPersona(...a: Parameters<typeof dbPersonas.getPersona>) { return dbPersonas.getPersona(...a); }
  async listPersonas(...a: Parameters<typeof dbPersonas.listPersonas>) { return dbPersonas.listPersonas(...a); }
  async countPersonas(...a: Parameters<typeof dbPersonas.countPersonas>) { return dbPersonas.countPersonas(...a); }
  async updatePersona(...a: Parameters<typeof dbPersonas.updatePersona>) { return dbPersonas.updatePersona(...a); }
  async deletePersona(...a: Parameters<typeof dbPersonas.deletePersona>) { return dbPersonas.deletePersona(...a); }
  async getGlobalPersonas(...a: Parameters<typeof dbPersonas.getGlobalPersonas>) { return dbPersonas.getGlobalPersonas(...a); }
  async listAuthenticatedPersonas(...a: Parameters<typeof dbPersonas.listAuthenticatedPersonas>) { return dbPersonas.listAuthenticatedPersonas(...a); }
  async savePersonaAuthCookies(...a: Parameters<typeof dbPersonas.savePersonaAuthCookies>) { return dbPersonas.savePersonaAuthCookies(...a); }

  async createRun(...a: Parameters<typeof dbRuns.createRun>) { return dbRuns.createRun(...a); }
  async getRun(...a: Parameters<typeof dbRuns.getRun>) { return dbRuns.getRun(...a); }
  async listRuns(...a: Parameters<typeof dbRuns.listRuns>) { return dbRuns.listRuns(...a); }
  async countRuns(...a: Parameters<typeof dbRuns.countRuns>) { return dbRuns.countRuns(...a); }
  async updateRun(...a: Parameters<typeof dbRuns.updateRun>) { return dbRuns.updateRun(...a); }
  async deleteRun(...a: Parameters<typeof dbRuns.deleteRun>) { return dbRuns.deleteRun(...a); }

  async createResult(...a: Parameters<typeof dbResults.createResult>) { return dbResults.createResult(...a); }
  async getResult(...a: Parameters<typeof dbResults.getResult>) { return dbResults.getResult(...a); }
  async listResults(...a: Parameters<typeof dbResults.listResults>) { return dbResults.listResults(...a); }
  async getResultsByRun(...a: Parameters<typeof dbResults.getResultsByRun>) { return dbResults.getResultsByRun(...a); }
  async updateResult(...a: Parameters<typeof dbResults.updateResult>) { return dbResults.updateResult(...a); }

  async createScreenshot(...a: Parameters<typeof dbScreenshots.createScreenshot>) { return dbScreenshots.createScreenshot(...a); }
  async listScreenshots(...a: Parameters<typeof dbScreenshots.listScreenshots>) { return dbScreenshots.listScreenshots(...a); }

  async createStepResult(...a: Parameters<typeof dbStepResults.createStepResult>) { return dbStepResults.createStepResult(...a); }
  async getStepResult(...a: Parameters<typeof dbStepResults.getStepResult>) { return dbStepResults.getStepResult(...a); }
  async listStepResults(...a: Parameters<typeof dbStepResults.listStepResults>) { return dbStepResults.listStepResults(...a); }
  async updateStepResult(...a: Parameters<typeof dbStepResults.updateStepResult>) { return dbStepResults.updateStepResult(...a); }

  async createApiCheck(...a: Parameters<typeof dbApiChecks.createApiCheck>) { return dbApiChecks.createApiCheck(...a); }
  async getApiCheck(...a: Parameters<typeof dbApiChecks.getApiCheck>) { return dbApiChecks.getApiCheck(...a); }
  async listApiChecks(...a: Parameters<typeof dbApiChecks.listApiChecks>) { return dbApiChecks.listApiChecks(...a); }
  async countApiChecks(...a: Parameters<typeof dbApiChecks.countApiChecks>) { return dbApiChecks.countApiChecks(...a); }
  async updateApiCheck(...a: Parameters<typeof dbApiChecks.updateApiCheck>) { return dbApiChecks.updateApiCheck(...a); }
  async deleteApiCheck(...a: Parameters<typeof dbApiChecks.deleteApiCheck>) { return dbApiChecks.deleteApiCheck(...a); }
  async createApiCheckResult(...a: Parameters<typeof dbApiChecks.createApiCheckResult>) { return dbApiChecks.createApiCheckResult(...a); }
  async listApiCheckResults(...a: Parameters<typeof dbApiChecks.listApiCheckResults>) { return dbApiChecks.listApiCheckResults(...a); }
  async getLatestApiCheckResult(...a: Parameters<typeof dbApiChecks.getLatestApiCheckResult>) { return dbApiChecks.getLatestApiCheckResult(...a); }

  async createSchedule(...a: Parameters<typeof dbSchedules.createSchedule>) { return dbSchedules.createSchedule(...a); }
  async getSchedule(...a: Parameters<typeof dbSchedules.getSchedule>) { return dbSchedules.getSchedule(...a); }
  async listSchedules(...a: Parameters<typeof dbSchedules.listSchedules>) { return dbSchedules.listSchedules(...a); }
  async updateSchedule(...a: Parameters<typeof dbSchedules.updateSchedule>) { return dbSchedules.updateSchedule(...a); }
  async deleteSchedule(...a: Parameters<typeof dbSchedules.deleteSchedule>) { return dbSchedules.deleteSchedule(...a); }
  async getEnabledSchedules(...a: Parameters<typeof dbSchedules.getEnabledSchedules>) { return dbSchedules.getEnabledSchedules(...a); }
  async updateLastRun(...a: Parameters<typeof dbSchedules.updateLastRun>) { return dbSchedules.updateLastRun(...a); }

  async createAuthPreset(...a: Parameters<typeof dbAuthPresets.createAuthPreset>) { return dbAuthPresets.createAuthPreset(...a); }
  async getAuthPreset(...a: Parameters<typeof dbAuthPresets.getAuthPreset>) { return dbAuthPresets.getAuthPreset(...a); }
  async listAuthPresets(...a: Parameters<typeof dbAuthPresets.listAuthPresets>) { return dbAuthPresets.listAuthPresets(...a); }
  async deleteAuthPreset(...a: Parameters<typeof dbAuthPresets.deleteAuthPreset>) { return dbAuthPresets.deleteAuthPreset(...a); }

  async addDependency(...a: Parameters<typeof dbFlows.addDependency>) { return dbFlows.addDependency(...a); }
  async removeDependency(...a: Parameters<typeof dbFlows.removeDependency>) { return dbFlows.removeDependency(...a); }
  async getDependencies(...a: Parameters<typeof dbFlows.getDependencies>) { return dbFlows.getDependencies(...a); }
  async getDependents(...a: Parameters<typeof dbFlows.getDependents>) { return dbFlows.getDependents(...a); }
  async createFlow(...a: Parameters<typeof dbFlows.createFlow>) { return dbFlows.createFlow(...a); }
  async getFlow(...a: Parameters<typeof dbFlows.getFlow>) { return dbFlows.getFlow(...a); }
  async listFlows(...a: Parameters<typeof dbFlows.listFlows>) { return dbFlows.listFlows(...a); }
  async deleteFlow(...a: Parameters<typeof dbFlows.deleteFlow>) { return dbFlows.deleteFlow(...a); }

  async createTestingWorkflow(...a: Parameters<typeof dbWorkflows.createTestingWorkflow>) { return dbWorkflows.createTestingWorkflow(...a); }
  async getTestingWorkflow(...a: Parameters<typeof dbWorkflows.getTestingWorkflow>) { return dbWorkflows.getTestingWorkflow(...a); }
  async listTestingWorkflows(...a: Parameters<typeof dbWorkflows.listTestingWorkflows>) { return dbWorkflows.listTestingWorkflows(...a); }
  async updateTestingWorkflow(...a: Parameters<typeof dbWorkflows.updateTestingWorkflow>) { return dbWorkflows.updateTestingWorkflow(...a); }
  async deleteTestingWorkflow(...a: Parameters<typeof dbWorkflows.deleteTestingWorkflow>) { return dbWorkflows.deleteTestingWorkflow(...a); }

  async createEnvironment(...a: Parameters<typeof dbEnvironments.createEnvironment>) { return dbEnvironments.createEnvironment(...a); }
  async getEnvironment(...a: Parameters<typeof dbEnvironments.getEnvironment>) { return dbEnvironments.getEnvironment(...a); }
  async listEnvironments(...a: Parameters<typeof dbEnvironments.listEnvironments>) { return dbEnvironments.listEnvironments(...a); }
  async deleteEnvironment(...a: Parameters<typeof dbEnvironments.deleteEnvironment>) { return dbEnvironments.deleteEnvironment(...a); }
  async setDefaultEnvironment(...a: Parameters<typeof dbEnvironments.setDefaultEnvironment>) { return dbEnvironments.setDefaultEnvironment(...a); }
  async getDefaultEnvironment(...a: Parameters<typeof dbEnvironments.getDefaultEnvironment>) { return dbEnvironments.getDefaultEnvironment(...a); }

  async createSession(...a: Parameters<typeof dbSessions.createSession>) { return dbSessions.createSession(...a); }
  async listSessions(...a: Parameters<typeof dbSessions.listSessions>) { return dbSessions.listSessions(...a); }
  async getSession(...a: Parameters<typeof dbSessions.getSession>) { return dbSessions.getSession(...a); }
  async deleteSession(...a: Parameters<typeof dbSessions.deleteSession>) { return dbSessions.deleteSession(...a); }
  async countSessions(...a: Parameters<typeof dbSessions.countSessions>) { return dbSessions.countSessions(...a); }
  async searchSessions(...a: Parameters<typeof dbSessions.searchSessions>) { return dbSessions.searchSessions(...a); }

  async registerAgent(...a: Parameters<typeof dbAgents.registerAgent>) { return dbAgents.registerAgent(...a); }
  async listAgents(...a: Parameters<typeof dbAgents.listAgents>) { return dbAgents.listAgents(...a); }
  async heartbeatAgent(...a: Parameters<typeof dbAgents.heartbeatAgent>) { return dbAgents.heartbeatAgent(...a); }
  async setAgentFocus(...a: Parameters<typeof dbAgents.setAgentFocus>) { return dbAgents.setAgentFocus(...a); }

  async listScanIssues(...a: Parameters<typeof dbScanIssues.listScanIssues>) { return dbScanIssues.listScanIssues(...a); }
  async getScanIssue(...a: Parameters<typeof dbScanIssues.getScanIssue>) { return dbScanIssues.getScanIssue(...a); }
  async resolveScanIssue(...a: Parameters<typeof dbScanIssues.resolveScanIssue>) { return dbScanIssues.resolveScanIssue(...a); }
  async upsertScanIssue(...a: Parameters<typeof dbScanIssues.upsertScanIssue>) { return dbScanIssues.upsertScanIssue(...a); }
  async setScanIssueTodoTaskId(...a: Parameters<typeof dbScanIssues.setScanIssueTodoTaskId>) { return dbScanIssues.setScanIssueTodoTaskId(...a); }
}

// ────────────────────────────────────────────────────────────────────────────
// ApiStore — the app's cloud `/v1` HTTP API + bearer key. No SQLite, no DSN.
// ────────────────────────────────────────────────────────────────────────────
const CLOUD_PAGE_SIZE = 500;
const CLOUD_MAX_ROWS = 100_000;
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

class ApiStore implements Store {
  readonly transport = "cloud-http" as const;

  constructor(private readonly c: HasnaStorageClient) {}

  /** Page a collection to completion so client-side filters see the whole set. */
  private async all<T>(resource: string, query: Record<string, string | number | boolean> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < CLOUD_MAX_ROWS; offset += CLOUD_PAGE_SIZE) {
      const page = (await this.c.list<T>(resource, { query: { ...query, limit: CLOUD_PAGE_SIZE, offset } })).items;
      out.push(...page);
      if (page.length < CLOUD_PAGE_SIZE) break;
    }
    return out;
  }

  // ── scenarios ──
  async createScenario(input: Parameters<typeof dbScenarios.createScenario>[0]) { return this.c.create<Scenario>("scenarios", input); }
  async getScenario(id: string) { return this.c.get<Scenario>("scenarios", id); }
  async getScenarioByShortId(shortId: string) {
    return (await this.all<Scenario>("scenarios")).find((s) => s.shortId === shortId) ?? null;
  }
  async listScenarios(filter?: Parameters<typeof dbScenarios.listScenarios>[0]) {
    const q: Record<string, string> = {};
    if (filter?.projectId) q.projectId = filter.projectId;
    let items = await this.all<Scenario>("scenarios", q);
    if (filter?.projectId) items = items.filter((s) => s.projectId === filter.projectId);
    if (filter?.tags?.length) items = items.filter((s) => filter.tags!.every((t) => s.tags.includes(t)));
    if (filter?.priority) items = items.filter((s) => s.priority === filter.priority);
    if (filter?.search) {
      const n = filter.search.toLowerCase();
      items = items.filter((s) => s.name.toLowerCase().includes(n) || (s.description ?? "").toLowerCase().includes(n));
    }
    const sort = filter?.sort ?? "date";
    const dir = filter?.desc === false ? 1 : -1;
    items = [...items].sort((a, b) => {
      if (sort === "name") return dir * a.name.localeCompare(b.name);
      if (sort === "priority") return dir * ((PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4));
      return dir * (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
    });
    if (filter?.offset) items = items.slice(filter.offset);
    if (filter?.limit) items = items.slice(0, filter.limit);
    return items;
  }
  async updateScenario(id: string, input: Parameters<typeof dbScenarios.updateScenario>[1], version: number) {
    return this.c.update<Scenario>("scenarios", id, { ...input, version }, { method: "PUT" });
  }
  async deleteScenario(id: string) { await this.c.delete("scenarios", id); return true; }
  async countScenarios(filter?: Parameters<typeof dbScenarios.countScenarios>[0]) {
    const { limit: _l, offset: _o, ...rest } = filter ?? {};
    void _l; void _o;
    return (await this.listScenarios(rest)).length;
  }
  async findStaleScenarios(days: number) {
    const cutoff = Date.now() - days * 86_400_000;
    return (await this.all<Scenario>("scenarios"))
      .map((s) => ({ ...s, lastRunAt: s.lastPassedAt ?? null }))
      .filter((s) => {
        const last = s.lastRunAt ? Date.parse(s.lastRunAt) : NaN;
        return !Number.isFinite(last) || last < cutoff;
      });
  }
  async updateScenarioPassedCache(id: string, url: string) {
    await this.c.update<Scenario>("scenarios", id, { lastPassedUrl: url }, { method: "PATCH" });
  }

  // ── projects ──
  async createProject(input: Parameters<typeof dbProjects.createProject>[0]) { return this.c.create<Project>("projects", input); }
  async getProject(id: string) { return this.c.get<Project>("projects", id); }
  async getProjectByPath(path: string) {
    return (await this.all<Project>("projects")).find((p) => p.path === path) ?? null;
  }
  async listProjects() { return this.all<Project>("projects"); }
  async updateProject(id: string, input: Parameters<typeof dbProjects.updateProject>[1]) {
    return this.c.update<Project>("projects", id, input, { method: "PUT" });
  }
  async ensureProject(name: string, path: string) {
    const all = await this.all<Project>("projects");
    const byPath = path ? all.find((p) => p.path === path) : undefined;
    if (byPath) return byPath;
    const byName = all.find((p) => p.name === name);
    if (byName) return byName;
    return this.c.create<Project>("projects", { name, path } as Parameters<typeof dbProjects.createProject>[0]);
  }

  // ── personas ──
  async createPersona(input: Parameters<typeof dbPersonas.createPersona>[0]) { return this.c.create<Persona>("personas", input); }
  async getPersona(id: string) {
    const direct = await this.c.get<Persona>("personas", id);
    if (direct) return direct;
    return (await this.all<Persona>("personas")).find((p) => p.shortId === id) ?? null;
  }
  private async allPersonas(filter?: Parameters<typeof dbPersonas.listPersonas>[0]) {
    let out = await this.all<Persona>("personas");
    if (filter?.globalOnly) out = out.filter((p) => !p.projectId);
    else if (filter?.projectId) out = out.filter((p) => p.projectId === filter.projectId || !p.projectId);
    if (filter?.enabled !== undefined) out = out.filter((p) => Boolean(p.enabled) === filter.enabled);
    return out;
  }
  async listPersonas(filter?: Parameters<typeof dbPersonas.listPersonas>[0]) {
    let items = await this.allPersonas(filter);
    if (filter?.offset) items = items.slice(filter.offset);
    if (filter?.limit) items = items.slice(0, filter.limit);
    return items;
  }
  async countPersonas(filter?: Parameters<typeof dbPersonas.countPersonas>[0]) { return (await this.allPersonas(filter)).length; }
  async updatePersona(id: string, updates: Parameters<typeof dbPersonas.updatePersona>[1], version: number) {
    return this.c.update<Persona>("personas", id, { ...updates, version }, { method: "PUT" });
  }
  async deletePersona(id: string) { await this.c.delete("personas", id); return true; }
  async getGlobalPersonas() { return (await this.all<Persona>("personas")).filter((p) => !p.projectId); }
  async listAuthenticatedPersonas(projectId?: string) {
    return (await this.allPersonas(projectId ? { projectId } : undefined)).filter((p) => Boolean(p.auth));
  }
  async savePersonaAuthCookies(id: string, cookies: Record<string, unknown>[]) {
    await this.c.update<Persona>("personas", id, { authCookies: cookies }, { method: "PATCH" });
  }

  // ── runs ──
  async createRun(input: Parameters<typeof dbRuns.createRun>[0]) { return this.c.create<Run>("runs", input); }
  async getRun(id: string) { return this.c.get<Run>("runs", id); }
  async listRuns(filter?: Parameters<typeof dbRuns.listRuns>[0]) {
    const q: Record<string, string> = {};
    if (filter?.projectId) q.projectId = filter.projectId;
    let items = await this.all<Run>("runs", q);
    if (filter?.projectId) items = items.filter((r) => r.projectId === filter.projectId);
    if (filter?.status) items = items.filter((r) => r.status === filter.status);
    items = [...items].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    if (filter?.offset) items = items.slice(filter.offset);
    if (filter?.limit) items = items.slice(0, filter.limit);
    return items;
  }
  async countRuns(filter?: Parameters<typeof dbRuns.countRuns>[0]) {
    const { limit: _l, offset: _o, ...rest } = filter ?? {};
    void _l; void _o;
    return (await this.listRuns(rest)).length;
  }
  async updateRun(id: string, updates: Parameters<typeof dbRuns.updateRun>[1]) {
    return this.c.update<Run>("runs", id, updates, { method: "PUT" });
  }
  async deleteRun(id: string) { await this.c.delete("runs", id); return true; }

  // ── results ──
  async createResult(input: Parameters<typeof dbResults.createResult>[0]) { return this.c.create<Result>("results", input); }
  async getResult(id: string) { return this.c.get<Result>("results", id); }
  async listResults(runId: string) { return (await this.c.list<Result>(`runs/${encodeURIComponent(runId)}/results`)).items; }
  async getResultsByRun(runId: string) { return this.listResults(runId); }
  async updateResult(id: string, updates: Parameters<typeof dbResults.updateResult>[1]) {
    return this.c.update<Result>("results", id, updates, { method: "PUT" });
  }

  // ── screenshots ──
  async createScreenshot(input: Parameters<typeof dbScreenshots.createScreenshot>[0]) { return this.c.create<Screenshot>("screenshots", input); }
  async listScreenshots(resultId: string) {
    return (await this.c.list<Screenshot>("screenshots", { query: { resultId } })).items;
  }

  // ── step results ──
  async createStepResult(input: Parameters<typeof dbStepResults.createStepResult>[0]) { return this.c.create<StepResult>("step-results", input); }
  async getStepResult(id: string) { return this.c.get<StepResult>("step-results", id); }
  async listStepResults(resultId: string) {
    return (await this.c.list<StepResult>("step-results", { query: { resultId } })).items;
  }
  async updateStepResult(id: string, input: Parameters<typeof dbStepResults.updateStepResult>[1]) {
    return this.c.update<StepResult>("step-results", id, input, { method: "PUT" });
  }

  // ── api checks ──
  async createApiCheck(input: Parameters<typeof dbApiChecks.createApiCheck>[0]) { return this.c.create<ApiCheck>("api-checks", input); }
  async getApiCheck(id: string) { return this.c.get<ApiCheck>("api-checks", id); }
  async listApiChecks(filter?: Parameters<typeof dbApiChecks.listApiChecks>[0]) {
    let items = await this.all<ApiCheck>("api-checks");
    if (filter?.projectId) items = items.filter((c) => c.projectId === filter.projectId);
    if (filter?.enabled !== undefined) items = items.filter((c) => Boolean(c.enabled) === filter.enabled);
    return items;
  }
  async countApiChecks(filter?: Parameters<typeof dbApiChecks.countApiChecks>[0]) { return (await this.listApiChecks(filter)).length; }
  async updateApiCheck(id: string, input: Parameters<typeof dbApiChecks.updateApiCheck>[1]) {
    return this.c.update<ApiCheck>("api-checks", id, input, { method: "PUT" });
  }
  async deleteApiCheck(id: string) { await this.c.delete("api-checks", id); return true; }
  async createApiCheckResult(input: Parameters<typeof dbApiChecks.createApiCheckResult>[0]) {
    return this.c.create<ApiCheckResult>("api-check-results", input);
  }
  async listApiCheckResults(checkId: string, opts?: { limit?: number; offset?: number }) {
    let items = (await this.c.list<ApiCheckResult>("api-check-results", { query: { checkId } })).items;
    if (opts?.offset) items = items.slice(opts.offset);
    if (opts?.limit) items = items.slice(0, opts.limit);
    return items;
  }
  async getLatestApiCheckResult(checkId: string) { return (await this.listApiCheckResults(checkId, { limit: 1 }))[0] ?? null; }

  // ── schedules ──
  async createSchedule(input: Parameters<typeof dbSchedules.createSchedule>[0]) { return this.c.create<Schedule>("schedules", input); }
  async getSchedule(id: string) { return this.c.get<Schedule>("schedules", id); }
  async listSchedules(filter?: Parameters<typeof dbSchedules.listSchedules>[0]) {
    let items = await this.all<Schedule>("schedules");
    if (filter?.projectId) items = items.filter((s) => s.projectId === filter.projectId);
    if (filter?.enabled !== undefined) items = items.filter((s) => Boolean(s.enabled) === filter.enabled);
    return items;
  }
  async updateSchedule(id: string, input: Parameters<typeof dbSchedules.updateSchedule>[1]) {
    return this.c.update<Schedule>("schedules", id, input, { method: "PUT" });
  }
  async deleteSchedule(id: string) { await this.c.delete("schedules", id); return true; }
  async getEnabledSchedules() { return (await this.all<Schedule>("schedules")).filter((s) => Boolean(s.enabled)); }
  async updateLastRun(id: string, runId: string, nextRunAt: string) {
    await this.c.update<Schedule>("schedules", id, { lastRunId: runId, nextRunAt }, { method: "PATCH" });
  }

  // ── auth presets (keyed by name) ──
  async createAuthPreset(input: Parameters<typeof dbAuthPresets.createAuthPreset>[0]) { return this.c.create<AuthPreset>("auth-presets", input); }
  async getAuthPreset(name: string) { return this.c.get<AuthPreset>("auth-presets", name); }
  async listAuthPresets() { return this.all<AuthPreset>("auth-presets"); }
  async deleteAuthPreset(name: string) { await this.c.delete("auth-presets", name); return true; }

  // ── flows ──
  async addDependency(scenarioId: string, dependsOn: string) {
    await this.c.create("flow-dependencies", { scenarioId, dependsOn });
  }
  async removeDependency(scenarioId: string, dependsOn: string) {
    await this.c.delete("flow-dependencies", `${scenarioId}:${dependsOn}`);
    return true;
  }
  async getDependencies(scenarioId: string) {
    return (await this.c.list<{ dependsOn: string }>("flow-dependencies", { query: { scenarioId } })).items.map((d) => d.dependsOn);
  }
  async getDependents(scenarioId: string) {
    return (await this.c.list<{ scenarioId: string }>("flow-dependencies", { query: { dependsOn: scenarioId } })).items.map((d) => d.scenarioId);
  }
  async createFlow(input: Parameters<typeof dbFlows.createFlow>[0]) { return this.c.create<Flow>("flows", input); }
  async getFlow(id: string) { return this.c.get<Flow>("flows", id); }
  async listFlows(projectId?: string) {
    let items = await this.all<Flow>("flows");
    if (projectId) items = items.filter((f) => f.projectId === projectId);
    return items;
  }
  async deleteFlow(id: string) { await this.c.delete("flows", id); return true; }

  // ── testing workflows ──
  async createTestingWorkflow(input: Parameters<typeof dbWorkflows.createTestingWorkflow>[0]) { return this.c.create<TestingWorkflow>("workflows", input); }
  async getTestingWorkflow(id: string) { return this.c.get<TestingWorkflow>("workflows", id); }
  async listTestingWorkflows(filter?: Parameters<typeof dbWorkflows.listTestingWorkflows>[0]) {
    let items = await this.all<TestingWorkflow>("workflows");
    if (filter?.projectId) items = items.filter((w) => w.projectId === filter.projectId);
    return items;
  }
  async updateTestingWorkflow(id: string, input: Parameters<typeof dbWorkflows.updateTestingWorkflow>[1]) {
    return this.c.update<TestingWorkflow>("workflows", id, input, { method: "PUT" });
  }
  async deleteTestingWorkflow(id: string) { await this.c.delete("workflows", id); return true; }

  // ── environments (keyed by name; server route resolves name) ──
  async createEnvironment(input: Parameters<typeof dbEnvironments.createEnvironment>[0]) { return this.c.create<Environment>("environments", input); }
  async getEnvironment(name: string) {
    return (await this.all<Environment>("environments")).find((e) => e.name === name) ?? null;
  }
  async listEnvironments(projectId?: string) {
    let items = await this.all<Environment>("environments");
    if (projectId) items = items.filter((e) => e.projectId === projectId || !e.projectId);
    return items;
  }
  async deleteEnvironment(name: string) {
    const env = await this.getEnvironment(name);
    if (!env) return false;
    await this.c.delete("environments", env.id);
    return true;
  }
  async setDefaultEnvironment(name: string) {
    const env = await this.getEnvironment(name);
    if (!env) throw new Error(`environment '${name}' not found`);
    await this.c.update<Environment>("environments", env.id, { isDefault: true }, { method: "PATCH" });
  }
  async getDefaultEnvironment() {
    return (await this.all<Environment>("environments")).find((e) => e.isDefault) ?? null;
  }

  // ── sessions ──
  async createSession(input: Parameters<typeof dbSessions.createSession>[0]) { return this.c.create<Session>("sessions", input); }
  async listSessions(limit = 50, offset = 0) {
    return (await this.c.list<Session>("sessions", { query: { limit, offset } })).items;
  }
  async getSession(id: string) { return this.c.get<Session>("sessions", id); }
  async deleteSession(id: string) { await this.c.delete("sessions", id); return true; }
  async countSessions() { return (await this.all<Session>("sessions")).length; }
  async searchSessions(query: string, limit = 20) {
    const n = query.toLowerCase();
    return (await this.all<Session>("sessions"))
      .filter((s) => JSON.stringify(s).toLowerCase().includes(n))
      .slice(0, limit);
  }

  // ── agents ──
  async registerAgent(input: Parameters<typeof dbAgents.registerAgent>[0]) {
    return this.c.create("agents", input) as Promise<Awaited<ReturnType<typeof dbAgents.registerAgent>>>;
  }
  async listAgents() { return this.all("agents") as Promise<Awaited<ReturnType<typeof dbAgents.listAgents>>>; }
  async heartbeatAgent(id: string) {
    return this.c.update("agents", id, { heartbeat: true }, { method: "PATCH" }) as Promise<Awaited<ReturnType<typeof dbAgents.heartbeatAgent>>>;
  }
  async setAgentFocus(id: string, scenarioId: string | null) {
    return this.c.update("agents", id, { focusScenarioId: scenarioId }, { method: "PATCH" }) as Promise<Awaited<ReturnType<typeof dbAgents.setAgentFocus>>>;
  }

  // ── scan issues ──
  async listScanIssues(opts: Parameters<typeof dbScanIssues.listScanIssues>[0] = {}) {
    let items = await this.all<PersistedScanIssue>("scan-issues");
    if (opts.status) items = items.filter((i) => i.status === opts.status);
    if (opts.type) items = items.filter((i) => i.type === opts.type);
    if (opts.projectId) items = items.filter((i) => i.projectId === opts.projectId);
    if (opts.limit) items = items.slice(0, opts.limit);
    return items;
  }
  async getScanIssue(id: string) { return this.c.get<PersistedScanIssue>("scan-issues", id); }
  async resolveScanIssue(id: string) {
    await this.c.update<PersistedScanIssue>("scan-issues", id, { status: "resolved" }, { method: "PATCH" });
    return true;
  }
  async upsertScanIssue(
    issue: Parameters<typeof dbScanIssues.upsertScanIssue>[0],
    projectId?: Parameters<typeof dbScanIssues.upsertScanIssue>[1],
  ) {
    // The server owns fingerprint dedup: POST /v1/scan-issues upserts by
    // fingerprint and returns { issue, outcome }.
    return this.c.create<Awaited<ReturnType<typeof dbScanIssues.upsertScanIssue>>>(
      "scan-issues",
      { ...issue, projectId: projectId ?? null },
    );
  }
  async setScanIssueTodoTaskId(id: string, todoTaskId: string) {
    await this.c.update<PersistedScanIssue>("scan-issues", id, { todoTaskId }, { method: "PATCH" });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Resolver — the single decision point (cached).
// ────────────────────────────────────────────────────────────────────────────
let cachedStore: Store | null = null;

/** Resolve (and cache) THE store for this process. */
export function getStore(): Store {
  if (cachedStore) return cachedStore;
  const resolved = resolveStorageClient(TESTERS_APP, process.env);
  const store: Store = resolved.transport === "cloud-http" ? new ApiStore(resolved.client) : new LocalStore();
  cachedStore = store;
  return store;
}

/** Reset the cached store (tests / env changes). */
export function resetStore(): void {
  cachedStore = null;
}

/** True when the resolved store routes to the cloud `/v1` API. */
export function isCloudStore(): boolean {
  return getStore().transport === "cloud-http";
}

// ────────────────────────────────────────────────────────────────────────────
// Named accessors — ergonomic bindings to the single resolved Store. These add
// NO per-call branch (the transport is chosen once in getStore()); they simply
// forward to `getStore().<method>()` so every caller routes through the Store.
// ────────────────────────────────────────────────────────────────────────────
export const createScenario: Store["createScenario"] = (...a) => getStore().createScenario(...a);
export const getScenario: Store["getScenario"] = (...a) => getStore().getScenario(...a);
export const getScenarioByShortId: Store["getScenarioByShortId"] = (...a) => getStore().getScenarioByShortId(...a);
export const listScenarios: Store["listScenarios"] = (...a) => getStore().listScenarios(...a);
export const updateScenario: Store["updateScenario"] = (...a) => getStore().updateScenario(...a);
export const deleteScenario: Store["deleteScenario"] = (...a) => getStore().deleteScenario(...a);
export const countScenarios: Store["countScenarios"] = (...a) => getStore().countScenarios(...a);
export const findStaleScenarios: Store["findStaleScenarios"] = (...a) => getStore().findStaleScenarios(...a);
export const updateScenarioPassedCache: Store["updateScenarioPassedCache"] = (...a) => getStore().updateScenarioPassedCache(...a);

export const createProject: Store["createProject"] = (...a) => getStore().createProject(...a);
export const getProject: Store["getProject"] = (...a) => getStore().getProject(...a);
export const getProjectByPath: Store["getProjectByPath"] = (...a) => getStore().getProjectByPath(...a);
export const listProjects: Store["listProjects"] = (...a) => getStore().listProjects(...a);
export const updateProject: Store["updateProject"] = (...a) => getStore().updateProject(...a);
export const ensureProject: Store["ensureProject"] = (...a) => getStore().ensureProject(...a);

export const createPersona: Store["createPersona"] = (...a) => getStore().createPersona(...a);
export const getPersona: Store["getPersona"] = (...a) => getStore().getPersona(...a);
export const listPersonas: Store["listPersonas"] = (...a) => getStore().listPersonas(...a);
export const countPersonas: Store["countPersonas"] = (...a) => getStore().countPersonas(...a);
export const updatePersona: Store["updatePersona"] = (...a) => getStore().updatePersona(...a);
export const deletePersona: Store["deletePersona"] = (...a) => getStore().deletePersona(...a);
export const getGlobalPersonas: Store["getGlobalPersonas"] = (...a) => getStore().getGlobalPersonas(...a);
export const listAuthenticatedPersonas: Store["listAuthenticatedPersonas"] = (...a) => getStore().listAuthenticatedPersonas(...a);
export const savePersonaAuthCookies: Store["savePersonaAuthCookies"] = (...a) => getStore().savePersonaAuthCookies(...a);

export const createRun: Store["createRun"] = (...a) => getStore().createRun(...a);
export const getRun: Store["getRun"] = (...a) => getStore().getRun(...a);
export const listRuns: Store["listRuns"] = (...a) => getStore().listRuns(...a);
export const countRuns: Store["countRuns"] = (...a) => getStore().countRuns(...a);
export const updateRun: Store["updateRun"] = (...a) => getStore().updateRun(...a);
export const deleteRun: Store["deleteRun"] = (...a) => getStore().deleteRun(...a);

export const createResult: Store["createResult"] = (...a) => getStore().createResult(...a);
export const getResult: Store["getResult"] = (...a) => getStore().getResult(...a);
export const listResults: Store["listResults"] = (...a) => getStore().listResults(...a);
export const getResultsByRun: Store["getResultsByRun"] = (...a) => getStore().getResultsByRun(...a);
export const updateResult: Store["updateResult"] = (...a) => getStore().updateResult(...a);

export const createScreenshot: Store["createScreenshot"] = (...a) => getStore().createScreenshot(...a);
export const listScreenshots: Store["listScreenshots"] = (...a) => getStore().listScreenshots(...a);

export const createStepResult: Store["createStepResult"] = (...a) => getStore().createStepResult(...a);
export const getStepResult: Store["getStepResult"] = (...a) => getStore().getStepResult(...a);
export const listStepResults: Store["listStepResults"] = (...a) => getStore().listStepResults(...a);
export const updateStepResult: Store["updateStepResult"] = (...a) => getStore().updateStepResult(...a);

export const createApiCheck: Store["createApiCheck"] = (...a) => getStore().createApiCheck(...a);
export const getApiCheck: Store["getApiCheck"] = (...a) => getStore().getApiCheck(...a);
export const listApiChecks: Store["listApiChecks"] = (...a) => getStore().listApiChecks(...a);
export const countApiChecks: Store["countApiChecks"] = (...a) => getStore().countApiChecks(...a);
export const updateApiCheck: Store["updateApiCheck"] = (...a) => getStore().updateApiCheck(...a);
export const deleteApiCheck: Store["deleteApiCheck"] = (...a) => getStore().deleteApiCheck(...a);
export const createApiCheckResult: Store["createApiCheckResult"] = (...a) => getStore().createApiCheckResult(...a);
export const listApiCheckResults: Store["listApiCheckResults"] = (...a) => getStore().listApiCheckResults(...a);
export const getLatestApiCheckResult: Store["getLatestApiCheckResult"] = (...a) => getStore().getLatestApiCheckResult(...a);

export const createSchedule: Store["createSchedule"] = (...a) => getStore().createSchedule(...a);
export const getSchedule: Store["getSchedule"] = (...a) => getStore().getSchedule(...a);
export const listSchedules: Store["listSchedules"] = (...a) => getStore().listSchedules(...a);
export const updateSchedule: Store["updateSchedule"] = (...a) => getStore().updateSchedule(...a);
export const deleteSchedule: Store["deleteSchedule"] = (...a) => getStore().deleteSchedule(...a);
export const getEnabledSchedules: Store["getEnabledSchedules"] = (...a) => getStore().getEnabledSchedules(...a);
export const updateLastRun: Store["updateLastRun"] = (...a) => getStore().updateLastRun(...a);

export const createAuthPreset: Store["createAuthPreset"] = (...a) => getStore().createAuthPreset(...a);
export const getAuthPreset: Store["getAuthPreset"] = (...a) => getStore().getAuthPreset(...a);
export const listAuthPresets: Store["listAuthPresets"] = (...a) => getStore().listAuthPresets(...a);
export const deleteAuthPreset: Store["deleteAuthPreset"] = (...a) => getStore().deleteAuthPreset(...a);

export const addDependency: Store["addDependency"] = (...a) => getStore().addDependency(...a);
export const removeDependency: Store["removeDependency"] = (...a) => getStore().removeDependency(...a);
export const getDependencies: Store["getDependencies"] = (...a) => getStore().getDependencies(...a);
export const getDependents: Store["getDependents"] = (...a) => getStore().getDependents(...a);
export const createFlow: Store["createFlow"] = (...a) => getStore().createFlow(...a);
export const getFlow: Store["getFlow"] = (...a) => getStore().getFlow(...a);
export const listFlows: Store["listFlows"] = (...a) => getStore().listFlows(...a);
export const deleteFlow: Store["deleteFlow"] = (...a) => getStore().deleteFlow(...a);

export const createTestingWorkflow: Store["createTestingWorkflow"] = (...a) => getStore().createTestingWorkflow(...a);
export const getTestingWorkflow: Store["getTestingWorkflow"] = (...a) => getStore().getTestingWorkflow(...a);
export const listTestingWorkflows: Store["listTestingWorkflows"] = (...a) => getStore().listTestingWorkflows(...a);
export const updateTestingWorkflow: Store["updateTestingWorkflow"] = (...a) => getStore().updateTestingWorkflow(...a);
export const deleteTestingWorkflow: Store["deleteTestingWorkflow"] = (...a) => getStore().deleteTestingWorkflow(...a);

export const createEnvironment: Store["createEnvironment"] = (...a) => getStore().createEnvironment(...a);
export const getEnvironment: Store["getEnvironment"] = (...a) => getStore().getEnvironment(...a);
export const listEnvironments: Store["listEnvironments"] = (...a) => getStore().listEnvironments(...a);
export const deleteEnvironment: Store["deleteEnvironment"] = (...a) => getStore().deleteEnvironment(...a);
export const setDefaultEnvironment: Store["setDefaultEnvironment"] = (...a) => getStore().setDefaultEnvironment(...a);
export const getDefaultEnvironment: Store["getDefaultEnvironment"] = (...a) => getStore().getDefaultEnvironment(...a);

export const createSession: Store["createSession"] = (...a) => getStore().createSession(...a);
export const listSessions: Store["listSessions"] = (...a) => getStore().listSessions(...a);
export const getSession: Store["getSession"] = (...a) => getStore().getSession(...a);
export const deleteSession: Store["deleteSession"] = (...a) => getStore().deleteSession(...a);
export const countSessions: Store["countSessions"] = (...a) => getStore().countSessions(...a);
export const searchSessions: Store["searchSessions"] = (...a) => getStore().searchSessions(...a);

export const registerAgent: Store["registerAgent"] = (...a) => getStore().registerAgent(...a);
export const listAgents: Store["listAgents"] = (...a) => getStore().listAgents(...a);
export const heartbeatAgent: Store["heartbeatAgent"] = (...a) => getStore().heartbeatAgent(...a);
export const setAgentFocus: Store["setAgentFocus"] = (...a) => getStore().setAgentFocus(...a);

export const listScanIssues: Store["listScanIssues"] = (...a) => getStore().listScanIssues(...a);
export const getScanIssue: Store["getScanIssue"] = (...a) => getStore().getScanIssue(...a);
export const resolveScanIssue: Store["resolveScanIssue"] = (...a) => getStore().resolveScanIssue(...a);
export const upsertScanIssue: Store["upsertScanIssue"] = (...a) => getStore().upsertScanIssue(...a);
export const setScanIssueTodoTaskId: Store["setScanIssueTodoTaskId"] = (...a) => getStore().setScanIssueTodoTaskId(...a);
