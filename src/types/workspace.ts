import type {
  ProjectResourceAuthority as ContractsProjectResourceAuthority,
  ProjectResourceLink as ContractsProjectResourceLink,
  ProjectResourceLinkCollectionV1,
  ProjectResourceLinkInput as ContractsProjectResourceLinkInput,
  ProjectResourceLinkLabels as ContractsProjectResourceLinkLabels,
  ProjectResourceLinkLocator as ContractsProjectResourceLinkLocator,
  ProjectResourceTargetKind as ContractsProjectResourceTargetKind,
} from "@hasna/contracts/schemas";

export const WORKSPACE_STATUSES = ["active", "archived", "deleted"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_KINDS = [
  "open-source",
  "internal-app",
  "platform",
  "company-website",
  "scaffold",
  "community",
  "project",
  "experiment",
  "docs",
  "remote-only",
  "generic",
] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const AGENT_KINDS = ["human", "ai", "service", "cli"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const PROJECT_AGENT_ROLES = ["owner", "maintainer", "contributor", "service", "prompt-agent", "creator"] as const;
export type ProjectAgentRole = (typeof PROJECT_AGENT_ROLES)[number];

export const EVENT_SOURCES = ["cli", "mcp", "agent", "migration", "system"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const AGENT_RUN_STATUSES = ["planned", "running", "completed", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const MACHINE_ROLES = ["mirror-hub", "assignable", "avoid"] as const;
export type MachineRole = (typeof MACHINE_ROLES)[number];

export interface JsonObject {
  [key: string]: unknown;
}

export interface Machine {
  slug: string;
  status: string;
  role: MachineRole;
}

export interface MachineRow {
  slug: string;
  status: string;
  role: string;
}

export interface Root {
  id: string;
  slug: string;
  name: string;
  base_path: string;
  tags: string[];
  default_kind: WorkspaceKind | null;
  default_recipe_id: string | null;
  default_tmux_profile_id: string | null;
  github_org: string | null;
  repo_visibility: "public" | "private" | null;
  path_template: string | null;
  name_template: string | null;
  allowed_recipes: string[];
  allowed_agents: string[];
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface RootRow {
  id: string;
  slug: string;
  name: string;
  base_path: string;
  tags: string;
  default_kind: string | null;
  default_recipe_id: string | null;
  default_tmux_profile_id: string | null;
  github_org: string | null;
  repo_visibility: string | null;
  path_template: string | null;
  name_template: string | null;
  allowed_recipes: string;
  allowed_agents: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRootInput {
  slug?: string;
  name: string;
  base_path: string;
  tags?: string[];
  default_kind?: WorkspaceKind;
  default_recipe_id?: string;
  default_tmux_profile_id?: string;
  github_org?: string;
  repo_visibility?: "public" | "private";
  path_template?: string;
  name_template?: string;
  allowed_recipes?: string[];
  allowed_agents?: string[];
  metadata?: JsonObject;
}

export interface UpdateRootInput {
  slug?: string;
  name?: string;
  base_path?: string;
  tags?: string[];
  default_kind?: WorkspaceKind | null;
  default_recipe_id?: string | null;
  default_tmux_profile_id?: string | null;
  github_org?: string | null;
  repo_visibility?: "public" | "private" | null;
  path_template?: string | null;
  name_template?: string | null;
  allowed_recipes?: string[];
  allowed_agents?: string[];
  metadata?: JsonObject;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  kind: AgentKind;
  provider: string | null;
  model: string | null;
  role: string | null;
  permissions: string[];
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  provider: string | null;
  model: string | null;
  role: string | null;
  permissions: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  slug?: string;
  name: string;
  kind: AgentKind;
  provider?: string;
  model?: string;
  role?: string;
  permissions?: string[];
  metadata?: JsonObject;
}

export interface Recipe {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: WorkspaceKind | null;
  version: number;
  steps: JsonObject[];
  variables: JsonObject;
  default_tags: string[];
  default_tmux_profile_id: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface RecipeRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: string | null;
  version: number;
  steps: string;
  variables: string;
  default_tags: string;
  default_tmux_profile_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRecipeInput {
  slug?: string;
  name: string;
  description?: string;
  kind?: WorkspaceKind;
  version?: number;
  steps?: JsonObject[];
  variables?: JsonObject;
  default_tags?: string[];
  default_tmux_profile_id?: string;
  metadata?: JsonObject;
}

export interface WorkspaceIntegrations {
  github_repo?: string;
  github_url?: string;
  todos_project_id?: string;
  todos_task_list_id?: string;
  brief_id?: string;
  brief_path?: string;
  /** Opaque project/container id owned by the external Canvases product. */
  canvases_project_id?: string;
  /** Opaque default canvas id owned by the external Canvases product. */
  canvases_default_canvas_id?: string;
  mementos_project_id?: string;
  /** Canonical ref for the owning organization node in @hasna/orgs. */
  orgs_org_id?: string;
  /** Canonical ref for the @hasna/orgs project node that points back here. */
  orgs_project_id?: string;
  conversations_space?: string;
  conversations_channel?: string;
  /** Overrides the channel class implied by the project kind. */
  conversations_channel_class?: string;
  files_index_id?: string;
  [key: string]: string | undefined;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  root_id: string | null;
  recipe_id: string | null;
  canonical_machine: string | null;
  primary_path: string | null;
  git_remote: string | null;
  s3_bucket: string | null;
  s3_prefix: string | null;
  tags: string[];
  integrations: WorkspaceIntegrations;
  metadata: JsonObject;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  root_id: string | null;
  recipe_id: string | null;
  canonical_machine: string | null;
  primary_path: string | null;
  git_remote: string | null;
  s3_bucket: string | null;
  s3_prefix: string | null;
  tags: string;
  integrations: string;
  metadata: string;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface CreateWorkspaceInput {
  id?: string;
  name: string;
  slug?: string;
  /**
   * Persist the requested slug exactly and let the authority's unique
   * constraints reject a conflict. Ordinary create keeps its historical
   * suffix-allocation behavior when this is unset.
   */
  require_exact_identity?: boolean;
  description?: string;
  kind?: WorkspaceKind;
  root_id?: string;
  recipe_id?: string;
  primary_path?: string;
  git_remote?: string;
  s3_bucket?: string;
  s3_prefix?: string;
  tags?: string[];
  integrations?: WorkspaceIntegrations;
  metadata?: JsonObject;
  agent_id?: string;
  source?: EventSource;
  prompt?: string;
  command?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string | null;
  kind?: WorkspaceKind;
  status?: WorkspaceStatus;
  root_id?: string | null;
  recipe_id?: string | null;
  canonical_machine?: string | null;
  primary_path?: string | null;
  git_remote?: string | null;
  s3_bucket?: string | null;
  s3_prefix?: string | null;
  tags?: string[];
  integrations?: WorkspaceIntegrations;
  metadata?: JsonObject;
  last_opened_at?: string | null;
  agent_id?: string;
  source?: EventSource;
  prompt?: string;
  command?: string;
}

export type GuardedProjectMutationDirection = "forward" | "inverse";
export type GuardedProjectMutationOutcome = "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance";

export interface GuardedProjectMutationBounds {
  response_byte_limit: number;
  time_budget_ms: number;
}

export interface GuardedProjectMutationControl extends GuardedProjectMutationBounds {
  response_bytes: number;
  elapsed_ms: number;
  complete: boolean;
  truncated: boolean;
}

export interface GuardedProjectReadRequest extends GuardedProjectMutationBounds {
  project_id: string;
  resource_link_max_items?: number;
}

export interface GuardedProjectReadResult {
  ok: true;
  project_id: string;
  project: Workspace;
  current_revision: string;
  resource_links: ProjectResourceLink[];
  resource_link_count: number;
  resource_link_max_items: number;
  resource_link_collection_digest: string;
  response_control: GuardedProjectMutationControl;
}

export interface GuardedProjectMutationReceipt {
  receipt_id: string;
  operation_id: string;
  step_id: string;
  direction: GuardedProjectMutationDirection;
  idempotency_key: string;
  target_id: string;
  request_digest: string;
  precondition_digest: string;
  expected_revision: string;
  outcome: GuardedProjectMutationOutcome;
  reason: string | null;
  result_project_id: string | null;
  duplicate_of_receipt_id: string | null;
  before: JsonObject | null;
  after: JsonObject | null;
  post_revision: string | null;
  created_at: string;
}

export interface GuardedProjectMutationReceiptRow {
  receipt_id: string;
  operation_id: string;
  step_id: string;
  direction: string;
  idempotency_key: string;
  target_id: string;
  request_digest: string;
  precondition_digest: string;
  expected_revision: string;
  outcome: string;
  reason: string | null;
  result_project_id: string | null;
  duplicate_of_receipt_id: string | null;
  before_json: string | null;
  after_json: string | null;
  post_revision: string | null;
  created_at: string;
}

export interface GuardedProjectMutationRequest extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  direction?: GuardedProjectMutationDirection;
  expected_revision: string;
  patch: UpdateWorkspaceInput;
  dry_run?: boolean;
  agent_id?: string;
  source?: EventSource;
  command?: string;
}

export interface GuardedProjectMutationResult {
  ok: boolean;
  dry_run: boolean;
  outcome: GuardedProjectMutationOutcome | "planned";
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  expected_revision: string;
  current_revision: string;
  before: Workspace;
  after: Workspace | null;
  receipt: GuardedProjectMutationReceipt | null;
  response_control: GuardedProjectMutationControl;
}

export interface GuardedProjectMutationReceiptLookupInput extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  direction: GuardedProjectMutationDirection;
  idempotency_key: string;
  max_items: 1;
}

export interface GuardedProjectMutationReceiptLookupResult {
  receipt: GuardedProjectMutationReceipt;
  response_control: GuardedProjectMutationControl;
}

export interface GuardedProjectMutationRollbackRequest extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  accepted_receipt_id: string;
  expected_current_revision: string;
  agent_id?: string;
  source?: EventSource;
  command?: string;
}

export const PROJECT_RESOURCE_AUTHORITIES = ["todos", "conversations", "knowledge", "mementos", "orgs", "contacts"] as const;
export type ProjectResourceAuthority = ContractsProjectResourceAuthority;

export const PROJECT_RESOURCE_LOCATOR_KINDS = [
  "external_uuid",
  "canonical_uri",
  "conversations_channel_id",
] as const;
export type ProjectResourceLocatorKind = (typeof PROJECT_RESOURCE_LOCATOR_KINDS)[number];

export const PROJECT_RESOURCE_LINK_SCOPES = ["resource", "collection"] as const;
export type ProjectResourceLinkScope = (typeof PROJECT_RESOURCE_LINK_SCOPES)[number];
export const PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS = 1_000;

export type ProjectResourceTargetKind = ContractsProjectResourceTargetKind;
export type ProjectResourceLinkLabels = ContractsProjectResourceLinkLabels;
export type ProjectResourceLinkLocator = ContractsProjectResourceLinkLocator;
export type ProjectResourceExternalUuidLocator = Extract<ProjectResourceLinkLocator, { kind: "external_uuid" }>;
export type ProjectResourceLinkInput = ContractsProjectResourceLinkInput;
export type ProjectResourceLink = ContractsProjectResourceLink;
export type { ProjectResourceLinkCollectionV1 };

export interface ProjectResourceLinkRow {
  id: string;
  project_id: string;
  authority: string;
  service_instance: string;
  source_package: string;
  target_kind: string;
  locator_kind: string;
  locator_value: string;
  scope: string;
  labels_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectResourceLinkSnapshot {
  project: Workspace;
  links: ProjectResourceLink[];
  collection_digest: string;
}

export interface ProjectResourceLinkReadRequest extends GuardedProjectMutationBounds {
  project_id: string;
  max_items: number;
}

export interface ProjectResourceLinkReadResult {
  ok: true;
  project_id: string;
  project: Workspace;
  current_revision: string;
  links: ProjectResourceLink[];
  link_count: number;
  max_items: number;
  collection_digest: string;
  complete: true;
  truncated: false;
  contract: ProjectResourceLinkCollectionV1;
  response_control: GuardedProjectMutationControl;
}

export type ProjectResourceLinkMutationMode = "add" | "reconcile";

export interface ProjectResourceLinkMutationRequest extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  mode: ProjectResourceLinkMutationMode;
  expected_revision: string;
  links: ProjectResourceLinkInput[];
  /** Registration-only exact integrations snapshot committed atomically with the links. */
  integrations?: WorkspaceIntegrations;
  max_items?: number;
  dry_run?: boolean;
  agent_id?: string;
  source?: EventSource;
  command?: string;
}

export interface ProjectResourceLinkMutationResult {
  ok: boolean;
  dry_run: boolean;
  outcome: GuardedProjectMutationOutcome | "planned";
  mode: ProjectResourceLinkMutationMode;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  expected_revision: string;
  current_revision: string;
  before: ProjectResourceLinkSnapshot;
  after: ProjectResourceLinkSnapshot | null;
  receipt: GuardedProjectMutationReceipt | null;
  response_control: GuardedProjectMutationControl;
}

export interface ProjectResourceLinkRollbackRequest extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  accepted_receipt_id: string;
  expected_current_revision: string;
  max_items?: number;
  agent_id?: string;
  source?: EventSource;
  command?: string;
}

export const PROJECT_RESOURCE_LINK_MIGRATION_STATES = [
  "planned",
  "producer_applied",
  "projects_applied",
  "verified",
  "rollback_in_progress",
  "rolled_back",
  "retained_target",
  "failed_reconcilable",
] as const;
export type ProjectResourceLinkMigrationState = (typeof PROJECT_RESOURCE_LINK_MIGRATION_STATES)[number];

export interface ProjectResourceLinkProducerBinding {
  authority_id: string;
  tenant_id: string;
  corpus_id: string | null;
  capability_digest: string;
}

export interface ProjectResourceLinkProducerEvidence {
  created_by_operation: boolean;
  forward_receipt_id: string | null;
  child_link_receipt_ids: string[];
  target_revision: string;
  target_digest: string;
  inverse_verified: boolean | null;
  inverse_outcome: string | null;
}

export interface ProjectResourceLinkMigrationItem {
  link: ProjectResourceLinkInput;
  link_id: string;
  producer_resource_kind: string;
  producer_binding: ProjectResourceLinkProducerBinding;
  producer_evidence: ProjectResourceLinkProducerEvidence | null;
}

export type ProjectResourceLinkProjectsReferenceProof =
  | {
      kind: "accepted_inverse";
      forward_receipt_id: string;
      inverse_receipt_id: string;
      verified_revision: string;
      collection_digest: string;
      link_ids_checked: string[];
      complete: true;
      truncated: false;
      request_digest: string;
      precondition_digest: string;
    }
  | {
      kind: "no_projects_write";
      verified_revision: string;
      collection_digest: string;
      link_ids_checked: string[];
      complete: true;
      truncated: false;
      request_digest: string;
      precondition_digest: string;
    };

export interface ProjectResourceLinkMigrationManifestV1 {
  schema: "projects.project_resource_link_migration_manifest.v1";
  manifest_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  state: ProjectResourceLinkMigrationState;
  expected_project_revision: string;
  desired_collection_digest: string;
  links: ProjectResourceLinkMigrationItem[];
  projects_forward_receipt_id: string | null;
  projects_inverse_receipt_id: string | null;
  projects_reference_proof: ProjectResourceLinkProjectsReferenceProof | null;
  last_verified_projects_revision: string | null;
  last_verified_projects_digest: string | null;
  transition_version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectResourceLinkMigrationManifestRow {
  manifest_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  state: string;
  expected_project_revision: string;
  desired_collection_digest: string;
  links_json: string;
  projects_forward_receipt_id: string | null;
  projects_inverse_receipt_id: string | null;
  projects_reference_proof_json: string | null;
  last_verified_projects_revision: string | null;
  last_verified_projects_digest: string | null;
  transition_version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectResourceLinkMigrationEvent {
  event_id: string;
  manifest_id: string;
  transition_version: number;
  from_state: ProjectResourceLinkMigrationState | null;
  to_state: ProjectResourceLinkMigrationState;
  request_digest: string;
  precondition_digest: string;
  evidence: JsonObject;
  created_at: string;
}

export interface ProjectResourceLinkMigrationPlanRequest extends GuardedProjectMutationBounds {
  project_id: string;
  operation_id: string;
  step_id: string;
  expected_project_revision: string;
  links: Array<Omit<ProjectResourceLinkMigrationItem, "link_id" | "producer_evidence">>;
  max_items?: number;
}

export interface ProjectResourceLinkMigrationReadRequest extends GuardedProjectMutationBounds {
  project_id: string;
  manifest_id: string;
  max_items?: number;
}

export interface ProjectResourceLinkMigrationAdvanceRequest extends GuardedProjectMutationBounds {
  project_id: string;
  manifest_id: string;
  expected_transition_version: number;
  next_state: "producer_applied" | "projects_applied" | "verified" | "failed_reconcilable";
  producer_evidence?: ProjectResourceLinkProducerEvidence[];
  projects_forward_receipt_id?: string;
  last_verified_projects_revision?: string;
  last_verified_projects_digest?: string;
  evidence: JsonObject;
}

export interface ProjectResourceLinkMigrationRollbackRequest extends GuardedProjectMutationBounds {
  project_id: string;
  manifest_id: string;
  expected_transition_version: number;
  max_items?: number;
  producer_outcome: "pending" | "complete" | "retained_target" | "failed_reconcilable";
  evidence: JsonObject;
  agent_id?: string;
  source?: EventSource;
  command?: string;
}

export interface ProjectResourceLinkMigrationResult {
  ok: boolean;
  outcome: "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance";
  manifest: ProjectResourceLinkMigrationManifestV1;
  events: ProjectResourceLinkMigrationEvent[];
  response_control: GuardedProjectMutationControl;
}

export interface WorkspaceLocation {
  id: string;
  workspace_id: string;
  path: string;
  machine_id: string;
  label: string;
  kind: string;
  is_primary: boolean;
  exists_at_create: boolean;
  metadata: JsonObject;
  created_at: string;
}

export interface WorkspaceLocationRow {
  id: string;
  workspace_id: string;
  path: string;
  machine_id: string;
  label: string;
  kind: string;
  is_primary: number;
  exists_at_create: number;
  metadata: string;
  created_at: string;
}

export interface WorkspaceAgentAssignment {
  id: string;
  workspace_id: string;
  agent_id: string;
  role: string;
  assigned_by: string | null;
  metadata: JsonObject;
  created_at: string;
  agent: Agent | null;
}

export interface WorkspaceAgentAssignmentRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  role: string;
  assigned_by: string | null;
  metadata: string;
  created_at: string;
}

export interface WorkspaceEvent {
  id: string;
  workspace_id: string | null;
  agent_id: string | null;
  event_type: string;
  source: EventSource;
  prompt: string | null;
  command: string | null;
  before_json: JsonObject | null;
  after_json: JsonObject | null;
  metadata: JsonObject;
  created_at: string;
}

export interface WorkspaceEventRow {
  id: string;
  workspace_id: string | null;
  agent_id: string | null;
  event_type: string;
  source: string;
  prompt: string | null;
  command: string | null;
  before_json: string | null;
  after_json: string | null;
  metadata: string;
  created_at: string;
}

export interface RecordWorkspaceEventInput {
  workspace_id?: string;
  agent_id?: string;
  event_type: string;
  source: EventSource;
  prompt?: string;
  command?: string;
  before?: JsonObject | null;
  after?: JsonObject | null;
  metadata?: JsonObject;
}

export interface AgentRun {
  id: string;
  agent_id: string | null;
  workspace_id: string | null;
  provider: string | null;
  model: string | null;
  prompt: string;
  status: AgentRunStatus;
  plan_json: JsonObject | null;
  tool_calls_json: JsonObject[];
  result_json: JsonObject | null;
  error: string | null;
  metadata: JsonObject;
  started_at: string;
  completed_at: string | null;
}

export interface AgentRunRow {
  id: string;
  agent_id: string | null;
  workspace_id: string | null;
  provider: string | null;
  model: string | null;
  prompt: string;
  status: string;
  plan_json: string | null;
  tool_calls_json: string;
  result_json: string | null;
  error: string | null;
  metadata: string;
  started_at: string;
  completed_at: string | null;
}

export interface TmuxProfile {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  session_template: string;
  attach: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface TmuxProfileRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  session_template: string;
  attach: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTmuxProfileInput {
  slug?: string;
  name: string;
  description?: string;
  session_template?: string;
  attach?: boolean;
  metadata?: JsonObject;
  windows?: CreateTmuxProfileWindowInput[];
}

export interface TmuxProfileWindow {
  id: string;
  profile_id: string;
  window_name_template: string;
  path_template: string | null;
  command: string | null;
  window_index: number | null;
  detached: boolean;
  env: Record<string, string>;
  revive: boolean;
  created_at: string;
}

export interface TmuxProfileWindowRow {
  id: string;
  profile_id: string;
  window_name_template: string;
  path_template: string | null;
  command: string | null;
  window_index: number | null;
  detached: number;
  env: string;
  revive: number;
  created_at: string;
}

export interface CreateTmuxProfileWindowInput {
  profile_id?: string;
  window_name_template: string;
  path_template?: string;
  command?: string;
  window_index?: number;
  detached?: boolean;
  env?: Record<string, string>;
  revive?: boolean;
}

export interface WorkspaceLock {
  id: string;
  lock_key: string;
  workspace_id: string | null;
  agent_id: string | null;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface WorkspaceLockRow {
  id: string;
  lock_key: string;
  workspace_id: string | null;
  agent_id: string | null;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
}
