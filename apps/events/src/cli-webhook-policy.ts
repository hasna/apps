/**
 * Shared CLI-only administrator opt-in for intentional private webhook ingress.
 * The transport still requires an exact hostname/IP allowlist match and pins
 * the validated address. SDK clients do not read this setting automatically.
 */
export function webhookTargetPolicyFromEnv(): { allowPrivateHosts: string[] } | undefined {
  const value = process.env.HASNA_EVENTS_ALLOW_PRIVATE_WEBHOOK_TARGETS;
  if (!value) return undefined;
  const hosts = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return hosts.length > 0 ? { allowPrivateHosts: hosts } : undefined;
}
