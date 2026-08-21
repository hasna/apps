import * as z from "zod/v4";
import { TODOS_CONTRACT_VERSION, TODOS_MANIFEST_VERSION } from "./common";
import { TODOS_INVARIANT_REGISTRY } from "./invariants";
export declare const TODOS_SCHEMA_REGISTRY: Readonly<Record<string, z.ZodType>>;
export type TodosSchemaId = keyof typeof TODOS_SCHEMA_REGISTRY;
export interface TodosSchemaBundle {
    schema: "hasna.todos.schema_bundle.v1";
    contractVersion: typeof TODOS_CONTRACT_VERSION;
    manifestVersion: typeof TODOS_MANIFEST_VERSION;
    schemaDigest: string;
    invariantRegistryDigest: string;
    runtimeValidationRequired: true;
    invariants: typeof TODOS_INVARIANT_REGISTRY;
    schemas: Record<string, Record<string, unknown>>;
}
export declare function getTodosSchema(schemaId: string): z.ZodType | undefined;
export declare function parseTodosSchema<T = unknown>(schemaId: string, input: unknown): T;
export declare function buildTodosSchemaBundle(): TodosSchemaBundle;
