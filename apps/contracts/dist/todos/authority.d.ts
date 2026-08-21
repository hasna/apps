import * as z from "zod/v4";
export declare const TODOS_AUTHORITY_SCHEMA_IDS: {
    readonly config: "hasna.todos.authority_config.v1";
    readonly handshake: "hasna.todos.authority_handshake.v1";
    readonly serviceStatus: "hasna.todos.service_status.v1";
};
export declare const TodosAuthorityDescriptorSchema: z.ZodObject<{
    id: z.ZodString;
    endpoint: z.ZodNullable<z.ZodURL>;
}, z.core.$strict>;
export type TodosAuthorityDescriptor = z.infer<typeof TodosAuthorityDescriptorSchema>;
export declare const TodosAuthorityConfigSchema: z.ZodObject<{
    readonly authority: z.ZodObject<{
        id: z.ZodString;
        endpoint: z.ZodNullable<z.ZodURL>;
    }, z.core.$strict>;
    readonly contractVersion: z.ZodLiteral<"1.0.0">;
    readonly contractDigest: z.ZodString;
    readonly manifestVersion: z.ZodLiteral<"1">;
    readonly manifestDigest: z.ZodString;
    readonly capabilityIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type TodosAuthorityConfig = z.infer<typeof TodosAuthorityConfigSchema>;
export declare const TodosAuthorityHandshakeSchema: z.ZodObject<{
    issuedAt: z.ZodISODateTime;
    authority: z.ZodObject<{
        id: z.ZodString;
        endpoint: z.ZodNullable<z.ZodURL>;
    }, z.core.$strict>;
    contractVersion: z.ZodLiteral<"1.0.0">;
    contractDigest: z.ZodString;
    manifestVersion: z.ZodLiteral<"1">;
    manifestDigest: z.ZodString;
    capabilityIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type TodosAuthorityHandshake = z.infer<typeof TodosAuthorityHandshakeSchema>;
export declare const TodosServiceStatusSchema: z.ZodObject<{
    status: z.ZodEnum<{
        ready: "ready";
        unavailable: "unavailable";
        healthy: "healthy";
    }>;
    authorityId: z.ZodString;
    contractVersion: z.ZodLiteral<"1.0.0">;
    manifestVersion: z.ZodLiteral<"1">;
    observedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosServiceStatus = z.infer<typeof TodosServiceStatusSchema>;
export declare const TODOS_AUTHORITY_SCHEMAS: Readonly<{
    "hasna.todos.authority_config.v1": z.ZodObject<{
        readonly authority: z.ZodObject<{
            id: z.ZodString;
            endpoint: z.ZodNullable<z.ZodURL>;
        }, z.core.$strict>;
        readonly contractVersion: z.ZodLiteral<"1.0.0">;
        readonly contractDigest: z.ZodString;
        readonly manifestVersion: z.ZodLiteral<"1">;
        readonly manifestDigest: z.ZodString;
        readonly capabilityIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    "hasna.todos.authority_handshake.v1": z.ZodObject<{
        issuedAt: z.ZodISODateTime;
        authority: z.ZodObject<{
            id: z.ZodString;
            endpoint: z.ZodNullable<z.ZodURL>;
        }, z.core.$strict>;
        contractVersion: z.ZodLiteral<"1.0.0">;
        contractDigest: z.ZodString;
        manifestVersion: z.ZodLiteral<"1">;
        manifestDigest: z.ZodString;
        capabilityIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    "hasna.todos.service_status.v1": z.ZodObject<{
        status: z.ZodEnum<{
            ready: "ready";
            unavailable: "unavailable";
            healthy: "healthy";
        }>;
        authorityId: z.ZodString;
        contractVersion: z.ZodLiteral<"1.0.0">;
        manifestVersion: z.ZodLiteral<"1">;
        observedAt: z.ZodISODateTime;
    }, z.core.$strict>;
}>;
