/** IANA snapshot version (YYYYMMDDNN) this list was generated from. */
export declare const IANA_TLD_SNAPSHOT = "2026072600";
/**
 * TLDs that are ALSO ubiquitous programming vocabulary — property names,
 * method names, and file extensions that occur constantly inside a bundle.
 *
 * Every entry here is a real, delegated TLD, so this is a DELIBERATE BLIND
 * SPOT, stated as one: an inventory built exclusively from domains under these
 * TLDs is not detected by count. Clause B is a prohibition, not a count — it
 * binds whether or not this guard can see the violation.
 *
 * The alternative is worse. Counting `.list`, `.map` and `.app` means every
 * `agents.list` and `config.map` in a bundle is a finding, the gate fires on
 * compliant repos, and it gets switched off — which protects exactly as much
 * as a gate that cannot fail.
 */
export declare const PROGRAMMING_COLLISION_TLDS: ReadonlySet<string>;
/** The TLDs the asset-inventory guard counts: IANA minus the collision set. */
export declare const RECOGNIZED_TLDS: ReadonlySet<string>;
/** Is `label` a TLD this guard is willing to count? */
export declare function isRecognizedTld(label: string): boolean;
