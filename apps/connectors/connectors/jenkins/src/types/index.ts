export interface JenkinsConfig { url: string; username: string; apiToken: string; }

export interface JKJob { name: string; url: string; color: string; fullName: string; description: string; buildable: boolean; lastBuild: { number: number; url: string } | null; lastSuccessfulBuild: { number: number; url: string } | null; lastFailedBuild: { number: number; url: string } | null; }
export interface JKBuild { number: number; url: string; result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | null; building: boolean; duration: number; estimatedDuration: number; timestamp: number; displayName: string; description: string | null; changeSets: { items: { msg: string; author: { fullName: string } }[] }[]; }
export interface JKQueue { items: { id: number; why: string; task: { name: string; url: string }; inQueueSince: number }[]; }
export interface JKNode { displayName: string; description: string; idle: boolean; jnlpAgent: boolean; numExecutors: number; offline: boolean; temporarilyOffline: boolean; }
export interface JKView { name: string; url: string; jobs: { name: string; url: string; color: string }[]; }

export class JenkinsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'JenkinsApiError'; this.statusCode = statusCode; }
}
