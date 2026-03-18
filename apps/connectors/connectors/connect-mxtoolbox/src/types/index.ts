export interface MXToolboxConfig { apiKey: string; }

export interface MXLookupResult { CommandArgument: string; IsTransitioned: boolean; RelatedIP: string; Information: MXLookupInfo[]; Failed: MXLookupFailed[]; Passed: MXLookupPassed[]; Warnings: MXLookupWarning[]; Errors: string[]; Timeouts: string[]; }
export interface MXLookupInfo { Type: string; Description: string; Value: string; }
export interface MXLookupFailed { ID: number; Name: string; Info: string; Url: string; }
export interface MXLookupPassed { ID: number; Name: string; Info: string; }
export interface MXLookupWarning { ID: number; Name: string; Info: string; }
export interface MXMonitor { Domain: string; MxRep: number; Status: string; LastChecked: string; }
export interface MXUsage { RequestsUsed: number; RequestsRemaining: number; }

export class MXToolboxApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MXToolboxApiError'; this.statusCode = statusCode; }
}
