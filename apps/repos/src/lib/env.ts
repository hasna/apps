/**
 * Env-var naming standard (2026-08-24): harness apps use the HASNA_<APP>_
 * prefix. Repos already reads most of its surface with HASNA_REPOS_* names
 * (often alongside legacy fallbacks at the read site); the trailing set below
 * is the remainder that only had legacy names. HASNA_REPOS_* is canonical,
 * legacy REPOS_* names remain as a compatibility alias for one deprecation
 * window. Never a silent rename.
 *
 * Reads are lazy (function calls) so callers that set process.env at runtime
 * observe the values they set. Canonical wins when both are set; never set
 * both with different values.
 */
const alias = (canonical: string, legacy: string): string | undefined =>
  process.env[canonical] ?? process.env[legacy];

export const env = {
  serveToken: (): string | undefined => alias("HASNA_REPOS_SERVE_TOKEN", "REPOS_SERVE_TOKEN"),
  port: (): string | undefined => alias("HASNA_REPOS_PORT", "REPOS_PORT"),
  host: (): string | undefined => alias("HASNA_REPOS_HOST", "REPOS_HOST"),
  mcpAllowedOrigins: (): string | undefined =>
    alias("HASNA_REPOS_MCP_ALLOWED_ORIGINS", "REPOS_MCP_ALLOWED_ORIGINS"),
} as const;
