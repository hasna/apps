export interface ClientTransportEnvKeys {
    /** API base-URL keys, in precedence order. */
    apiUrlKeys: string[];
    /** API-key keys, in precedence order. */
    apiKeyKeys: string[];
}
/** Resolve the canonical client-flip env-key spec for an app. */
export declare function clientTransportEnvKeys(name: string): ClientTransportEnvKeys;
/**
 * The deliberate per-service override key.
 *
 * The whole point of this variable is that NOTHING populates it automatically.
 * Shell init auto-exports the fleet credential files into every shell, which is
 * why the presence of `HASNA_<NAME>_API_KEY` carries no signal about intent —
 * unlike `AWS_ACCESS_KEY_ID`, which is only ever set on purpose. This name is
 * reserved for a human or a CI job that means it, so it is the one env tier
 * that may outrank the credential on disk.
 */
export declare function credentialOverrideEnvKey(name: string): string;
/** The global profile pointer. Selects WHICH identity, never carries a secret. */
export declare const CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE";
