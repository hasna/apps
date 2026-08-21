import { ApiKeyStore } from "../auth/store";
import { type SecretsBridgeClient, type SecretsBridgeClientOptions } from "./secrets-bridge";
type IssueKeyStore = Pick<ApiKeyStore, "ensureSchema" | "insertMinted"> & Partial<Pick<ApiKeyStore, "revoke" | "insertMintedPending" | "activatePending" | "findByKid">>;
type IssueKeyStoreHandle = {
    store: IssueKeyStore;
    close: () => Promise<void>;
};
type IssueKeyConnectStore = (connectionString: string, table: string) => Promise<IssueKeyStoreHandle>;
type IssueKeySecretsClient = Pick<SecretsBridgeClient, "putSecret" | "deleteSecret"> & Partial<Pick<SecretsBridgeClient, "listSecrets">>;
type SecretsServiceConfig = Required<Pick<SecretsBridgeClientOptions, "baseUrl" | "apiKey">>;
type IssueKeyConnectSecrets = (config: SecretsServiceConfig) => Promise<IssueKeySecretsClient>;
export interface IssueKeyDeps {
    report: (options: {
        json?: boolean;
    }, error: string, details?: Record<string, unknown>) => void;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    connectStore?: IssueKeyConnectStore;
    connectSecrets?: IssueKeyConnectSecrets;
}
/** Resolve the signing-secret env var name (never the value) for messages. */
export declare function signingSecretEnvName(app: string, override?: string): string;
/** Resolve the database-url env var name for the record store. */
export declare function databaseUrlEnvName(app: string, override?: string): string;
export declare function runIssueKey(options: Record<string, unknown>, deps: IssueKeyDeps): Promise<void>;
export {};
