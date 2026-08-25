// @generated from openapi/loops.json by scripts/gen-sdk.ts — DO NOT EDIT.
// Regenerate: bun run scripts/gen-sdk.ts
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Loops 0.5.1

export interface PublicValidationDetails { "code": string; "reason": "not_array" | "invalid_array" | "invalid_item" | "option_not_allowed"; "path": string; "index"?: number; "option"?: string }

export interface ValidationFailureResponse { "ok": boolean; "error": string; "details"?: PublicValidationDetails }

export interface InvalidLoopStatusResponse { "ok": boolean; "error": string }

export interface AmbiguousNameResponse { "ok": boolean; "error": string }

export interface InvalidJsonResponse { "ok": boolean; "error": string }

export interface UnsupportedMediaTypeResponse { "ok": boolean; "error": string }

export interface InvalidWorkflowRecoveryBodyResponse { "ok": boolean; "error": string }

export interface WorkflowRecoveryConflictResponse { "ok": boolean; "error": "workflow_run_has_live_steps" | "workflow_run_step_ownership_unverifiable" | "workflow_run_not_running" }

export interface RunFinalizeConflictResponse { "ok": boolean; "error": "stale_claim" | "run_not_running" | "loop_advancement_conflict" }

export interface RunFinalizeValidationResponse { "ok": boolean; "error": "status_required" | "skip_status_requires_overlap_skip_exit_75" }

export interface StuckRunCandidate { "runId": string; "loopId": string; "snapshotId": string }

export interface StuckRunReportResponse { "ok": boolean; "report": { "state": "clear" | "stuck"; "expiredBefore": string; "candidates": Array<StuckRunCandidate>; "truncated": boolean } }

export interface StuckRunReconciliationInput { "candidates": Array<StuckRunCandidate> }

export interface StuckRunReconciliationOutcome { "runId": string; "outcome": "recovered" | "already_recovered" | "conflict" | "operation_reconciliation_required"; "reason"?: string }

export interface StuckRunReconciliationResponse { "ok": boolean; "reconciliation": { "outcomes": Array<StuckRunReconciliationOutcome> } }

export interface Foundation { "status": string; "version": string; "storage": "sqlite" | "postgresql"; "connection": "file" | "api"; "service"?: string; "detail"?: string }

export interface Loop { "id": string; "name": string; "description"?: string | null; "labels": Array<string>; "status": "active" | "paused" | "stopped" | "expired"; "schedule"?: Record<string, unknown>; "target"?: Record<string, unknown>; "nextRunAt"?: string | null; "expiresAfterRuns"?: number | null; "createdAt"?: string; "updatedAt"?: string; "machine"?: LoopMachineRef }

export interface CreateLoopInput { "name": string; "description"?: string; "labels"?: Array<string>; "schedule": Record<string, unknown>; "target": Record<string, unknown>; "expiresAfterRuns"?: number | null; "machine"?: LoopMachineRef }

export interface UpdateLoopInput { "status"?: "active" | "paused" | "stopped" | "expired"; "nextRunAt"?: string | null; "retryScheduledFor"?: string | null; "expiresAt"?: string | null; "expiresAfterRuns"?: number | null; "maxAttempts"?: number; "leaseMs"?: number; "labels"?: Array<string> }

export interface LoopMutationEnvelope { "schema": string; "operationId": string; "stepId": string; "targetId": string; "action": "pause" | "resume" | "stop"; "expectedRevision": string; "approvedPlanDigest": string; "manifestDigest": string; "descriptorRef": string; "descriptorDigest": string; "dryRun"?: boolean }

export interface LoopMutationBinding { "schema": string; "operationId": string; "stepId": string; "targetId": string; "action": "pause" | "resume" | "stop"; "expectedRevision": string; "approvedPlanDigest": string; "manifestDigest": string; "descriptorCommitment": string; "descriptorDigest": string; "dryRun"?: boolean; "authority": { "authorityId": string; "tenantId": string }; "bindingDigest": string; "leaseId": string }

export interface LoopMutationAdmissionReceipt { "schema": string; "receiptId": string; "receiptKind": string; "state": string; "bindingDigest": string; "operationId": string; "stepId": string; "targetId": string; "action": "pause" | "resume" | "stop"; "expectedRevision": string; "authority": { "authorityId": string; "tenantId": string }; "descriptorCommitment": string; "descriptorDigest": string; "createdAt": string }

export interface LoopMutationTerminalReceipt { "schema": string; "receiptId": string; "receiptKind": string; "state": "succeeded" | "dry_run"; "bindingDigest": string; "resultRevision": string; "resultStatus": "active" | "paused" | "stopped" | "expired" }

export interface LoopMutationResponse { "ok": boolean; "mutation": { "binding": LoopMutationBinding; "admission": LoopMutationAdmissionReceipt; "terminal": LoopMutationTerminalReceipt; "loop": Loop; "replayed": boolean } }

export interface Run { "id": string; "loopId": string; "status": string; "attempt"?: number; "scheduledFor"?: string; "startedAt"?: string | null; "finishedAt"?: string | null }

export interface LoopResponse { "ok": boolean; "loop": Loop }

export interface LoopListResponse { "ok": boolean; "loops": Array<Loop> }

export interface RunResponse { "ok": boolean; "run": Run }

export interface RunListResponse { "ok": boolean; "runs": Array<Run> }

export interface DeleteResponse { "ok": boolean; "deleted": boolean }

export type RunReceiptMachine = string | Record<string, unknown>;

export interface RunReceiptSummary { "text"?: string; "stdout_bytes": number; "stderr_bytes": number; "stdout_excerpt"?: string; "stderr_excerpt"?: string; "error"?: string; "duration_ms"?: number }

export interface RunReceipt { "loop_id": string; "run_id": string; "machine": RunReceiptMachine; "repo": string; "task_ids": Array<string>; "knowledge_ids": Array<string>; "digest_id": string; "started_at": string | null; "finished_at": string | null; "status": string; "exit_code": number | null; "summary": RunReceiptSummary; "evidence_paths": Array<string>; "created_at": string; "updated_at": string }

export interface WriteRunReceiptInput { "loop_id"?: string; "run_id": string; "machine"?: RunReceiptMachine; "repo"?: string; "task_ids"?: Array<string>; "knowledge_ids"?: Array<string>; "digest_id"?: string; "started_at"?: string | null; "finished_at"?: string | null; "status"?: string; "exit_code"?: number | null; "summary"?: string | RunReceiptSummary | null; "evidence_paths"?: Array<string>; "stdout"?: string; "stderr"?: string; "error"?: string; "duration_ms"?: number }

export interface RunReceiptResponse { "ok": boolean; "receipt": RunReceipt }

export interface RunReceiptListResponse { "ok": boolean; "receipts": Array<RunReceipt> }

export interface Workflow { "id": string; "name": string; "description"?: string | null; "version": number; "status": string; "steps": Array<Record<string, unknown>>; "goal"?: Record<string, unknown>; "createdAt"?: string; "updatedAt"?: string }

export interface CreateWorkflowInput { "name": string; "description"?: string; "steps": Array<Record<string, unknown>>; "goal"?: Record<string, unknown> }

export interface WorkflowResponse { "ok": boolean; "workflow": Workflow }

export interface WorkflowListResponse { "ok": boolean; "workflows": Array<Workflow> }

export interface CreateWorkflowInvocationInput { "id"?: string; "workflowId"?: string; "templateId"?: string; "sourceRef": Record<string, unknown>; "subjectRef": Record<string, unknown>; "intent": string; "scope"?: Record<string, unknown>; "outputPolicy"?: Record<string, unknown> }

export type WorkflowInvocation = CreateWorkflowInvocationInput & { "id": string; "createdAt": string; "updatedAt": string };

export interface WorkflowInvocationResponse { "ok": boolean; "invocation": WorkflowInvocation }

export interface WorkflowInvocationListResponse { "ok": boolean; "invocations": Array<WorkflowInvocation> }

export interface WorkflowWorkItem { "id": string; "routeKey": string; "idempotencyKey": string; "invocationId": string; "sourceType": string; "sourceRef": string; "subjectRef": string; "status": string; "priority": number; "createdAt"?: string; "updatedAt"?: string }

export interface UpsertWorkflowWorkItemInput { "id"?: string; "routeKey": string; "idempotencyKey": string; "invocationId": string; "sourceType": string; "sourceRef": string; "subjectRef": string; "projectKey"?: string; "projectGroup"?: string; "machineId"?: string; "routeScope"?: string; "priority"?: number; "status"?: "queued" | "deferred"; "nextAttemptAt"?: string; "lastReason"?: string }

export interface WorkflowWorkItemResponse { "ok": boolean; "workItem": WorkflowWorkItem }

export interface WorkflowWorkItemListResponse { "ok": boolean; "workItems": Array<WorkflowWorkItem> }

export interface ImportInput { "workflows"?: Array<Record<string, unknown>>; "loops"?: Array<Record<string, unknown>>; "runs"?: Array<Record<string, unknown>>; "replace"?: boolean; "preserveLoopScheduling"?: boolean; "preserveWorkflowActivation"?: boolean }

export interface ImportResponse { "ok": boolean; "imported": { "workflows": number; "loops": number; "runs": number }; "skippedRunning": number }

export interface AgentSessionContract { "version": 1; "provider": "claude" | "cursor" | "codewith" | "codex" | "aicopilot" | "opencode"; "model"?: string; "cwd"?: string; "permissionMode": "default" | "plan" | "auto" | "bypass"; "sandbox": "read-only" | "workspace-write" | "danger-full-access" | "enabled" | "disabled" | "provider-default"; "manualBreakGlass": boolean; "routing"?: { "projectPath"?: string; "projectGroup"?: string; "taskId"?: string; "eventId"?: string; "eventType"?: string; "eventSource"?: string; "role"?: "triage" | "planner" | "worker" | "verifier" }; "timeoutMs": number | null; "restrictions": { "tools"?: Array<string>; "commands"?: Array<string>; "enforcement": "metadata_only"; "providerEnforced": false }; "safetyReason"?: string }

export interface AgentSessionContractEventInput { "claimToken": string; "eventType": "agent_session_contract"; "stepId": string; "payload": AgentSessionContract }

export interface GenericWorkflowEvent { "id": string; "workflowRunId": string; "sequence": number; "eventType": "created" | "workflow_archived" | "todos_workflow_pointers_synced" | "todos_workflow_pointers_sync_failed" | "step_started" | "step_progress" | "recovered" | "step_pending" | "step_running" | "step_succeeded" | "step_failed" | "step_timed_out" | "step_skipped" | "step_cancelled" | "succeeded" | "failed" | "timed_out" | "cancelled"; "stepId"?: string; "payload"?: Record<string, unknown>; "createdAt": string }

export interface AgentSessionContractWorkflowEvent { "id": string; "workflowRunId": string; "sequence": number; "eventType": "agent_session_contract"; "stepId": string; "payload": AgentSessionContract; "createdAt": string }

export interface CustomWorkflowEvent { "id": string; "workflowRunId": string; "sequence": number; "eventKind": "custom"; "eventType": string; "stepId"?: string; "payload"?: Record<string, unknown>; "createdAt": string }

export type WorkflowEvent = AgentSessionContractWorkflowEvent | GenericWorkflowEvent | CustomWorkflowEvent;

export interface WorkflowEventResponse { "ok": boolean; "event": WorkflowEvent }

export interface WorkflowEventListResponse { "ok": boolean; "events": Array<WorkflowEvent> }

export interface CountResponse { "ok": boolean; "count": number }

export interface LoopMachineRef { "id": string; "route"?: string; "local"?: boolean; "confidence"?: "exact" | "high" | "medium" | "low" | "none"; "packageVersion"?: string; "warnings"?: Array<string> }

export interface LoopsClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class LoopsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: LoopsClientOptions) {
    if (!options.baseUrl) throw new Error("LoopsClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** Liveness probe */
    async healthCheck(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async healthzProbe(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/healthz`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async openapiJsonProbe(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/openapi.json`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (storage reachable + migrated) */
    async readyCheck(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async readyzProbe(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/readyz`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** status.read */
    async statusRead(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/status`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** api.read */
    async apiRead(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** goalRuns.list */
    async goalRunsList(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/goal-runs`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** goals.list */
    async goalsList(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/goals`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** goals.get */
    async goalsGet(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/goals/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** goals.planNodes */
    async goalsPlanNodes(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/goals/${encodeURIComponent(String(id))}/plan-nodes`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** history.prune */
    async historyPrune(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/history/prune`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Bulk id-preserving import (control-plane backfill) */
    async importRows(body: ImportInput, init?: RequestInit): Promise<ImportResponse> {
      return this.request("POST", `/v1/import`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List workflow route invocations */
    async listWorkflowInvocations(query?: { "limit"?: number }, init?: RequestInit): Promise<WorkflowInvocationListResponse> {
      return this.request("GET", `/v1/invocations`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create an id-preserving workflow route invocation */
    async createWorkflowInvocation(body: CreateWorkflowInvocationInput, init?: RequestInit): Promise<WorkflowInvocationResponse> {
      return this.request("POST", `/v1/invocations`, {
        body,
        query: undefined,
        init,
      });
    }

    /** invocations.get */
    async invocationsGet(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/invocations/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Reconcile exact hosted stuck-run snapshots without blind effect replay */
    async leasesReconcile(body: StuckRunReconciliationInput, init?: RequestInit): Promise<StuckRunReconciliationResponse> {
      return this.request("POST", `/v1/leases/reconcile`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Legacy server-selected lease recovery */
    async leasesRecover(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/leases/recover`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Detect hosted runs whose leases are safely past the recovery grace period */
    async leasesStuck(query?: { "expiredBefore"?: string; "limit"?: number }, init?: RequestInit): Promise<StuckRunReportResponse> {
      return this.request("GET", `/v1/leases/stuck`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Reconcile one exact tenant-bound loop mutation result under explicit lookup caps */
    async getLoopMutation(operationId: string, stepId: string, query?: { "maxCalls"?: number; "maxRecords"?: number; "maxBytes"?: number; "maxWallMs"?: number }, init?: RequestInit): Promise<LoopMutationResponse> {
      return this.request("GET", `/v1/loop-mutations/${encodeURIComponent(String(operationId))}/${encodeURIComponent(String(stepId))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List loops */
    async listLoops(query?: { "status"?: "active" | "paused" | "stopped" | "expired"; "limit"?: number; "offset"?: number; "includeArchived"?: boolean; "archived"?: boolean; "labels"?: Array<string> }, init?: RequestInit): Promise<LoopListResponse> {
      return this.request("GET", `/v1/loops`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a loop */
    async createLoop(body: CreateLoopInput, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Count loops (total-row verification) */
    async countLoops(query?: { "status"?: string; "includeArchived"?: boolean; "archived"?: boolean }, init?: RequestInit): Promise<CountResponse> {
      return this.request("GET", `/v1/loops/count`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a loop by id */
    async getLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("GET", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a loop */
    async deleteLoop(id: string, init?: RequestInit): Promise<DeleteResponse> {
      return this.request("DELETE", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a loop (status / schedule fields) */
    async updateLoop(id: string, body: UpdateLoopInput, init?: RequestInit): Promise<LoopResponse> {
      return this.request("PATCH", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Archive a loop by id or name */
    async archiveLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/archive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Apply a full-id, tenant-bound loop mutation with CAS and exactly-once receipts */
    async mutateLoop(id: string, body: LoopMutationEnvelope, init?: RequestInit): Promise<LoopMutationResponse> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/mutations`, {
        body,
        query: undefined,
        init,
      });
    }

    /** loops.rename */
    async loopsRename(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/rename`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Unarchive a loop by id or name */
    async unarchiveLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/unarchive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List run receipts */
    async listRunReceipts(query?: { "loopId"?: string; "repo"?: string; "taskId"?: string; "knowledgeId"?: string; "status"?: string; "limit"?: number }, init?: RequestInit): Promise<RunReceiptListResponse> {
      return this.request("GET", `/v1/receipts`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Write a run receipt */
    async writeRunReceipt(body: WriteRunReceiptInput, init?: RequestInit): Promise<RunReceiptResponse> {
      return this.request("POST", `/v1/receipts`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a run receipt by run id */
    async getRunReceipt(runId: string, init?: RequestInit): Promise<RunReceiptResponse> {
      return this.request("GET", `/v1/receipts/${encodeURIComponent(String(runId))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** runners.claim */
    async runnersClaim(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runners/claim`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runners.poll */
    async runnersPoll(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runners/poll`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List runs */
    async listRuns(query?: { "loopId"?: string; "status"?: string; "labels"?: Array<string>; "limit"?: number; "offset"?: number; "showOutput"?: boolean }, init?: RequestInit): Promise<RunListResponse> {
      return this.request("GET", `/v1/runs`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Count runs (total-row verification) */
    async countRuns(query?: { "status"?: string; "loopId"?: string; "labels"?: string }, init?: RequestInit): Promise<CountResponse> {
      return this.request("GET", `/v1/runs/count`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a run by id */
    async getRun(id: string, query?: { "showOutput"?: boolean }, init?: RequestInit): Promise<RunResponse> {
      return this.request("GET", `/v1/runs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** runs.evidence */
    async runsEvidence(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/evidence`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.finalize */
    async runsFinalize(id: string, body: { "claimToken": string; "status": "succeeded" | "failed" | "timed_out" | "skipped"; "finishedAt"?: string; "durationMs"?: number; "stdout"?: string; "stderr"?: string; "error"?: string; "exitCode"?: number; "pid"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/finalize`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Create */
    async runsGoalsCreate(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Find */
    async runsGoalsFind(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/find`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Events */
    async runsGoalsEvents(id: string, goalId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/events`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Get */
    async runsGoalsGet(id: string, goalId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/get`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Plan.Nodes.Create */
    async runsGoalsPlanNodesCreate(id: string, goalId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/plan-nodes`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Plan.Nodes.List */
    async runsGoalsPlanNodesList(id: string, goalId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/plan-nodes/list`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Plan.Nodes.Update */
    async runsGoalsPlanNodesUpdate(id: string, goalId: string, key: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/plan-nodes/${encodeURIComponent(String(key))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.Goals.Status */
    async runsGoalsStatus(id: string, goalId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/goals/${encodeURIComponent(String(goalId))}/status`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.heartbeat */
    async runsHeartbeat(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/heartbeat`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.recover */
    async runsRecover(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/recover`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.create */
    async runsWorkflowRunsCreate(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Validate a legacy runner-authored agent session contract */
    async runsWorkflowRunsEvents(id: string, workflowRunId: string, body: AgentSessionContractEventInput, init?: RequestInit): Promise<WorkflowEventResponse> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/events`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.finalize */
    async runsWorkflowRunsFinalize(id: string, workflowRunId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/finalize`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.get */
    async runsWorkflowRunsGet(id: string, workflowRunId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/get`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.recover */
    async runsWorkflowRunsRecover(id: string, workflowRunId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/recover`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.steps */
    async runsWorkflowRunsSteps(id: string, workflowRunId: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/steps`, {
        body,
        query: undefined,
        init,
      });
    }

    /** runs.workflowRuns.stepAction */
    async runsWorkflowRunsStepAction(id: string, workflowRunId: string, stepId: string, action: "get" | "start" | "pid" | "progress" | "skip" | "finalize", body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/runs/${encodeURIComponent(String(id))}/workflow-runs/${encodeURIComponent(String(workflowRunId))}/steps/${encodeURIComponent(String(stepId))}/${encodeURIComponent(String(action))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** api.status */
    async apiStatus(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/status`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async v1VersionProbe(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List workflow route work items */
    async listWorkflowWorkItems(query?: { "status"?: string; "routeKey"?: string; "limit"?: number }, init?: RequestInit): Promise<WorkflowWorkItemListResponse> {
      return this.request("GET", `/v1/work-items`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Upsert an id-preserving workflow route work item */
    async upsertWorkflowWorkItem(body: UpsertWorkflowWorkItemInput, init?: RequestInit): Promise<WorkflowWorkItemResponse> {
      return this.request("POST", `/v1/work-items`, {
        body,
        query: undefined,
        init,
      });
    }

    /** workItems.get */
    async workItemsGet(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/work-items/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** workflowRuns.list */
    async workflowRunsList(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/workflow-runs`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** workflowRuns.get */
    async workflowRunsGet(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/workflow-runs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** workflowRuns.events */
    async workflowRunsEvents(id: string, init?: RequestInit): Promise<WorkflowEventListResponse> {
      return this.request("GET", `/v1/workflow-runs/${encodeURIComponent(String(id))}/events`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** workflowRuns.recover */
    async workflowRunsRecover(id: string, body?: { "reason"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/workflow-runs/${encodeURIComponent(String(id))}/recover`, {
        body,
        query: undefined,
        init,
      });
    }

    /** workflowRuns.steps */
    async workflowRunsSteps(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/workflow-runs/${encodeURIComponent(String(id))}/steps`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List workflow specs */
    async listWorkflows(query?: { "status"?: "active" | "archived"; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<WorkflowListResponse> {
      return this.request("GET", `/v1/workflows`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a workflow spec */
    async createWorkflow(body: CreateWorkflowInput, init?: RequestInit): Promise<WorkflowResponse> {
      return this.request("POST", `/v1/workflows`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Count workflow specs */
    async countWorkflows(query?: { "status"?: string }, init?: RequestInit): Promise<CountResponse> {
      return this.request("GET", `/v1/workflows/count`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a workflow spec by id */
    async getWorkflow(id: string, init?: RequestInit): Promise<WorkflowResponse> {
      return this.request("GET", `/v1/workflows/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** workflows.archive */
    async workflowsArchive(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/workflows/${encodeURIComponent(String(id))}/archive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Service version */
    async getVersion(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
