import type { Pool } from "pg";
export declare function initializeIntake(pool: Pool, sinkId: string, authorityId: string): Promise<void>;
export declare function bindProducer(pool: Pool, input: {
    producer_id: string;
    tenant_id: string;
    app: string;
    corpus_id: string;
    source_authority_id: string;
}): Promise<void>;
export declare function grantProducerKey(pool: Pool, tenant: string, producer: string, kid: string): Promise<void>;
export declare function revokeProducerAccess(pool: Pool, tenant: string, producer: string, kid?: string): Promise<void>;
/** Register an already-issued signed key via private stdin; never mint or print it. */
export declare function registerIntakeKey(pool: Pool, token: string, signingSecret: string): Promise<void>;
export declare function runIntakeAdmin(pool: Pool, args: string[], signingSecret?: string): Promise<void>;
