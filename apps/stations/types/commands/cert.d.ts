import type { SetupResult } from "../types.js";
export declare function buildCertPlan(domains: string[]): SetupResult;
export declare function runCertPlan(domains: string[], options?: {
    apply?: boolean;
    yes?: boolean;
}): SetupResult;
