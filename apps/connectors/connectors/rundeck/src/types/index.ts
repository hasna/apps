export interface RundeckConfig { url: string; token: string; apiVersion?: number; }

export interface RDProject { name: string; description: string; url: string; }
export interface RDJob { id: string; name: string; group: string; project: string; description: string; href: string; scheduled: boolean; enabled: boolean; averageDuration: number; }
export interface RDExecution { id: number; href: string; status: 'running' | 'succeeded' | 'failed' | 'aborted'; project: string; job: { id: string; name: string; group: string }; date_started: { unixtime: number; date: string }; date_ended: { unixtime: number; date: string } | null; }
export interface RDExecutionList { executions: RDExecution[]; paging: { count: number; total: number; offset: number; max: number }; }
export interface RDNode { nodename: string; hostname: string; osName: string; osVersion: string; osArch: string; tags: string; }

export class RundeckApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RundeckApiError'; this.statusCode = statusCode; }
}
