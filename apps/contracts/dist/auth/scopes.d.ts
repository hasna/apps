/** Grant grammar: `*` OR `<part>:<part>`. */
export declare function isValidScope(scope: string): boolean;
/** Required scopes must be concrete `app:action` with no wildcards. */
export declare function isConcreteScope(scope: string): boolean;
/**
 * Does a single GRANTED scope satisfy a concrete REQUIRED scope?
 * Wildcards on the grant side match; the required side must be concrete.
 */
export declare function scopeMatches(granted: string, required: string): boolean;
/** Does ANY granted scope satisfy the concrete required scope? */
export declare function hasScope(granted: readonly string[], required: string): boolean;
/** Do the granted scopes satisfy EVERY required scope? */
export declare function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean;
/** Normalize + validate a list of granted scopes; throws on any invalid token. */
export declare function normalizeScopes(scopes: readonly string[]): string[];
