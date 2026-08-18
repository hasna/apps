import type {
  TodosTaskSubtreeTransferApplyRequest,
  TodosTaskSubtreeTransferAuthorityOptions,
  TodosTaskSubtreeTransferInspectRequest,
  TodosTaskSubtreeTransferInspection,
  TodosTaskSubtreeTransferResult,
  TodosTaskSubtreeTransferRollbackRequest,
} from "./types.js";

export interface TodosTaskSubtreeTransferBackend {
  readonly kind: "sqlite" | "postgresql";
  inspect(input: TodosTaskSubtreeTransferInspectRequest): Promise<TodosTaskSubtreeTransferInspection>;
  apply(input: TodosTaskSubtreeTransferApplyRequest, options: TodosTaskSubtreeTransferAuthorityOptions): Promise<TodosTaskSubtreeTransferResult>;
  readExact(receiptId: string): Promise<TodosTaskSubtreeTransferResult>;
  rollback(input: TodosTaskSubtreeTransferRollbackRequest, options: TodosTaskSubtreeTransferAuthorityOptions): Promise<TodosTaskSubtreeTransferResult>;
}
