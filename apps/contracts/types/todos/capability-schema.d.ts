import * as z from "zod/v4";
export declare const TODOS_CAPABILITY_SCHEMA_IDS: {
    readonly capability: "hasna.todos.capability.v1";
    readonly manifest: "hasna.todos.capability_manifest.v1";
};
export declare const TodosCapabilitySchema: z.ZodObject<{
    id: z.ZodString;
    availability: z.ZodEnum<{
        core: "core";
        gated: "gated";
    }>;
    operationIds: z.ZodArray<z.ZodString>;
    audiences: z.ZodArray<z.ZodEnum<{
        customer: "customer";
        tenant_admin: "tenant_admin";
    }>>;
}, z.core.$strict>;
export type TodosCapability = z.infer<typeof TodosCapabilitySchema>;
export declare const TodosCapabilityManifestSchema: z.ZodObject<{
    schema: z.ZodLiteral<"hasna.todos.capability_manifest.v1">;
    version: z.ZodLiteral<"1">;
    manifestDigest: z.ZodString;
    capabilities: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        availability: z.ZodEnum<{
            core: "core";
            gated: "gated";
        }>;
        operationIds: z.ZodArray<z.ZodString>;
        audiences: z.ZodArray<z.ZodEnum<{
            customer: "customer";
            tenant_admin: "tenant_admin";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TodosCapabilityManifest = z.infer<typeof TodosCapabilityManifestSchema>;
export declare const TODOS_CAPABILITY_SCHEMAS: Readonly<{
    "hasna.todos.capability.v1": z.ZodObject<{
        id: z.ZodString;
        availability: z.ZodEnum<{
            core: "core";
            gated: "gated";
        }>;
        operationIds: z.ZodArray<z.ZodString>;
        audiences: z.ZodArray<z.ZodEnum<{
            customer: "customer";
            tenant_admin: "tenant_admin";
        }>>;
    }, z.core.$strict>;
    "hasna.todos.capability_manifest.v1": z.ZodObject<{
        schema: z.ZodLiteral<"hasna.todos.capability_manifest.v1">;
        version: z.ZodLiteral<"1">;
        manifestDigest: z.ZodString;
        capabilities: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            availability: z.ZodEnum<{
                core: "core";
                gated: "gated";
            }>;
            operationIds: z.ZodArray<z.ZodString>;
            audiences: z.ZodArray<z.ZodEnum<{
                customer: "customer";
                tenant_admin: "tenant_admin";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}>;
