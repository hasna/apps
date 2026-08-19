/**
 * `contracts read` — run a Hasna collection read and either prove it whole or refuse.
 *
 * Exit codes follow the convention probe-guard already established on this fleet, so
 * an agent does not have to hold two vocabularies:
 *   0  the read is proven complete; rows are on stdout
 *   2  REFUSED — completeness could not be established (the interesting one)
 *   3  usage error
 *
 * A refusal is never an empty result. Nothing is printed to stdout that a caller
 * could mistake for a population.
 */
export interface ReadCliOptions {
    rowsKey?: string | undefined;
    totalKey?: string | undefined;
    limitFlag?: string | undefined;
    limit?: string | undefined;
    widenTo?: string | undefined;
    knownClamp?: string | undefined;
    cursorFlag?: string | undefined;
    maxPages?: string | undefined;
    siblingArg?: string[] | undefined;
    siblingPath?: string | undefined;
    probeNegativeArg?: string[] | undefined;
    probePositiveArg?: string[] | undefined;
    allowEmpty?: boolean | undefined;
    assumeComplete?: boolean | undefined;
    scopeAck?: string | undefined;
    json?: boolean | undefined;
}
export declare function runSafeReadCli(argv: string[], options: ReadCliOptions, io?: {
    log: (s: string) => void;
    err: (s: string) => void;
}): number;
