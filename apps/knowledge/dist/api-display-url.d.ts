/**
 * Display-URL normalization for the Hasna API gateway (issue #1588).
 *
 * The station wrappers and Keychain configure the gateway form
 * `https://api.hasna.com/<app>` (no `/v1`); requests go to
 * `https://api.hasna.com/<app>/v1/...`. Status and whoami surfaces must
 * therefore print the RESOLVED `/v1` root — never a bare base URL and never
 * the origin alone (which no longer even identifies the app behind the shared
 * gateway).
 *
 * Normalization is intentionally limited to the gateway form. Legacy per-app
 * origins (allowed for todos until hasna/apps#1512 ships) and
 * self-hosted/custom endpoints keep the caller's existing display behavior:
 * this helper returns `null` for anything that is not
 * `https://api.hasna.com/<app>` or the already-resolved
 * `https://api.hasna.com/<app>/v1`.
 */
export declare function gatewayApiV1Root(raw: string | null | undefined): string | null;
