import type { z } from "zod";
import { ContractSchemaRegistry, type ContractBySchemaId, type KnownSchemaId } from "./schemas";
export type EmbeddedContractValidationResult = {
    success: true;
    schemaId: KnownSchemaId;
    data: ContractBySchemaId[KnownSchemaId];
} | {
    success: false;
    schemaId: string | null;
    issues: z.ZodIssue[];
};
export declare class ContractValidationError extends Error {
    readonly schemaId: string;
    readonly issues: z.ZodIssue[];
    constructor(schemaId: string, issues: z.ZodIssue[]);
}
export declare function getContractSchema<TSchemaId extends KnownSchemaId>(schemaId: TSchemaId): (typeof ContractSchemaRegistry)[TSchemaId];
export declare function getEmbeddedSchemaId(value: unknown): KnownSchemaId | null;
export declare function parseContract<TSchemaId extends KnownSchemaId>(schemaId: TSchemaId, value: unknown): ContractBySchemaId[TSchemaId];
export declare function validateContract<TSchemaId extends KnownSchemaId>(schemaId: TSchemaId, value: unknown): z.SafeParseReturnType<unknown, ContractBySchemaId[TSchemaId]>;
export declare function validateEmbeddedContract(value: unknown): EmbeddedContractValidationResult;
export declare function parseEmbeddedContract(value: unknown): ContractBySchemaId[KnownSchemaId];
