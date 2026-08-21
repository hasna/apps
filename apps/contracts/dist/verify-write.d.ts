export type VerifyWriteStatus = "match" | "grew" | "shrunk" | "mismatch" | "refused";
export interface VerifyWriteMatch {
    ok: true;
    status: "match";
    authoredBytes: number;
    storedBytes: number;
    deltaBytes: 0;
    hashesEqual: true;
    message: string;
}
export interface VerifyWriteDifference {
    ok: false;
    status: "grew" | "shrunk" | "mismatch";
    authoredBytes: number;
    storedBytes: number;
    deltaBytes: number;
    hashesEqual: false;
    message: string;
}
export interface VerifyWriteRefusal {
    ok: false;
    status: "refused";
    code: "object_id_missing" | "object_id_invalid" | "object_id_mismatch" | "content_missing" | "content_invalid";
    message: string;
}
export type VerifyWriteResult = VerifyWriteMatch | VerifyWriteDifference | VerifyWriteRefusal;
export interface VerifyFetchedWriteRequest {
    targetId: string;
    authored: Uint8Array;
    fetched: unknown;
    idPath?: string;
    contentPath?: string;
}
/**
 * Compare one fetched object with the caller-authored bytes without returning
 * either body or either digest. Object identity is checked before the stored
 * content path is accessed.
 */
export declare function verifyFetchedWrite(request: VerifyFetchedWriteRequest): VerifyWriteResult;
