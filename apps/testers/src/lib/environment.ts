/**
 * Auto-detect the environment from the URL and annotate test runs
 * with prod/staging/dev environment information.
 */

export type Environment = "production" | "staging" | "development" | "unknown";

export interface EnvironmentInfo {
  env: Environment;
  host: string;
  protocol: string;
  domain: string;
  label: string;
}

/**
 * Detect the environment from a URL.
 * Uses host patterns to determine prod vs staging vs dev.
 */
export function detectEnvironment(url: string): EnvironmentInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { env: "unknown", host: url, protocol: "", domain: url, label: "Unknown" };
  }

  const host = parsed.host.toLowerCase();
  const domain = parsed.hostname;

  // Detect from common patterns
  let env: Environment;
  if (
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".local") ||
    domain.includes("dev.") ||
    domain.startsWith("dev-")
  ) {
    env = "development";
  } else if (
    host.includes("staging") ||
    host.includes("stage") ||
    host.includes("preprod") ||
    host.includes("preview") ||
    host.includes("pr-") ||
    host.includes("review.") ||
    domain.includes("staging.") ||
    domain.includes("test.") ||
    domain.includes("uat.")
  ) {
    env = "staging";
  } else if (
    !host.includes("localhost") &&
    !host.includes("staging") &&
    !host.includes("dev.")
  ) {
    env = "production";
  } else {
    env = "unknown";
  }

  const labels: Record<Environment, string> = {
    production: "Production",
    staging: "Staging",
    development: "Development",
    unknown: "Unknown",
  };

  return {
    env,
    host,
    protocol: parsed.protocol.replace(":", ""),
    domain,
    label: labels[env],
  };
}

/**
 * Override environment detection via environment variable.
 */
export function getEnvironmentOverride(): Environment | null {
  const val = process.env.TESTERS_ENV?.toLowerCase();
  if (val === "production" || val === "prod") return "production";
  if (val === "staging" || val === "stage") return "staging";
  if (val === "development" || val === "dev") return "development";
  return null;
}

/**
 * Get environment info for a URL, respecting any override.
 */
export function getEnvInfo(url: string): EnvironmentInfo {
  const override = getEnvironmentOverride();
  const detected = detectEnvironment(url);

  if (override) {
    return { ...detected, env: override, label: override.charAt(0).toUpperCase() + override.slice(1) };
  }

  return detected;
}