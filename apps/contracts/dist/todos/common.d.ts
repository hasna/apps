import * as z from "zod/v4";
export declare const TODOS_CONTRACT_NAMESPACE: "hasna.todos";
export declare const TODOS_CONTRACT_VERSION: "1.0.0";
export declare const TODOS_MANIFEST_VERSION: "1";
export declare const TODOS_TRANSFER_VERSION: "1";
export declare const TodosAudienceSchema: z.ZodEnum<{
    customer: "customer";
    tenant_admin: "tenant_admin";
}>;
export type TodosAudience = z.infer<typeof TodosAudienceSchema>;
export declare const TodosTimestampSchema: z.ZodISODateTime;
export declare const TodosDateSchema: z.ZodISODate;
export declare const TodosEntityIdSchema: z.ZodString;
export declare const TodosOwnerIdSchema: z.ZodString;
export declare const TodosSlugSchema: z.ZodString;
export declare const TodosRequestIdSchema: z.ZodString;
export declare const TodosIdempotencyKeySchema: z.ZodString;
export declare const TodosSha256DigestSchema: z.ZodString;
export declare const TodosCursorSchema: z.ZodString;
export declare const TodosRelativePathSchema: z.ZodString;
export declare const TodosPortableScalarSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>;
export type TodosPortableScalar = z.infer<typeof TodosPortableScalarSchema>;
export declare const TodosOwnerQualifiedRefSchema: z.ZodObject<{
    owner: z.ZodString;
    kind: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
}, z.core.$strict>;
export type TodosOwnerQualifiedRef = z.infer<typeof TodosOwnerQualifiedRefSchema>;
export declare const TodosContentRefSchema: z.ZodObject<{
    algorithm: z.ZodLiteral<"sha256">;
    digest: z.ZodString;
    mediaType: z.ZodString;
    byteLength: z.ZodNumber;
}, z.core.$strict>;
export type TodosContentRef = z.infer<typeof TodosContentRefSchema>;
export declare const TodosPageRequestSchema: z.ZodObject<{
    cursor: z.ZodNullable<z.ZodString>;
    limit: z.ZodNumber;
}, z.core.$strict>;
export type TodosPageRequest = z.infer<typeof TodosPageRequestSchema>;
export declare const TodosResponseMetaSchema: z.ZodObject<{
    requestId: z.ZodString;
    authorityId: z.ZodString;
    contractVersion: z.ZodLiteral<"1.0.0">;
    manifestVersion: z.ZodLiteral<"1">;
}, z.core.$strict>;
export type TodosResponseMeta = z.infer<typeof TodosResponseMetaSchema>;
export declare function canonicalizeTodosValue(value: unknown): unknown;
export declare function stableTodosJson(value: unknown): string;
export declare function sha256TodosValue(value: unknown): string;
export declare function sha256TodosText(value: string): string;
export declare function uniqueSortedTodosStrings(values: readonly string[]): string[];
export declare function sortTodosRecords<T>(records: readonly T[]): T[];
