// @hasna/markdown-sdk — REST client for OMP server

export interface OmpClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export interface ValidateResult {
  valid: boolean;
  cards: number;
  errors: { level: string; message: string; card?: string }[];
  warnings: { level: string; message: string; card?: string }[];
}

export interface CompileResult {
  steps: { parallel: string[]; description: string }[];
  totalCards: number;
}

export interface InspectResult {
  title: string;
  cards: { type: string; id: string; depends: string[]; accepts: string[]; headerKeys: string[] }[];
  executionPlan: CompileResult;
}

export interface LintResult {
  cards: number;
  errors: { level: string; message: string; card?: string }[];
  warnings: { level: string; message: string; card?: string }[];
  info: { level: string; message: string; card?: string }[];
}

export interface RunResult {
  success: boolean;
  cardsExecuted: number;
  cardsTotal: number;
  errors: { level: string; message: string; card?: string }[];
  filesCreated: string[];
  commandsRun: string[];
  llmCalls: number;
  durationMs: number;
}

export class OmpClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: OmpClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:7070").replace(/\/$/, "");
    this.timeout = options.timeout ?? 30000;
  }

  async validate(input: { file?: string; content?: string }): Promise<ValidateResult> {
    return this.post("/validate", input);
  }

  async compile(input: { file?: string; content?: string }): Promise<CompileResult> {
    return this.post("/compile", input);
  }

  async inspect(input: { file?: string; content?: string }): Promise<InspectResult> {
    return this.post("/inspect", input);
  }

  async lint(input: { file?: string; content?: string }): Promise<LintResult> {
    return this.post("/lint", input);
  }

  async run(input: { file: string; output_dir?: string; dry_run?: boolean }): Promise<RunResult> {
    return this.post("/run", input);
  }

  async health(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`OMP server error: ${res.status}`);
    return res.json() as any;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as any;
      throw new Error(err.error ?? `OMP server error: ${res.status}`);
    }
    return res.json() as T;
  }
}

export function createClient(options?: OmpClientOptions): OmpClient {
  return new OmpClient(options);
}
