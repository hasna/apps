export type SecretType = "api_key" | "password" | "token" | "credential" | "other";
export type VaultItemKind =
  | "login"
  | "address"
  | "identity"
  | "payment_card"
  | "secure_note"
  | "api_key"
  | "custom";

export interface SecretEntry {
  key: string;
  value: string;
  type: SecretType;
  label?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export type SecretMetadata = Omit<SecretEntry, "value">;

export type VaultItemPayload = Record<string, unknown>;

export interface VaultItem {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle?: string;
  domains: string[];
  tags: string[];
  favorite: boolean;
  data: VaultItemPayload;
  created_at: string;
  updated_at: string;
}

export type VaultItemMetadata = Omit<VaultItem, "data">;

export interface VaultItemInput {
  id?: string;
  kind: VaultItemKind;
  title: string;
  subtitle?: string;
  domains?: string[];
  tags?: string[];
  favorite?: boolean;
  data: VaultItemPayload;
}

export interface AuditEntry {
  id: number;
  action: "get" | "set" | "delete";
  key: string;
  agent: string;
  timestamp: string;
}

export type AwsCredentialMode = "static" | "default" | "profile" | "role";

export interface AwsConfig {
  access_key_id?: string;
  secret_access_key?: string;
  session_token?: string;
  region?: string;
  prefix?: string;
  credential_mode?: AwsCredentialMode;
  profile?: string;
  role_arn?: string;
  source_profile?: string;
  external_id?: string;
  session_name?: string;
}
