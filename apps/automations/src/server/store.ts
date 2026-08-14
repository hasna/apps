import type { JsonObject } from "@hasna/actions";
import type {
  ActionCompletionOptions, ActionFailureOptions, AutomationReplayRequest, AutomationRun,
  AutomationsStatus, AutomationSpec, EventEnvelopeLike, MaterializedEventRun,
  MaterializedWebhookRequest, QueueClaimOptions, QueuedAction, WebhookRequestInput,
  WebhookRoute, WebhookRouteStatus,
} from "../types.js";
import type { AutomationsStore, CreateWebhookRouteInput, EnqueueActionInput } from "../lib/store.js";

export interface CreateRunInput {
  id?: string;
  automationId: string;
  trigger: AutomationRun["trigger"];
  triggerEventId?: string;
  idempotencyKey?: string;
  metadata?: JsonObject;
}
export type CreateReplayRequestInput = Omit<AutomationReplayRequest, "id" | "requestedAt"> & { id?: string; requestedAt?: string | Date };
export interface DaemonHeartbeatInput { leaseId?: string; ttlMs?: number; now?: Date; metadata?: JsonObject }
export type DaemonLease = ReturnType<AutomationsStore["heartbeatDaemon"]>;
export interface LeaseMutationOptions { actionId: string; runnerId: string; fenceToken: number; now?: string | Date }
export interface RenewActionLeaseOptions extends LeaseMutationOptions { leaseMs?: number }
export interface FencedActionCompletionOptions extends LeaseMutationOptions { result?: ActionCompletionOptions["result"] }
export interface FencedActionFailureOptions extends LeaseMutationOptions { error: ActionFailureOptions["error"]; retryBackoffMs?: number }
export interface LeasedQueuedAction extends QueuedAction { fenceToken: number }
export interface ListPageOptions {
  limit?: number;
  after?: { createdAt: string | Date; id: string };
}

export interface ServerAutomationsStore {
  close(): Promise<void>;
  createAutomation(spec: AutomationSpec): Promise<ReturnType<AutomationsStore["createAutomation"]>>;
  listAutomations(options?: ListPageOptions): Promise<ReturnType<AutomationsStore["listAutomations"]>>;
  requireAutomation(id: string): Promise<ReturnType<AutomationsStore["requireAutomation"]>>;
  createWebhookRoute(input: CreateWebhookRouteInput): Promise<WebhookRoute>;
  listWebhookRoutes(options?: ListPageOptions): Promise<WebhookRoute[]>;
  countWebhookRoutes(): Promise<number>;
  requireWebhookRoute(idOrPath: string): Promise<WebhookRoute>;
  setWebhookRouteStatus(idOrPath: string, status: WebhookRouteStatus): Promise<WebhookRoute>;
  rotateWebhookRouteSecret(idOrPath: string, secretRef: string): Promise<WebhookRoute>;
  createRun(input: CreateRunInput): Promise<AutomationRun>;
  requireRun(id: string): Promise<AutomationRun>;
  listRuns(options?: ListPageOptions): Promise<AutomationRun[]>;
  enqueueAction(input: EnqueueActionInput): Promise<QueuedAction>;
  requireQueuedAction(id: string): Promise<QueuedAction>;
  listQueuedActions(options?: ListPageOptions): Promise<QueuedAction[]>;
  listDeadActions(options?: ListPageOptions): Promise<QueuedAction[]>;
  claimNextAction(options: QueueClaimOptions): Promise<LeasedQueuedAction | undefined>;
  renewActionLease(options: RenewActionLeaseOptions): Promise<LeasedQueuedAction>;
  completeActionFenced(options: FencedActionCompletionOptions): Promise<QueuedAction>;
  failActionFenced(options: FencedActionFailureOptions): Promise<QueuedAction>;
  requeueDeadAction(id: string, options?: { now?: string | Date; requestedBy?: string; reason?: string }): Promise<QueuedAction>;
  approveAction(id: string, options?: { now?: string | Date; decidedBy?: string; reason?: string }): Promise<QueuedAction>;
  rejectAction(id: string, options?: { now?: string | Date; decidedBy?: string; reason?: string }): Promise<QueuedAction>;
  materializeEvent(event: EventEnvelopeLike, options?: { automationId?: string }): Promise<MaterializedEventRun[]>;
  materializeWebhookRequest(input: WebhookRequestInput): Promise<MaterializedWebhookRequest>;
  createReplayRequest(input: CreateReplayRequestInput): Promise<AutomationReplayRequest>;
  requireReplayRequest(id: string): Promise<AutomationReplayRequest>;
  heartbeatDaemon(input?: DaemonHeartbeatInput): Promise<DaemonLease>;
  latestDaemonLease(): Promise<DaemonLease | undefined>;
  status(now?: Date): Promise<AutomationsStatus>;
}
