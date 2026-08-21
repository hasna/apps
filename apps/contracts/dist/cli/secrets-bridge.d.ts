export interface SecretMetadata {
    key: string;
    type: "api_key" | "password" | "token" | "credential" | "other";
    label?: string | null;
    expires_at?: string | null;
    created_at: string;
    updated_at: string;
}
export interface SecretInput {
    key: string;
    value: string;
    type?: "api_key" | "password" | "token" | "credential" | "other";
    label?: string;
    ttl?: string;
}
export interface SecretsBridgeClientOptions {
    baseUrl: string;
    apiKey?: string;
}
export interface SecretsBridgeClient {
    listSecrets(query?: {
        namespace?: string;
    }): Promise<{
        secrets?: SecretMetadata[];
    }>;
    putSecret(body: SecretInput): Promise<SecretMetadata>;
    deleteSecret(query?: {
        key: string;
    }): Promise<Record<string, unknown>>;
}
/**
 * Build a Secrets client from explicit configuration only. Empty env plus
 * explicit overrides prevents the SDK's legacy-first ambient resolver from
 * selecting a different URL/key pair after validation (the caller has already
 * collapsed the canonical and legacy aliases into one authority).
 */
export declare function createSecretsBridgeClient(options: SecretsBridgeClientOptions): Promise<SecretsBridgeClient>;
