// Type definitions for the Tenable Vulnerability Management (Tenable.io) connector.
// Built against the public Tenable.io REST API (https://developer.tenable.com/reference).

export interface TenableConfig {
  /** Tenable API access key (X-ApiKeys accessKey). */
  accessKey: string;
  /** Tenable API secret key (X-ApiKeys secretKey). */
  secretKey: string;
  /** API base URL. Defaults to https://cloud.tenable.com. */
  baseUrl?: string;
}

/** A scan configuration as returned by GET /scans. */
export interface TenableScan {
  id: number;
  uuid?: string;
  name: string;
  status: string;
  owner?: string;
  enabled?: boolean;
  folder_id?: number;
  read?: boolean;
  shared?: boolean;
  type?: string;
  creation_date?: number;
  last_modification_date?: number;
  starttime?: string;
  timezone?: string;
}

export interface TenableScanList {
  scans: TenableScan[];
  folders?: TenableFolder[];
  timestamp?: number;
}

/** An asset as returned by GET /workbenches/assets. */
export interface TenableAsset {
  id: string;
  has_agent?: boolean;
  last_seen?: string;
  sources?: { name: string; first_seen?: string; last_seen?: string }[];
  ipv4?: string[];
  ipv6?: string[];
  fqdn?: string[];
  netbios_name?: string[];
  operating_system?: string[];
  agent_name?: string[];
  aws_ec2_name?: string[];
  mac_address?: string[];
}

export interface TenableAssetList {
  assets: TenableAsset[];
  total?: number;
}

/** A vulnerability aggregation row from GET /workbenches/vulnerabilities. */
export interface TenableVulnerability {
  plugin_id: number;
  plugin_name: string;
  plugin_family?: string;
  count: number;
  vulnerability_state?: string;
  accepted_count?: number;
  recasted_count?: number;
  counts_by_severity?: { count: number; value: number }[];
  severity?: number;
}

export interface TenableVulnerabilityList {
  vulnerabilities: TenableVulnerability[];
  total_vulnerability_count?: number;
  total_asset_count?: number;
}

/** A scanner as returned by GET /scanners. */
export interface TenableScanner {
  id: number;
  uuid?: string;
  name: string;
  type?: string;
  status?: string;
  scanner_type?: string;
  engine_version?: string;
  platform?: string;
  loaded_plugin_set?: string;
  num_scans?: number;
}

export interface TenableScannerList {
  scanners: TenableScanner[];
}

/** A folder as returned by GET /folders. */
export interface TenableFolder {
  id: number;
  name: string;
  type?: string;
  default_tag?: number;
  custom?: number;
  unread_count?: number;
}

export interface TenableFolderList {
  folders: TenableFolder[];
}

/** Current API session details from GET /session. */
export interface TenableSession {
  id?: number;
  username?: string;
  email?: string;
  name?: string;
  type?: string;
  permissions?: number;
  enabled?: boolean;
  container_id?: number;
  uuid?: string;
}

/** Error thrown for non-2xx responses from the Tenable API. */
export class TenableApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TenableApiError';
    this.statusCode = statusCode;
  }
}
