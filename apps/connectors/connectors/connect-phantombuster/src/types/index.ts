export interface PhantomBusterConfig { apiKey: string; }

export interface PBAgent { id: string; name: string; scriptId: string; lastEndMessage: string; lastEndStatus: string; userAwsFolder: string; s3Folder: string; executionFrequency: string; fileMgmt: string; nbLaunches: number; showDebug: boolean; }
export interface PBContainer { id: string; agentId: string; status: string; progress: number; launchType: string; startDate: string; endDate: string | null; exitMessage: string | null; output: string | null; resultObject: string | null; }
export interface PBOutput { containerId: string; output: string; resultObject: Record<string, unknown> | null; }

export class PhantomBusterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PhantomBusterApiError'; this.statusCode = statusCode; }
}
