import * as z from "zod/v4";
import { type TodosError } from "./errors";
import { TODOS_OPERATION_INVOCATION_SCHEMA_ID } from "./invocation-envelope";
import { type TodosOperation } from "./operations";
/**
 * One protocol-neutral invocation envelope. Operation and idempotency semantics
 * are resolved from TODOS_OPERATION_MANIFEST; this schema deliberately does not
 * define a second operation vocabulary.
 */
export declare const TodosOperationInvocationSchema: z.ZodObject<{
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
export type TodosOperationInvocation = z.infer<typeof TodosOperationInvocationSchema>;
export type TodosOperationInvocationValidation = {
    success: true;
    invocation: TodosOperationInvocation;
    operation: TodosOperation;
} | {
    success: false;
    error: TodosError;
};
export declare function validateTodosOperationInvocation(input: unknown): TodosOperationInvocationValidation;
export declare const TODOS_INVOCATION_SCHEMAS: Readonly<{
    "hasna.todos.operation_invocation.v1": z.ZodObject<{
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
}>;
export { TODOS_OPERATION_INVOCATION_SCHEMA_ID, };
