export interface QualysConfig { username: string; password: string; platform?: string; }

export interface QSHostAsset { id: number; name: string; ip: string; os: string; lastVulnScan: string; trackingMethod: string; created: string; modified: string; tags: { name: string }[]; }
export interface QSHostAssetList { data: { HostAsset: QSHostAsset[] }; count: number; }
export interface QSVulnerability { qid: number; title: string; severity: number; category: string; patchable: boolean; published: string; modified: string; cvss_base: number; cve_list: string[]; diagnosis: string; solution: string; }
export interface QSScan { id: string; title: string; type: string; status: { state: string }; launch_datetime: string; duration: string; target: string; processed: number; }
export interface QSReport { id: number; title: string; type: string; status: { state: string }; size: string; creation_datetime: string; }

export class QualysApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'QualysApiError'; this.statusCode = statusCode; }
}
