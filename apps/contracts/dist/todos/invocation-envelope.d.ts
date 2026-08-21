import * as z from "zod/v4";
export declare const TODOS_OPERATION_INVOCATION_SCHEMA_ID: "hasna.todos.operation_invocation.v1";
/**
 * Version-neutral JSON shape used for schema hashing and generated JSON Schema.
 * The public TodosOperationInvocationSchema adds canonical runtime refinements.
 */
export declare const TodosOperationInvocationEnvelopeSchema: z.ZodObject<{
    authorityId: z.ZodString;
    contractDigest: z.ZodString;
    manifestDigest: z.ZodString;
    operationId: z.ZodString;
    identity: z.ZodObject<{
        issuer: z.ZodString;
        audience: z.ZodEnum<{
            customer: "customer";
            tenant_admin: "tenant_admin";
        }>;
        subject: z.ZodString;
        organizationId: z.ZodString;
        tenantId: z.ZodString;
        roles: z.ZodArray<z.ZodEnum<{
            tenant_admin: "tenant_admin";
            customer_member: "customer_member";
            customer_manager: "customer_manager";
        }>>;
        scopes: z.ZodArray<z.ZodString>;
        keyId: z.ZodString;
        tokenId: z.ZodString;
        requestId: z.ZodString;
        agentId: z.ZodNullable<z.ZodString>;
        sessionId: z.ZodNullable<z.ZodString>;
        projectId: z.ZodNullable<z.ZodString>;
        taskListId: z.ZodNullable<z.ZodString>;
        idempotencyKey: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
    request: z.ZodUnknown;
}, z.core.$strict>;
export type TodosOperationInvocationEnvelope = z.infer<typeof TodosOperationInvocationEnvelopeSchema>;
