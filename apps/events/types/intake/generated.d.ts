import type { HasnaHttpTransport, HasnaRequestOptions } from "@hasna/contracts/client";
export type IntakeRequest = {
    protocol: "hasna.events.intake.v1";
    sink_id: string;
    producer_id: string;
    corpus_id: string;
    source_authority_id: string;
    event_id: string;
    dedupe_key: string;
    envelope_sha256: string;
    encoding: "hasna.sorted-json.v1";
    envelope_json: string;
};
export type IntakeReceipt = {
    protocol: "hasna.events.intake.v1";
    sink_id: string;
    producer_id: string;
    corpus_id: string;
    source_authority_id: string;
    event_id: string;
    dedupe_key: string;
    envelope_sha256: string;
    tenant_id: string;
    receipt_id: string;
    accepted_at: string;
    status: "accepted_durable";
};
export type IntakeCapability = {
    protocol: "hasna.events.intake.v1";
    sink_id: string;
    producer_id: string;
    corpus_id: string;
    source_authority_id: string;
    tenant_id: string;
    kid: string;
};
export type IntakeError = {
    error: string;
};
export declare function acceptEvent(client: HasnaHttpTransport, body: IntakeRequest, options: HasnaRequestOptions): Promise<IntakeReceipt>;
export declare function intakeCapability(client: HasnaHttpTransport, options: HasnaRequestOptions): Promise<IntakeCapability>;
export declare function readReceipt(client: HasnaHttpTransport, options: HasnaRequestOptions): Promise<IntakeReceipt>;
