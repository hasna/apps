import type { EventEnvelope } from "../types.js";
export declare const INTAKE_PROTOCOL = "hasna.events.intake.v1";
export declare const CANONICAL_ENCODING = "hasna.sorted-json.v1";
export declare const MAX_ENVELOPE_BYTES: number;
export declare const MAX_REQUEST_BYTES: number;
export declare class IntakeError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status?: number);
}
export declare function uuid(value: unknown): string;
/** Producer-owned identity; preserve its exact spelling, including case. */
export declare const SOURCE_ID_PATTERN: RegExp;
export declare function sourceIdentity(value: unknown): string;
export declare function boundedText(value: unknown, limit?: number): string;
export declare function object(value: unknown): Record<string, unknown>;
export declare function exactKeys(value: Record<string, unknown>, required: string[], optional?: string[]): void;
/** Versioned Hasna JSON encoding, not RFC 8785. No coercion, accessors or cycles. */
export declare function canonicalJson(input: unknown): string;
export declare function envelopeHash(text: string): string;
export declare function validateEnvelope(text: string): EventEnvelope;
export interface IntakeBinding {
    sink_id: string;
    producer_id: string;
    corpus_id: string;
    source_authority_id: string;
}
export interface IntakeRequest extends IntakeBinding {
    protocol: typeof INTAKE_PROTOCOL;
    encoding: typeof CANONICAL_ENCODING;
    event_id: string;
    dedupe_key: string;
    envelope_sha256: string;
    envelope_json: string;
}
export interface IntakeReceipt extends Omit<IntakeRequest, "envelope_json" | "encoding"> {
    tenant_id: string;
    receipt_id: string;
    accepted_at: string;
    status: "accepted_durable";
}
export declare function validateBinding(raw: unknown): IntakeBinding;
export declare function validateRequest(raw: unknown): IntakeRequest;
export declare function prepareIntake(binding: IntakeBinding, envelope: EventEnvelope): IntakeRequest;
export declare function validateReceipt(raw: unknown, request: Omit<IntakeRequest, "envelope_json" | "encoding">, tenant: string): IntakeReceipt;
