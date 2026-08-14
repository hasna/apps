export interface Rapid7Config { url: string; username: string; password: string; }

export interface R7Asset { id: number; ip: string; hostName: string; mac: string; os: string; riskScore: number; vulnerabilities: { total: number; critical: number; severe: number; moderate: number }; lastScanTime: string; }
export interface R7AssetList { resources: R7Asset[]; page: { number: number; size: number; totalResources: number; totalPages: number }; }
export interface R7Vulnerability { id: string; title: string; description: string; severity: string; cvss: { v2: { score: number } | null; v3: { score: number } | null }; published: string; modified: string; references: string[]; }
export interface R7Scan { id: number; scanName: string; status: string; startTime: string; endTime: string | null; assets: number; vulnerabilities: { total: number }; }
export interface R7Site { id: number; name: string; description: string; assets: number; riskScore: number; lastScanTime: string; }
export interface R7Report { id: number; name: string; format: string; status: string; generated: string; uri: string; }

export class Rapid7ApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'Rapid7ApiError'; this.statusCode = statusCode; }
}
