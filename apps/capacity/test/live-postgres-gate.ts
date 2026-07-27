/**
 * Gate for the live PostgreSQL suite.
 *
 * The live suite is the only coverage of cross-principal RLS isolation, so it
 * must never degrade into a silent skip inside CI. Outside CI a skip is the
 * correct behaviour (no database is expected); inside CI a missing connection
 * URL means the postgres service was removed, and that has to fail loudly
 * instead of reporting a green run.
 */

export const LIVE_POSTGRES_URL_VARIABLE = "HASNA_CAPACITY_TEST_DATABASE_URL";
export const LEGACY_LIVE_POSTGRES_URL_VARIABLE = "ACCOUNTS_TEST_POSTGRES_URL";

export interface EnvironmentLike {
  readonly [key: string]: string | undefined;
}

export type LivePostgresGate =
  | { readonly mode: "run"; readonly url: string }
  | { readonly mode: "skip"; readonly reason: string }
  | { readonly mode: "fail"; readonly reason: string };

function isContinuousIntegration(environment: EnvironmentLike): boolean {
  const flag = environment.CI;
  if (flag === undefined) return false;
  const normalized = flag.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function resolveLivePostgresGate(
  environment: EnvironmentLike = process.env,
): LivePostgresGate {
  const url =
    environment[LIVE_POSTGRES_URL_VARIABLE] ??
    environment[LEGACY_LIVE_POSTGRES_URL_VARIABLE];

  if (url !== undefined && url.trim() !== "") {
    return { mode: "run", url };
  }

  if (isContinuousIntegration(environment)) {
    return {
      mode: "fail",
      reason:
        `${LIVE_POSTGRES_URL_VARIABLE} is not set in CI, so the live PostgreSQL suite ` +
        "would silently skip and cross-principal RLS isolation would go unverified. " +
        "Restore the CI postgres service and its connection URL.",
    };
  }

  return {
    mode: "skip",
    reason:
      `${LIVE_POSTGRES_URL_VARIABLE} is not set: skipping the live PostgreSQL suite outside CI.`,
  };
}
