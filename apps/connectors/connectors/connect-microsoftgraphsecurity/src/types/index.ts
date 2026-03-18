export interface MSGraphSecurityConfig { token: string; }

export interface MSAlert { id: string; title: string; description: string; severity: 'informational' | 'low' | 'medium' | 'high' | 'unknown'; status: 'new' | 'inProgress' | 'resolved' | 'unknown'; category: string; assignedTo: string | null; createdDateTime: string; lastModifiedDateTime: string; source: string; recommendedActions: string[]; }
export interface MSAlertList { value: MSAlert[]; '@odata.nextLink'?: string; }
export interface MSIncident { id: string; displayName: string; description: string; severity: string; status: string; assignedTo: string | null; createdDateTime: string; lastUpdateDateTime: string; alerts: { id: string; title: string }[]; }
export interface MSIncidentList { value: MSIncident[]; '@odata.nextLink'?: string; }
export interface MSSecureScore { id: string; currentScore: number; maxScore: number; averageComparativeScore: number; createdDateTime: string; }

export class MSGraphSecurityApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MSGraphSecurityApiError'; this.statusCode = statusCode; }
}
