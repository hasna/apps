/**
 * Maximum tenant-id length. Chosen to hold a canonical UUID (36) or a prefixed
 * ULID (`org_` + 26 = 30) with headroom, while staying inside a comfortable
 * `varchar` and a single header value.
 */
export declare const MAX_TENANT_ID_LENGTH = 64;
/**
 * Tenant-id grammar: ASCII alphanumeric start, then alphanumerics plus `.`,
 * `_`, `-`. Anything a log parser, a header, or a URL segment would have to
 * escape is excluded by construction.
 *
 * Built from {@link MAX_TENANT_ID_LENGTH} rather than written as a literal, so
 * the cap and the pattern cannot drift apart.
 */
export declare const TENANT_ID_PATTERN: RegExp;
/** Is `value` a syntactically valid tenant id? */
export declare function isValidTenantId(value: unknown): value is string;
/**
 * Is `value` a textual UUID in any spelling a PostgreSQL `uuid` column accepts?
 * Note that brace-wrapped forms are not valid tenant ids on their own (`{` is
 * outside the grammar) — they are recognized so {@link normalizeTenantId} can
 * turn operator input into a canonical id rather than rejecting it.
 */
export declare function isUuidTenantId(value: string): boolean;
/**
 * Canonical comparison form: canonical lowercase hyphenated for every UUID
 * spelling, unchanged for everything else. Does NOT validate — use
 * {@link normalizeTenantId} when the input is untrusted.
 */
export declare function canonicalizeTenantId(value: string): string;
/**
 * Trim, validate, and canonicalize an untrusted tenant id. Throws a message
 * naming the grammar so a bad `--tid` is self-diagnosing at the CLI.
 */
export declare function normalizeTenantId(value: string): string;
/**
 * Compare two tenant ids under the canonical rule: exact match, except that
 * every UUID spelling folds to one value. Invalid input never matches.
 *
 * Both sides are trimmed first. Mint trims, so a comparison that did not would
 * reject an `expectedTid` read from a file or env var with a trailing newline —
 * fail-closed, but for a reason no operator could see.
 */
export declare function tenantIdsEqual(left: string | null | undefined, right: string | null | undefined): boolean;
/**
 * Read a `tid` field as an OWN property, `undefined` when it is absent.
 *
 * A plain `source.tid` resolves through the prototype chain, so a single
 * `Object.prototype.tid = "..."` write anywhere in the process — the classic
 * prototype-pollution primitive — hands a tenant to every claim set and every
 * options bag that names none. Rule 4 above makes absence load-bearing: it is
 * the untenanted case `requireTenant` exists to reject. So the test that a
 * tenant is ABSENT and the read of its VALUE must be one and the same check.
 * Split them and the absent path silently uses a value that nothing validated,
 * which is strictly worse than never having checked. Every `tid` read in the
 * auth kit whose source may legitimately omit the field — claim sets, options
 * bags, database rows, denial results — goes through here.
 */
export declare function ownTenantId<T extends {
    tid?: unknown;
}>(source: T): T["tid"] | undefined;
