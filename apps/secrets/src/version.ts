// Service version. Kept in sync with package.json on release.
// Runtime override: HASNA_SECRETS_VERSION.
export const VERSION = process.env.HASNA_SECRETS_VERSION ?? "0.3.13";
