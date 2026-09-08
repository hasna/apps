import { ApiKeyStore, type ApiKeyPrincipal } from "@hasna/contracts/auth";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { type IntakeBinding, type IntakeReceipt } from "../intake/protocol.js";
export declare function authQueries(pool: Pick<Pool, "query">): {
    many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
    execute(sql: string, params?: readonly unknown[]): Promise<void>;
};
export declare function tenantTransaction<T>(pool: Pool, tenant: string, run: (c: PoolClient) => Promise<T>): Promise<T>;
export declare class IntakePostgres {
    readonly pool: Pool;
    readonly expectedSinkId: string;
    readonly expectedAuthorityId: string;
    readonly keys: ApiKeyStore;
    constructor(pool: Pool, expectedSinkId: string, expectedAuthorityId: string);
    /** Fail closed on owner/superuser/BYPASSRLS service credentials or a wrong sink. */
    ready(): Promise<void>;
    private authorize;
    private receipt;
    capability(principal: ApiKeyPrincipal, binding: IntakeBinding): Promise<{
        tenant_id: string;
        kid: string;
        sink_id: string;
        producer_id: string;
        corpus_id: string;
        source_authority_id: string;
        protocol: string;
    }>;
    accept(principal: ApiKeyPrincipal, raw: unknown): Promise<IntakeReceipt>;
    read(principal: ApiKeyPrincipal, binding: IntakeBinding, eventId: string): Promise<IntakeReceipt>;
}
