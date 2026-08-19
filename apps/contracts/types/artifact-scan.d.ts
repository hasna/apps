/** Asset classes an inventory can be made of. */
export declare const ASSET_INVENTORY_KINDS: readonly ["domain", "host", "ip", "email"];
export type AssetInventoryKind = (typeof ASSET_INVENTORY_KINDS)[number];
/**
 * How many DISTINCT entries of one kind, in ONE shipped file, make an
 * inventory rather than a mention.
 *
 * These are the numbers where "this file lists our assets" starts being the
 * only plausible reading. A README naming a handful of hosts is documentation;
 * a bundle carrying 20 registrable domains is a portfolio. The incident's file
 * held 177. Set low enough to have caught it many times over, high enough that
 * ordinary code and docs do not trip it.
 */
export declare const DEFAULT_INVENTORY_THRESHOLDS: Readonly<Record<AssetInventoryKind, number>>;
/**
 * Is this dotted quad an address the specifications say is not a real place?
 *
 * Exported for `tests/source-endpoint-hostname-guard.test.ts`, which applies the
 * same reserved-address rule at a threshold of one. Two definitions of "reserved"
 * would drift, and the one that drifted looser would be the one nobody noticed.
 */
export declare function isReservedIpv4(value: string): boolean;
/**
 * Is this name one the specifications reserve as NOT REAL?
 *
 * Exported for the same reason as {@link isReservedIpv4}: the sibling source
 * guard needs the identical rule, and a second copy of RFC 2606 is a second
 * thing to forget to update.
 */
export declare function isReservedHostname(hostname: string): boolean;
/** `a.b.example.co.uk` -> `example.co.uk`; the unit a registrant actually owns. */
export declare function registrableDomain(hostname: string): string;
export interface AssetInventoryFinding {
    /** Member path inside the artifact. */
    path: string;
    kind: AssetInventoryKind;
    /** Number of distinct entries found. */
    count: number;
    /** The threshold that was exceeded. */
    threshold: number;
    /**
     * A small, redacted sample. Deliberately partial and masked: the report is
     * itself an artifact that gets pasted into tasks, channels, and CI logs, and
     * a guard that prints the inventory it just found has disclosed it again.
     */
    sample: string[];
}
/** A member the scan could not decode, and why it could not. */
export interface UnreadableMember {
    /** Member path inside the artifact. */
    path: string;
    reason: string;
}
/**
 * Hard ceiling per asset kind: TWICE the default, no more.
 *
 * A caller may tighten a threshold as far as it likes. Loosening is capped
 * because clause C inspects the script graph and never the flags, so a repo
 * can bake a loosened threshold into its scan script and pass conformance
 * while suppressing findings. At the previous ceiling of 100 that was a 5x
 * loosening — up to 99 owned domains suppressed by a flag nothing checks. 2x
 * leaves room for a repo with a genuinely noisy artifact to tune, and leaves
 * none for switching the detector off.
 */
export declare const MAX_INVENTORY_THRESHOLDS: Readonly<Record<AssetInventoryKind, number>>;
export interface ArtifactScanOptions {
    /** Per-kind overrides. Merged over {@link DEFAULT_INVENTORY_THRESHOLDS}. */
    thresholds?: Partial<Record<AssetInventoryKind, number>>;
    /** Asset kinds a reviewed, unexpired waiver excuses. */
    waivedKinds?: readonly AssetInventoryKind[];
    /** Member paths to skip, as exact normalized paths. */
    ignorePaths?: readonly string[];
    /**
     * Ceiling on one member's decoded bytes; defaults to
     * {@link MAX_SCANNED_MEMBER_BYTES}. A member above it is reported as
     * unreadable, which fails the scan — the ceiling bounds memory, it does not
     * excuse a file from being read.
     */
    maxMemberBytes?: number;
}
export interface ArtifactScanReport {
    /**
     * Findings raised only by the whole-artifact union, not by any single member.
     * Kept separate so a reader can tell "one file holds a list" from "the list is
     * spread across ten".
     */
    aggregateFindings?: AssetInventoryFinding[];
    ok: boolean;
    /** The scanned target, as given. */
    target: string;
    /** `packed_artifact` when a tarball was read, `source_tree` for a directory. */
    scanMode: "packed_artifact" | "source_tree";
    /** Members that were read and searched. Non-empty on any real artifact. */
    membersScanned: number;
    /** Members skipped because they were binary — nothing to decode as text. */
    membersSkipped: number;
    findings: AssetInventoryFinding[];
    /** Findings suppressed by a declared waiver, kept for the audit trail. */
    waived: AssetInventoryFinding[];
    /**
     * Members that could not be decoded at all. NEVER a footnote: a member that
     * was not read cannot be cleared, so any entry here fails the scan.
     */
    unreadable: UnreadableMember[];
}
/**
 * Name a finding without republishing any part of it.
 *
 * Earlier versions emitted a prefix, the exact label length, and the full TLD
 * (`ha***.agency`). A portfolio is ONE brand across many TLDs, so three samples
 * of that form disclose two characters of the brand, its exact length, and
 * three registrations it holds — enough to name it and look the rest up. The
 * mask reconstructed the secret it existed to hide.
 *
 * Nothing identifying survives: no prefix, no length, no TLD. What remains is
 * the KIND and a short salted digest, which is stable within one report (so two
 * findings can be told apart) and useless outside it.
 */
export declare function redact(entry: string, kind: AssetInventoryKind): string;
/**
 * Decode the escape forms a disclosure can hide behind.
 *
 * Percent, `\uXXXX`, `\u{...}`, `\xXX`, HTML entities, and the JSON-escaped
 * quotes a source map's `sourcesContent` wraps original source in — which is
 * exactly how a file excluded by `files` still ships its contents.
 */
export declare function decodeEscapes(value: string): string;
export declare function isCodeLikeMember(path: string): boolean;
export interface InventoryCountOptions {
    /**
     * Read this text as code. Defaults to true, which is the conservative choice
     * for a bare call: it only ever suppresses a finding in the one shape that is
     * genuinely ambiguous.
     */
    codeLike?: boolean;
}
/**
 * Count distinct assets of each kind in one member's text.
 *
 * Domains and emails are read from the two inventory shapes above, in whatever
 * encoding the file happens to use. IPv4 is read from anywhere, because a
 * dotted quad is not confusable with an identifier.
 */
export declare function inventoryCounts(text: string, options?: InventoryCountOptions): Record<AssetInventoryKind, string[]>;
/**
 * Scan a packed artifact (or, for local iteration, a directory) for bulk asset
 * inventories.
 *
 * Fails when the target yields zero readable members. A scanner that reports
 * `ok` after finding nothing to read is the vacuity trap this contract keeps
 * running into: it would pass on a broken path, a wrong filename, or an empty
 * tarball, and pass loudest exactly when it is protecting nothing. The same
 * rule applies one member at a time: a member the scan could not decode fails
 * it, because an unread file has not been cleared.
 */
export declare function scanPublishedArtifact(target: string, options?: ArtifactScanOptions): ArtifactScanReport;
/** One-line-per-finding summary for CLI output and CI logs. */
export declare function formatArtifactScanReport(report: ArtifactScanReport): string;
/**
 * Asset-inventory waivers a manifest declares, filtered to those still in force.
 *
 * The schema has carried `metadata.conformance.waivedAssetInventories` and
 * CONTRACT.md has documented it as the escape hatch for public reference data,
 * but until now nothing read it: a repo that declared the waiver exactly as the
 * contract instructed still failed the gate, and its only recourse was to
 * unwire the gate — the precise failure mode clause C exists to prevent.
 *
 * `expiresAt` is enforced here, so the time-boxing is a property rather than a
 * promise: an expired waiver stops applying on its own, without anyone
 * remembering to remove it. A waiver missing the accountability fields the
 * contract requires is not honoured either — a waiver nobody signed is not a
 * reviewed exception.
 */
export interface AssetInventoryWaiverResolution {
    /** Kinds a reviewed, unexpired waiver excuses. */
    kinds: AssetInventoryKind[];
    /** One audit line per declared waiver, applied or not. */
    notes: string[];
}
export declare function resolveAssetInventoryWaivers(manifestPath: string, now?: Date): AssetInventoryWaiverResolution;
