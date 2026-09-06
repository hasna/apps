/**
 * Shared CLI-only administrator opt-in for intentional private webhook ingress.
 * The transport still requires an exact hostname/IP allowlist match and pins
 * the validated address. SDK clients do not read this setting automatically.
 */
export declare function webhookTargetPolicyFromEnv(): {
    allowPrivateHosts: string[];
} | undefined;
