/** Largest member the buffered readers decode by default. */
export declare const MAX_ARCHIVE_MEMBER_BYTES: number;
/**
 * Ceiling for a scanner that is not allowed to decline.
 *
 * The published-artifact guard cannot have a working size limit. A member it
 * declines to read is a member that could be carrying the inventory, and the
 * biggest file in a tarball is exactly where a compiled-in list ends up:
 * bundles and `.map` files routinely run past any cap worth setting, and the
 * incident's own `dist/index.js` is the shape this guard exists for. This bound
 * is therefore a memory backstop for a corrupt or hostile archive, not a policy
 * knob — a member above it is reported as UNREADABLE, which FAILS the scan.
 */
export declare const MAX_SCANNED_MEMBER_BYTES: number;
/** Is `target` a path this module can read as a packed artifact? */
export declare function isPackedArtifactPath(target: string): boolean;
/**
 * Extract the whole archive ONCE into a directory and return its path.
 *
 * The per-member `tar -xOzf <archive> <entry>` this replaces re-decompressed
 * the entire stream every time: measured at 0.243 s/member on a 20,414-member
 * package, i.e. **82 minutes**, against 4.9 s for the same content as a
 * directory — a ~1000x penalty on a mandatory, blocking `prepack` hook. A gate
 * that costs an hour is a gate that gets switched off, which is the failure
 * mode this module exists to argue against.
 *
 * Extraction to disk rather than to one buffer, deliberately: `tar -xzO` into a
 * single pipe truncates on large packages (`gzip: unexpected end of file`), and
 * a scan that silently reads a truncated stream is worse than a slow one. The
 * caller owns the returned directory and must remove it.
 */
export declare function extractArchive(target: string): string;
/** Raw member paths inside the archive, in archive order. */
export declare function listArchiveEntries(target: string): string[];
/**
 * The single top-level directory every member sits under (npm's `package/`),
 * or `null` when members do not share one. Returning `null` rather than
 * guessing keeps a hand-rolled archive from having its paths rewritten.
 */
export declare function commonArchiveRoot(entries: string[]): string | null;
/** Strip the archive root and leading separators; `null` for directories. */
export declare function normalizeArchiveEntry(entry: string, commonRoot: string | null): string | null;
/**
 * Extract one member's bytes. Throws if the member exceeds `maxBytes`.
 *
 * The cap is a parameter because the two callers want opposite things from it:
 * the no-cloud guard reads source-shaped files and a big one is not its
 * problem, while the published-artifact guard must read whatever shipped and
 * treats an undecoded member as a failure rather than a footnote.
 */
export declare function readArchiveMemberBytes(target: string, entry: string, maxBytes?: number): Buffer;
/** Extract one member as UTF-8 text. Throws if the member exceeds the size cap. */
export declare function readArchiveMemberText(target: string, entry: string): string;
