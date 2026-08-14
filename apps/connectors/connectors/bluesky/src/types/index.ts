// Bluesky / AT Protocol types

export interface BlueskyConfig {
  /** Handle or DID, e.g. "alice.bsky.social" */
  identifier: string;
  /** App password (NOT the account password) */
  appPassword: string;
  /** Personal Data Server base URL. Defaults to https://bsky.social */
  pds?: string;
}

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
  email?: string;
}

/** A strong-ref to an AT Protocol record (used for reply roots/parents). */
export interface AtUriRef {
  uri: string;
  cid: string;
}

export interface CreateRecordResult {
  uri: string;
  cid: string;
}

export interface BlueskyApiErrorBody {
  error?: string;
  message?: string;
}

export class BlueskyApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.name = "BlueskyApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}
