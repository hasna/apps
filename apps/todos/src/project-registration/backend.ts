import type {
  CreateProjectInput,
  CreateTaskListInput,
  Project,
  TaskList,
} from "../types/index.js";
import type {
  TodosProjectRegistrationDirection,
  TodosProjectRegistrationReceipt,
  TodosProjectRegistrationResourceKind,
} from "./types.js";

export interface TodosProjectRegistrationReceiptRow
  extends TodosProjectRegistrationReceipt {
  target_selector: string;
  normalized_call_digest: string;
}

export interface TodosProjectRegistrationAuthorityScope {
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
}

export type TodosProjectRegistrationBindingState =
  | "pending"
  | "accepted"
  | "terminal_nonacceptance"
  | "removed";

export interface TodosProjectRegistrationBindingRow
  extends TodosProjectRegistrationAuthorityScope {
  resource_kind: TodosProjectRegistrationResourceKind;
  target_selector: string;
  operation_id: string;
  step_id: string;
  direction: "forward";
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  normalized_call_digest: string;
  state: TodosProjectRegistrationBindingState;
  target_id: string | null;
  accepted_receipt_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  removed_receipt_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodosProjectRegistrationCallIdentity
  extends TodosProjectRegistrationAuthorityScope {
  operation_id: string;
  step_id: string;
  resource_kind: TodosProjectRegistrationResourceKind;
  direction: TodosProjectRegistrationDirection;
  idempotency_key: string;
  target_selector: string;
}

export interface TodosProjectRegistrationStepIdentity
  extends TodosProjectRegistrationAuthorityScope {
  operation_id: string;
  step_id: string;
  resource_kind: TodosProjectRegistrationResourceKind;
  direction: TodosProjectRegistrationDirection;
}

export interface TodosProjectRegistrationBackendTransaction {
  lockStep(identity: TodosProjectRegistrationStepIdentity): Promise<void>;
  getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null>;
  getReceiptById(
    receiptId: string,
  ): Promise<TodosProjectRegistrationReceiptRow | null>;
  getAcceptedReceiptForStep(
    identity: TodosProjectRegistrationStepIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null>;
  insertReceipt(receipt: TodosProjectRegistrationReceiptRow): Promise<boolean>;

  getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null>;
  claimBinding(binding: TodosProjectRegistrationBindingRow): Promise<boolean>;
  setBindingAccepted(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    update: {
      target_id: string;
      accepted_receipt_id: string;
      result_revision: string;
      result_digest: string;
      updated_at: string;
    },
  ): Promise<void>;
  setBindingTerminal(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    updatedAt: string,
  ): Promise<void>;
  setBindingRemoved(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    removedReceiptId: string,
    updatedAt: string,
  ): Promise<void>;

  findProjectConflict(path: string, taskListSlug: string): Promise<Project | null>;
  findTaskListConflict(projectId: string, slug: string): Promise<TaskList | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  createTaskList(input: CreateTaskListInput): Promise<TaskList>;
  getProject(id: string): Promise<Project | null>;
  getTaskList(id: string): Promise<TaskList | null>;
  lockCompensationWrites(): Promise<void>;
  hasDependents(
    resourceKind: TodosProjectRegistrationResourceKind,
    targetId: string,
  ): Promise<boolean>;
  deleteProject(id: string): Promise<boolean>;
  deleteTaskList(id: string): Promise<boolean>;
}

export interface TodosProjectRegistrationBackend {
  readonly kind: "sqlite" | "postgresql";
  transaction<T>(
    fn: (transaction: TodosProjectRegistrationBackendTransaction) => Promise<T>,
  ): Promise<T>;
  getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null>;
  getReceiptById(
    receiptId: string,
  ): Promise<TodosProjectRegistrationReceiptRow | null>;
  getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null>;
  getProject(id: string): Promise<Project | null>;
  getTaskList(id: string): Promise<TaskList | null>;
}
