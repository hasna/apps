import { type SecureLocalStorePolicy } from "./schemas";
export declare const SECURE_LOCAL_STORE_POLICY_VERSION = "2026-07-06";
export declare const DEFAULT_SECURE_LOCAL_STORE_POLICY: SecureLocalStorePolicy;
export declare function secureLocalStorePolicy(stores?: string[]): SecureLocalStorePolicy;
