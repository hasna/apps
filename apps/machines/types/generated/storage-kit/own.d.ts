/**
 * Read `key` from `source` only when `source` OWNS it.
 *
 * Returns `undefined` for an inherited property and for a null/undefined or
 * non-object source, so a guarded read is a drop-in for `source?.[key]` that
 * cannot be answered by the prototype chain.
 */
export declare function ownProp<T>(source: unknown, key: string): T | undefined;
/** `ownProp` narrowed to a string, so a polluted non-string cannot slip through. */
export declare function ownString(source: unknown, key: string): string | undefined;
