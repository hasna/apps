export interface SmolMachinesConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface Machine {
  name: string;
  state?: string;
  cpus?: number;
  memoryMb?: number;
  mem?: number;
  network?: boolean;
  image?: string;
  from?: string;
  [key: string]: unknown;
}

export interface CreateMachineRequest {
  name: string;
  network?: boolean;
  net?: boolean;
  cpus?: number;
  mem?: number;
  memoryMb?: number;
  image?: string;
  from?: string;
  [key: string]: unknown;
}

export interface ExecRequest {
  command: string[];
  [key: string]: unknown;
}

export interface ExecResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class SmolMachinesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'SmolMachinesApiError';
  }
}
