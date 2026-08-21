import * as z from "zod/v4";
export declare const TODOS_ERROR_CODES: readonly ["TODOS_INVALID_INPUT", "TODOS_AUTHENTICATION_FAILED", "TODOS_SCOPE_REQUIRED", "TODOS_TENANT_MISMATCH", "TODOS_ACCESS_DENIED", "TODOS_NOT_FOUND", "TODOS_AMBIGUOUS_REFERENCE", "TODOS_VERSION_CONFLICT", "TODOS_RESOURCE_CONFLICT", "TODOS_LOCK_CONFLICT", "TODOS_PRECONDITION_FAILED", "TODOS_APPROVAL_REQUIRED", "TODOS_CAPABILITY_REQUIRED", "TODOS_OPERATION_UNSUPPORTED", "TODOS_IDEMPOTENCY_REQUIRED", "TODOS_IDEMPOTENCY_CONFLICT", "TODOS_RATE_LIMITED", "TODOS_QUOTA_EXCEEDED", "TODOS_UPGRADE_REQUIRED", "TODOS_AUTHORITY_MISMATCH", "TODOS_AUTHORITY_UNAVAILABLE", "TODOS_INTERNAL", "TODOS_TRANSFER_INVALID", "TODOS_TRANSFER_CHECKSUM_MISMATCH", "TODOS_TRANSFER_REFERENCE_MISSING", "TODOS_PROJECTION_PREDECESSOR_CONFLICT"];
export declare const TodosErrorCodeSchema: z.ZodEnum<{
    TODOS_INVALID_INPUT: "TODOS_INVALID_INPUT";
    TODOS_AUTHENTICATION_FAILED: "TODOS_AUTHENTICATION_FAILED";
    TODOS_SCOPE_REQUIRED: "TODOS_SCOPE_REQUIRED";
    TODOS_TENANT_MISMATCH: "TODOS_TENANT_MISMATCH";
    TODOS_ACCESS_DENIED: "TODOS_ACCESS_DENIED";
    TODOS_NOT_FOUND: "TODOS_NOT_FOUND";
    TODOS_AMBIGUOUS_REFERENCE: "TODOS_AMBIGUOUS_REFERENCE";
    TODOS_VERSION_CONFLICT: "TODOS_VERSION_CONFLICT";
    TODOS_RESOURCE_CONFLICT: "TODOS_RESOURCE_CONFLICT";
    TODOS_LOCK_CONFLICT: "TODOS_LOCK_CONFLICT";
    TODOS_PRECONDITION_FAILED: "TODOS_PRECONDITION_FAILED";
    TODOS_APPROVAL_REQUIRED: "TODOS_APPROVAL_REQUIRED";
    TODOS_CAPABILITY_REQUIRED: "TODOS_CAPABILITY_REQUIRED";
    TODOS_OPERATION_UNSUPPORTED: "TODOS_OPERATION_UNSUPPORTED";
    TODOS_IDEMPOTENCY_REQUIRED: "TODOS_IDEMPOTENCY_REQUIRED";
    TODOS_IDEMPOTENCY_CONFLICT: "TODOS_IDEMPOTENCY_CONFLICT";
    TODOS_RATE_LIMITED: "TODOS_RATE_LIMITED";
    TODOS_QUOTA_EXCEEDED: "TODOS_QUOTA_EXCEEDED";
    TODOS_UPGRADE_REQUIRED: "TODOS_UPGRADE_REQUIRED";
    TODOS_AUTHORITY_MISMATCH: "TODOS_AUTHORITY_MISMATCH";
    TODOS_AUTHORITY_UNAVAILABLE: "TODOS_AUTHORITY_UNAVAILABLE";
    TODOS_INTERNAL: "TODOS_INTERNAL";
    TODOS_TRANSFER_INVALID: "TODOS_TRANSFER_INVALID";
    TODOS_TRANSFER_CHECKSUM_MISMATCH: "TODOS_TRANSFER_CHECKSUM_MISMATCH";
    TODOS_TRANSFER_REFERENCE_MISSING: "TODOS_TRANSFER_REFERENCE_MISSING";
    TODOS_PROJECTION_PREDECESSOR_CONFLICT: "TODOS_PROJECTION_PREDECESSOR_CONFLICT";
}>;
export type TodosErrorCode = z.infer<typeof TodosErrorCodeSchema>;
export declare const TodosErrorDetailSchema: z.ZodObject<{
    field: z.ZodNullable<z.ZodString>;
    reason: z.ZodString;
    expected: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
    actual: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
}, z.core.$strict>;
export type TodosErrorDetail = z.infer<typeof TodosErrorDetailSchema>;
export declare const TodosErrorSchema: z.ZodObject<{
    code: z.ZodEnum<{
        TODOS_INVALID_INPUT: "TODOS_INVALID_INPUT";
        TODOS_AUTHENTICATION_FAILED: "TODOS_AUTHENTICATION_FAILED";
        TODOS_SCOPE_REQUIRED: "TODOS_SCOPE_REQUIRED";
        TODOS_TENANT_MISMATCH: "TODOS_TENANT_MISMATCH";
        TODOS_ACCESS_DENIED: "TODOS_ACCESS_DENIED";
        TODOS_NOT_FOUND: "TODOS_NOT_FOUND";
        TODOS_AMBIGUOUS_REFERENCE: "TODOS_AMBIGUOUS_REFERENCE";
        TODOS_VERSION_CONFLICT: "TODOS_VERSION_CONFLICT";
        TODOS_RESOURCE_CONFLICT: "TODOS_RESOURCE_CONFLICT";
        TODOS_LOCK_CONFLICT: "TODOS_LOCK_CONFLICT";
        TODOS_PRECONDITION_FAILED: "TODOS_PRECONDITION_FAILED";
        TODOS_APPROVAL_REQUIRED: "TODOS_APPROVAL_REQUIRED";
        TODOS_CAPABILITY_REQUIRED: "TODOS_CAPABILITY_REQUIRED";
        TODOS_OPERATION_UNSUPPORTED: "TODOS_OPERATION_UNSUPPORTED";
        TODOS_IDEMPOTENCY_REQUIRED: "TODOS_IDEMPOTENCY_REQUIRED";
        TODOS_IDEMPOTENCY_CONFLICT: "TODOS_IDEMPOTENCY_CONFLICT";
        TODOS_RATE_LIMITED: "TODOS_RATE_LIMITED";
        TODOS_QUOTA_EXCEEDED: "TODOS_QUOTA_EXCEEDED";
        TODOS_UPGRADE_REQUIRED: "TODOS_UPGRADE_REQUIRED";
        TODOS_AUTHORITY_MISMATCH: "TODOS_AUTHORITY_MISMATCH";
        TODOS_AUTHORITY_UNAVAILABLE: "TODOS_AUTHORITY_UNAVAILABLE";
        TODOS_INTERNAL: "TODOS_INTERNAL";
        TODOS_TRANSFER_INVALID: "TODOS_TRANSFER_INVALID";
        TODOS_TRANSFER_CHECKSUM_MISMATCH: "TODOS_TRANSFER_CHECKSUM_MISMATCH";
        TODOS_TRANSFER_REFERENCE_MISSING: "TODOS_TRANSFER_REFERENCE_MISSING";
        TODOS_PROJECTION_PREDECESSOR_CONFLICT: "TODOS_PROJECTION_PREDECESSOR_CONFLICT";
    }>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    details: z.ZodArray<z.ZodObject<{
        field: z.ZodNullable<z.ZodString>;
        reason: z.ZodString;
        expected: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
        actual: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TodosError = z.infer<typeof TodosErrorSchema>;
export declare const TodosTransportMetaSchema: z.ZodObject<{
    requestId: z.ZodString;
    httpStatus: z.ZodNullable<z.ZodNumber>;
    retryAfterSeconds: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export type TodosTransportMeta = z.infer<typeof TodosTransportMetaSchema>;
export declare const TodosErrorEnvelopeSchema: z.ZodObject<{
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodEnum<{
            TODOS_INVALID_INPUT: "TODOS_INVALID_INPUT";
            TODOS_AUTHENTICATION_FAILED: "TODOS_AUTHENTICATION_FAILED";
            TODOS_SCOPE_REQUIRED: "TODOS_SCOPE_REQUIRED";
            TODOS_TENANT_MISMATCH: "TODOS_TENANT_MISMATCH";
            TODOS_ACCESS_DENIED: "TODOS_ACCESS_DENIED";
            TODOS_NOT_FOUND: "TODOS_NOT_FOUND";
            TODOS_AMBIGUOUS_REFERENCE: "TODOS_AMBIGUOUS_REFERENCE";
            TODOS_VERSION_CONFLICT: "TODOS_VERSION_CONFLICT";
            TODOS_RESOURCE_CONFLICT: "TODOS_RESOURCE_CONFLICT";
            TODOS_LOCK_CONFLICT: "TODOS_LOCK_CONFLICT";
            TODOS_PRECONDITION_FAILED: "TODOS_PRECONDITION_FAILED";
            TODOS_APPROVAL_REQUIRED: "TODOS_APPROVAL_REQUIRED";
            TODOS_CAPABILITY_REQUIRED: "TODOS_CAPABILITY_REQUIRED";
            TODOS_OPERATION_UNSUPPORTED: "TODOS_OPERATION_UNSUPPORTED";
            TODOS_IDEMPOTENCY_REQUIRED: "TODOS_IDEMPOTENCY_REQUIRED";
            TODOS_IDEMPOTENCY_CONFLICT: "TODOS_IDEMPOTENCY_CONFLICT";
            TODOS_RATE_LIMITED: "TODOS_RATE_LIMITED";
            TODOS_QUOTA_EXCEEDED: "TODOS_QUOTA_EXCEEDED";
            TODOS_UPGRADE_REQUIRED: "TODOS_UPGRADE_REQUIRED";
            TODOS_AUTHORITY_MISMATCH: "TODOS_AUTHORITY_MISMATCH";
            TODOS_AUTHORITY_UNAVAILABLE: "TODOS_AUTHORITY_UNAVAILABLE";
            TODOS_INTERNAL: "TODOS_INTERNAL";
            TODOS_TRANSFER_INVALID: "TODOS_TRANSFER_INVALID";
            TODOS_TRANSFER_CHECKSUM_MISMATCH: "TODOS_TRANSFER_CHECKSUM_MISMATCH";
            TODOS_TRANSFER_REFERENCE_MISSING: "TODOS_TRANSFER_REFERENCE_MISSING";
            TODOS_PROJECTION_PREDECESSOR_CONFLICT: "TODOS_PROJECTION_PREDECESSOR_CONFLICT";
        }>;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        details: z.ZodArray<z.ZodObject<{
            field: z.ZodNullable<z.ZodString>;
            reason: z.ZodString;
            expected: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            actual: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    transport: z.ZodObject<{
        requestId: z.ZodString;
        httpStatus: z.ZodNullable<z.ZodNumber>;
        retryAfterSeconds: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TodosErrorEnvelope = z.infer<typeof TodosErrorEnvelopeSchema>;
export declare function createTodosError(code: TodosErrorCode, message: string, options?: {
    retryable?: boolean;
    details?: TodosErrorDetail[];
}): TodosError;
export interface TodosErrorCatalogEntry {
    code: TodosErrorCode;
    transportStatus: number;
    retryable: boolean;
}
export declare const TODOS_ERROR_CATALOG: readonly TodosErrorCatalogEntry[];
export declare function getTodosErrorCatalogEntry(code: TodosErrorCode): TodosErrorCatalogEntry;
export declare function createTodosResultSchema<const T extends z.ZodType>(dataSchema: T): z.ZodDiscriminatedUnion<[z.ZodObject<{
    ok: z.ZodLiteral<true>;
    data: T;
    requestId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodEnum<{
            TODOS_INVALID_INPUT: "TODOS_INVALID_INPUT";
            TODOS_AUTHENTICATION_FAILED: "TODOS_AUTHENTICATION_FAILED";
            TODOS_SCOPE_REQUIRED: "TODOS_SCOPE_REQUIRED";
            TODOS_TENANT_MISMATCH: "TODOS_TENANT_MISMATCH";
            TODOS_ACCESS_DENIED: "TODOS_ACCESS_DENIED";
            TODOS_NOT_FOUND: "TODOS_NOT_FOUND";
            TODOS_AMBIGUOUS_REFERENCE: "TODOS_AMBIGUOUS_REFERENCE";
            TODOS_VERSION_CONFLICT: "TODOS_VERSION_CONFLICT";
            TODOS_RESOURCE_CONFLICT: "TODOS_RESOURCE_CONFLICT";
            TODOS_LOCK_CONFLICT: "TODOS_LOCK_CONFLICT";
            TODOS_PRECONDITION_FAILED: "TODOS_PRECONDITION_FAILED";
            TODOS_APPROVAL_REQUIRED: "TODOS_APPROVAL_REQUIRED";
            TODOS_CAPABILITY_REQUIRED: "TODOS_CAPABILITY_REQUIRED";
            TODOS_OPERATION_UNSUPPORTED: "TODOS_OPERATION_UNSUPPORTED";
            TODOS_IDEMPOTENCY_REQUIRED: "TODOS_IDEMPOTENCY_REQUIRED";
            TODOS_IDEMPOTENCY_CONFLICT: "TODOS_IDEMPOTENCY_CONFLICT";
            TODOS_RATE_LIMITED: "TODOS_RATE_LIMITED";
            TODOS_QUOTA_EXCEEDED: "TODOS_QUOTA_EXCEEDED";
            TODOS_UPGRADE_REQUIRED: "TODOS_UPGRADE_REQUIRED";
            TODOS_AUTHORITY_MISMATCH: "TODOS_AUTHORITY_MISMATCH";
            TODOS_AUTHORITY_UNAVAILABLE: "TODOS_AUTHORITY_UNAVAILABLE";
            TODOS_INTERNAL: "TODOS_INTERNAL";
            TODOS_TRANSFER_INVALID: "TODOS_TRANSFER_INVALID";
            TODOS_TRANSFER_CHECKSUM_MISMATCH: "TODOS_TRANSFER_CHECKSUM_MISMATCH";
            TODOS_TRANSFER_REFERENCE_MISSING: "TODOS_TRANSFER_REFERENCE_MISSING";
            TODOS_PROJECTION_PREDECESSOR_CONFLICT: "TODOS_PROJECTION_PREDECESSOR_CONFLICT";
        }>;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        details: z.ZodArray<z.ZodObject<{
            field: z.ZodNullable<z.ZodString>;
            reason: z.ZodString;
            expected: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            actual: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    requestId: z.ZodString;
}, z.core.$strict>]>;
export declare function createTodosPageSchema<const T extends z.ZodType>(itemSchema: T): z.ZodObject<{
    items: z.ZodArray<T>;
    count: z.ZodNumber;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const TodosMutationReceiptSchema: z.ZodObject<{
    operationId: z.ZodString;
    resourceId: z.ZodString;
    changed: z.ZodBoolean;
    replayed: z.ZodBoolean;
    version: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export type TodosMutationReceipt = z.infer<typeof TodosMutationReceiptSchema>;
