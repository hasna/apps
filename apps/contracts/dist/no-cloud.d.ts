import { type NoCloudEvidencePack } from "./schemas.js";
export interface NoCloudScanOptions {
    id?: string;
    now?: string;
    manifest?: unknown;
    generatedBy?: NoCloudEvidencePack["generatedBy"];
}
export declare function scanNoCloudTarget(target: string, options?: NoCloudScanOptions): NoCloudEvidencePack;
