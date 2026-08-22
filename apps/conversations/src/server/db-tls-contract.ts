/**
 * conversations-serve database TLS contract (I38-00559).
 *
 * The serve's API-key verification performs a per-request key-status lookup in
 * the database (verifyApiKey -> keyStatus -> ApiKeyStore). If the database TLS
 * handshake cannot complete, EVERY lookup throws and EVERY authenticated /v1
 * request answers 503 status_unavailable ("Could not verify API key status")
 * while /health and /version report ok — a fleet-wide auth outage with a
 * healthy-looking process. Measured in production 2026-08-21 on the 0.7.1
 * image (incident 719261): the pinned @hasna/contracts 0.13.1 vendored storage
 * kit resolves `sslmode=require` as `{ rejectUnauthorized: true }` (verify the
 * server certificate against the trust store; the 0.4.2 kit returned
 * `{ rejectUnauthorized: false }`, encrypt without verification), and the
 * image carried no RDS CA bundle, so the handshake failed on every connection
 * ("self signed certificate in certificate chain").
 *
 * That state must be impossible to boot into silently: a database DSN that
 * demands certificate verification with no resolvable CA bundle is a
 * BOOT-TIME refusal, not a fleet-wide 503. The CA bundle itself (and the
 * migrate image) is I38-00558's lane; this guard is the serve's own half of
 * the same defect — it converts the failure from a silent outage into a loud,
 * self-describing boot failure at the deploy boundary.
 */
import {
  resolveTlsConfig,
  sslModeFromConnectionString,
  type PgSslConfig,
} from "../generated/storage-kit/index.js";

const CA_REQUIRED_MESSAGE =
  "conversations-serve refuses to boot: the database DSN uses sslmode " +
  "verification (require/verify-ca/verify-full), which the storage kit resolves with " +
  "server-certificate verification (rejectUnauthorized: true), but no CA bundle is " +
  "resolvable. Without the CA the key-status lookup behind API-key auth fails on every " +
  "request — POST /v1/* answers 503 status_unavailable ('Could not verify API key status') " +
  "while /health reports ok, a fleet-wide auth outage (I38-00559). " +
  "Set PGSSLROOTCERT (or NODE_EXTRA_CA_CERTS) to the Amazon RDS global bundle: " +
  "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";

/**
 * Assert the serve's database TLS contract before a pool is constructed.
 *
 * Throws when the DSN demands certificate verification and no CA bundle is
 * resolvable through the kit's supported surface (explicit `ca` / `caCertPath`,
 * PGSSLROOTCERT, NODE_EXTRA_CA_CERTS). No-op for the sqlite backend (no DSN),
 * for `sslmode=disable`, and for `prefer` (no forced verification). Resolving
 * the same TLS config the pool construction will use keeps the guard and the
 * connection honest with each other.
 */
export function assertDbTlsContract(
  dsn: string | null,
  env: Record<string, string | undefined> = process.env,
  options: { ca?: string; caCertPath?: string } = {},
): void {
  if (!dsn || !dsn.trim()) return; // sqlite backend — no database TLS contract.
  const mode = sslModeFromConnectionString(dsn);
  if (mode === "disable" || mode === "prefer") return; // no forced verification.

  let ssl: PgSslConfig | undefined;
  try {
    ssl = resolveTlsConfig(dsn, { ...options, env });
  } catch {
    // verify-ca/verify-full without a CA already throws here; same remedy,
    // same message — one failure surface for the operator to read.
    throw new Error(CA_REQUIRED_MESSAGE);
  }
  if (ssl === undefined || ssl === false) return;
  if (ssl === true) {
    // pg's bare `ssl: true`: verify against the default trust store, which
    // cannot contain the RDS root — the handshake can never complete.
    throw new Error(CA_REQUIRED_MESSAGE);
  }
  // An object with rejectUnauthorized !== false verifies against a trust
  // store; without a pinned `ca` the store cannot contain the RDS root, so
  // the handshake can never complete. An explicit
  // `{ rejectUnauthorized: false }` (encrypt-only) passes — it does not
  // depend on any trust store.
  if (ssl.rejectUnauthorized !== false && !ssl.ca) {
    throw new Error(CA_REQUIRED_MESSAGE);
  }
}
