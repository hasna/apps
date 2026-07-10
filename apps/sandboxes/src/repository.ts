import type {
  OperationRecordV1,
  SandboxEventV1,
  SandboxV1,
  SealedProviderHandleV1,
} from "./types.js";

export interface RepositoryHealthV1 {
  backend: "memory" | "sqlite";
  schema_version: number;
  integrity: "ok";
  sandbox_count: number;
  operation_count: number;
}

export interface SandboxRepositoryTxV1 {
  getSandbox(resourceId: string): SandboxV1 | undefined;
  listSandboxes(): SandboxV1[];
  putSandbox(record: SandboxV1, expectedRevision: number | null): void;
  getHandle(resourceId: string): SealedProviderHandleV1 | undefined;
  putHandle(handle: SealedProviderHandleV1): void;
  getOperation(operationId: string): OperationRecordV1 | undefined;
  findIdempotentOperation(
    actorPrincipal: string,
    operation: string,
    resourceId: string,
    idempotencyKeySha256: string,
  ): OperationRecordV1 | undefined;
  insertOperation(record: OperationRecordV1): void;
  updateOperation(record: OperationRecordV1): void;
  consumeCapabilityUse(capabilityUseSha256: string, operationId: string): void;
  consumeActivationGrant(grantUseSha256: string, operationId: string): void;
  consumeCleanupGrant(grantUseSha256: string, operationId: string): void;
  appendEvent(event: Omit<SandboxEventV1, "sequence">): SandboxEventV1;
  listEvents(resourceId: string): SandboxEventV1[];
}

export interface SandboxRepositoryV1 {
  readonly backend: "memory" | "sqlite";
  migrate(): void;
  transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): T;
  health(): RepositoryHealthV1;
  close(): void;
}
