declare module "@hasna/logs" {
  export class LogsClient {
    constructor(opts?: {
      apiKey?: string;
      projectId?: string;
      baseUrl?: string;
      url?: string;
    });
    push(entry: {
      level: string;
      message: string;
      source?: string;
      service?: string;
      stack_trace?: string;
      trace_id?: string;
      metadata?: Record<string, unknown>;
    }): Promise<void>;
  }
}
