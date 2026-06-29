export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface OtpEntry {
  id: string;
  issuer?: string;
  account: string;
  label: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  created_at: string;
  updated_at: string;
}

export interface StoredOtpEntry extends OtpEntry {
  encrypted_secret: string;
}

export interface OtpStoreFile {
  schema: "open-otp.store.v1";
  created_at: string;
  updated_at: string;
  entries: StoredOtpEntry[];
}

export interface AddOtpEntryInput {
  id?: string;
  issuer?: string;
  account: string;
  label?: string;
  secret: string;
  algorithm?: TotpAlgorithm | string;
  digits?: number;
  period?: number;
}

export interface ImportOtpUriInput {
  uri: string;
  id?: string;
  label?: string;
}

export interface GeneratedTotp {
  code: string;
  period: number;
  expires_at: string;
  expires_in: number;
  counter: number;
}

export interface GeneratedOtpCode extends GeneratedTotp {
  id: string;
  label: string;
  issuer?: string;
  account: string;
}

export interface OtpStorageOptions {
  home?: string;
}

export interface OtpStorageStatus {
  home: string;
  store_path: string;
  key_path: string;
  store_exists: boolean;
  key_exists: boolean;
  entries: number;
  storage: "local-encrypted";
  encrypted_at_rest: true;
}
