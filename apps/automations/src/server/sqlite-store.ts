import type { ActionDeadLetter } from "@hasna/actions";
import type { QueueLeaseOptions, QueuedAction } from "../types.js";
import { AutomationsStore, type AutomationsStoreOptions, type CreateWebhookRouteInput, type AdmitActionInput } from "../lib/store.js";
import type { CreateReplayRequestInput, CreateRunInput, DaemonHeartbeatInput, DaemonLease, FencedActionCompletionOptions, FencedActionFailureOptions, LeasedQueuedAction, ListPageOptions, RenewActionLeaseOptions, ServerAutomationsStore } from "./store.js";

export class SqliteServerAutomationsStore implements ServerAutomationsStore {
  readonly #store: AutomationsStore;
  constructor(options: AutomationsStoreOptions = {}) { this.#store = new AutomationsStore(options); }
  async close() { this.#store.close(); }
  async createAutomation(spec: Parameters<AutomationsStore["createAutomation"]>[0]) { return this.#store.createAutomation(spec); }
  async ensureAutomation(spec: Parameters<AutomationsStore["ensureAutomation"]>[0]) { return this.#store.ensureAutomation(spec); }
  async listAutomations(options: ListPageOptions = {}) { return pageBy(this.#store.listAutomations(), options, "createdAt"); }
  async requireAutomation(id: string) { return this.#store.requireAutomation(id); }
  async createWebhookRoute(input: CreateWebhookRouteInput) { return this.#store.createWebhookRoute(input); }
  async listWebhookRoutes(options: ListPageOptions = {}) { return pageBy(this.#store.listWebhookRoutes(), options, "createdAt"); }
  async countWebhookRoutes() {
    const row = this.#store.db.query("SELECT count(*) AS count FROM webhook_routes").get() as { count: number };
    return row.count;
  }
  async requireWebhookRoute(idOrPath: string) { return this.#store.requireWebhookRoute(idOrPath); }
  async setWebhookRouteStatus(idOrPath: string, status: Parameters<AutomationsStore["setWebhookRouteStatus"]>[1]) { return this.#store.setWebhookRouteStatus(idOrPath, status); }
  async rotateWebhookRouteSecret(idOrPath: string, secretRef: string) { return this.#store.rotateWebhookRouteSecret(idOrPath, secretRef); }
  async createRun(input: CreateRunInput) { return this.#store.createRun(input); }
  async requireRun(id: string) { return this.#store.requireRun(id); }
  async listRuns(options: ListPageOptions = {}) { return pageBy(this.#store.listRuns(), options, "createdAt"); }
  async admitAction(input: AdmitActionInput) { return this.#store.admitAction(input); }
  async requireQueueEntry(id: string) { return this.#store.requireQueueEntry(id); }
  async listQueueEntries(options: ListPageOptions = {}) { return pageBy(this.#store.listQueueEntries(), options, "createdAt"); }
  async listDeadLetterActions(options: ListPageOptions = {}) { return pageBy(this.#store.listDeadLetterActions(), options, "updatedAt"); }
  async leaseNextAction(options: QueueLeaseOptions): Promise<LeasedQueuedAction | undefined> {
    const action = this.#store.leaseNextAction(options);
    return action ? this.withFencingToken(action) : undefined;
  }
  async renewActionLease(options: RenewActionLeaseOptions): Promise<LeasedQueuedAction> {
    const now = normalizeIso(options.now);
    const expiresAt = new Date(new Date(now).getTime() + (options.leaseMs ?? 30_000)).toISOString();
    const result = this.#store.db.query(`UPDATE automation_actions SET lease_expires_at = $expiresAt, updated_at = $now
      WHERE id = $id AND status = 'leased' AND leased_by = $runnerId
        AND lease_generation = $fencingToken AND lease_expires_at > $now`).run({
      $id: options.actionId, $runnerId: options.runnerId, $fencingToken: options.fencingToken, $expiresAt: expiresAt, $now: now,
    });
    assertFencedUpdate(result.changes, options.actionId);
    return this.withFencingToken(this.#store.requireQueueEntry(options.actionId));
  }
  async completeActionFenced(options: FencedActionCompletionOptions) {
    try {
      return this.#store.completeActionFenced(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("lease is no longer active")) {
        throw new Error(`stale or expired action lease: ${options.actionId}`);
      }
      throw error;
    }
  }
  async failActionFenced(options: FencedActionFailureOptions) {
    const action = this.#store.requireQueueEntry(options.actionId);
    const nextAttempt = action.attempt + 1;
    const retrying = options.error.retryable !== false && nextAttempt < action.maxAttempts;
    const deadLetter: ActionDeadLetter | undefined = retrying ? undefined : {
      reason: nextAttempt >= action.maxAttempts ? "max attempts exceeded" : "non-retryable action error",
      failedAt: normalizeIso(options.now), lastError: options.error, attempts: nextAttempt, replayable: true,
    };
    return this.writeFencedResult(options, retrying ? "admitted" : "dead", undefined, options.error, nextAttempt, retrying ? (options.retryBackoffMs ?? defaultBackoffMs(nextAttempt)) : undefined, deadLetter);
  }
  async readmitDeadAction(id: string, options = {}) { return this.#store.readmitDeadAction(id, options); }
  async approveAction(id: string, options = {}) { return this.#store.approveAction(id, options); }
  async rejectAction(id: string, options = {}) { return this.#store.rejectAction(id, options); }
  async materializeEvent(event: Parameters<AutomationsStore["materializeEvent"]>[0], options = {}) { return this.#store.materializeEvent(event, options); }
  async materializeWebhookRequest(input: Parameters<AutomationsStore["materializeWebhookRequest"]>[0]) { return this.#store.materializeWebhookRequest(input); }
  async createReplayRequest(input: CreateReplayRequestInput) { return this.#store.createReplayRequest(input); }
  async requireReplayRequest(id: string) { return this.#store.requireReplayRequest(id); }
  async heartbeatDaemon(input: DaemonHeartbeatInput = {}): Promise<DaemonLease> { return this.#store.heartbeatDaemon(input); }
  async latestDaemonLease(): Promise<DaemonLease | undefined> { return this.#store.latestDaemonLease(); }
  async status(now = new Date()) { return this.#store.status(now); }
  private withFencingToken(action: QueuedAction): LeasedQueuedAction {
    const row = this.#store.db.query("SELECT lease_generation FROM automation_actions WHERE id = $id").get({ $id: action.id }) as { lease_generation: number };
    return { ...action, fencingToken: row.lease_generation };
  }
  private async writeFencedResult(options: FencedActionCompletionOptions | FencedActionFailureOptions, status: "succeeded" | "admitted" | "dead", result?: unknown, error?: unknown, attempt?: number, retryBackoffMs?: number, deadLetter?: ActionDeadLetter): Promise<QueuedAction> {
    const now = normalizeIso(options.now);
    const availableAt = new Date(new Date(now).getTime() + (retryBackoffMs ?? 0)).toISOString();
    const update = this.#store.db.query(`UPDATE automation_actions SET status = $status, result_json = $resultJson,
      error_json = $errorJson, dead_letter_json = $deadLetterJson, attempt = COALESCE($attempt, attempt), available_at = $availableAt,
      lease_expires_at = NULL, updated_at = $now
      WHERE id = $id AND status = 'leased' AND leased_by = $runnerId
        AND lease_generation = $fencingToken AND lease_expires_at > $now`).run({
      $id: options.actionId, $runnerId: options.runnerId, $fencingToken: options.fencingToken, $status: status,
      $resultJson: result === undefined ? null : JSON.stringify(result), $errorJson: error === undefined ? null : JSON.stringify(error),
      $deadLetterJson: deadLetter === undefined ? null : JSON.stringify(deadLetter), $attempt: attempt ?? null, $availableAt: availableAt, $now: now,
    });
    assertFencedUpdate(update.changes, options.actionId);
    return this.#store.requireQueueEntry(options.actionId);
  }
}
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1_000;
function pageBy<T extends { id: string; createdAt: string; updatedAt: string }>(
  rows: T[],
  options: ListPageOptions,
  timestampField: "createdAt" | "updatedAt",
): T[] {
  const limit = normalizePageLimit(options.limit);
  const afterAt = options.after ? normalizeIso(options.after.createdAt) : undefined;
  const afterId = options.after?.id;
  return rows
    .sort((left, right) => left[timestampField].localeCompare(right[timestampField]) || left.id.localeCompare(right.id))
    .filter((row) => !afterAt || row[timestampField] > afterAt || (row[timestampField] === afterAt && row.id > afterId!))
    .slice(0, limit);
}
function normalizePageLimit(limit = DEFAULT_PAGE_LIMIT): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(`list limit must be a positive number no greater than ${MAX_PAGE_LIMIT}`);
  }
  return limit;
}
function normalizeIso(value?: string | Date): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${String(value)}`);
  return date.toISOString();
}
function defaultBackoffMs(attempt: number): number { return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)); }
function assertFencedUpdate(changes: number, actionId: string): void {
  if (changes !== 1) throw new Error(`stale or expired action lease: ${actionId}`);
}
