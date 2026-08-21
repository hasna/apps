import * as z from "zod/v4";
import { type TodosAuthorityDescriptor, type TodosAuthorityHandshake } from "./authority";
export declare const TODOS_CANONICAL_CAPABILITY_IDS: readonly string[];
export declare const TodosCanonicalAuthorityHandshakeSchema: z.ZodObject<{
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
export interface CreateTodosAuthorityHandshakeInput {
    authority: TodosAuthorityDescriptor;
    issuedAt: string;
}
export declare function createTodosAuthorityHandshake(input: CreateTodosAuthorityHandshakeInput): TodosAuthorityHandshake;
export declare function validateCanonicalTodosAuthorityHandshake(input: unknown): input is TodosAuthorityHandshake;
