import * as z from "zod/v4";
export declare const TODOS_SCHEMA_FOUNDATION_REGISTRY: Readonly<Record<string, z.ZodType>>;
export declare function buildTodosJsonSchemas(registry: Readonly<Record<string, z.ZodType>>): Record<string, Record<string, unknown>>;
export declare const TODOS_SCHEMA_FOUNDATION: Readonly<Record<string, Record<string, unknown>>>;
export declare const TODOS_SCHEMA_BUNDLE_DIGEST: string;
