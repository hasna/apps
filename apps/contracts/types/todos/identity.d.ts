import * as z from "zod/v4";
import { type TodosError } from "./errors";
export declare const TODOS_IDENTITY_SCHEMA_ID: "hasna.todos.identity_context.v1";
export declare const TodosIdentityRoleSchema: z.ZodEnum<{
    tenant_admin: "tenant_admin";
    customer_member: "customer_member";
    customer_manager: "customer_manager";
}>;
export declare const TodosScopeSchema: z.ZodString;
export declare const TodosIdentityContextSchema: z.ZodObject<{
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
export type TodosIdentityContext = z.infer<typeof TodosIdentityContextSchema>;
export interface TodosIdentityRequirements {
    organizationId: string;
    tenantId: string;
    audience: "customer" | "tenant_admin";
    requiredScopes: readonly string[];
    requireIdempotencyKey?: boolean;
}
export type TodosIdentityValidationResult = {
    success: true;
    identity: TodosIdentityContext;
} | {
    success: false;
    error: TodosError;
};
export declare function validateTodosIdentityContext(input: unknown, requirements: TodosIdentityRequirements): TodosIdentityValidationResult;
