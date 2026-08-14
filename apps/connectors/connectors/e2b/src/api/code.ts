import type { E2BClient } from './client';
import type {
  ExecutionResult,
  ExecuteCodeOptions,
  ExecuteCommandOptions,
  ProcessInfo,
} from '../types';

/**
 * Code Execution API - Execute code and commands in E2B sandboxes
 */
export class CodeApi {
  constructor(private readonly client: E2BClient) {}

  /**
   * Execute code in a sandbox
   * @param sandboxId - The sandbox ID
   * @param options - Code execution options
   * @returns Execution result with stdout/stderr
   */
  async execute(sandboxId: string, options: ExecuteCodeOptions): Promise<ExecutionResult> {
    const body: Record<string, unknown> = {
      code: options.code,
    };

    if (options.language) {
      body.language = options.language;
    }
    if (options.workDir) {
      body.workDir = options.workDir;
    }
    if (options.envs) {
      body.envVars = options.envs;
    }
    if (options.timeout !== undefined) {
      body.timeout = options.timeout;
    }

    return this.client.post<ExecutionResult>(`/sandboxes/${sandboxId}/code`, body);
  }

  /**
   * Execute code with a specific language (convenience method)
   * @param sandboxId - The sandbox ID
   * @param code - The code to execute
   * @param language - Programming language
   */
  async executeCode(sandboxId: string, code: string, language?: string): Promise<ExecutionResult> {
    return this.execute(sandboxId, { code, language });
  }

  /**
   * Execute Python code
   * @param sandboxId - The sandbox ID
   * @param code - Python code to execute
   */
  async python(sandboxId: string, code: string): Promise<ExecutionResult> {
    return this.execute(sandboxId, { code, language: 'python' });
  }

  /**
   * Execute JavaScript code
   * @param sandboxId - The sandbox ID
   * @param code - JavaScript code to execute
   */
  async javascript(sandboxId: string, code: string): Promise<ExecutionResult> {
    return this.execute(sandboxId, { code, language: 'javascript' });
  }

  /**
   * Execute a file in the sandbox
   * @param sandboxId - The sandbox ID
   * @param filePath - Path to the file to execute
   * @param options - Additional execution options
   */
  async executeFile(sandboxId: string, filePath: string, options: Partial<ExecuteCodeOptions> = {}): Promise<ExecutionResult> {
    // Determine language from file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'sh': 'bash',
      'bash': 'bash',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'php': 'php',
      'pl': 'perl',
      'cs': 'dotnet',
    };

    const language = ext ? languageMap[ext] : undefined;

    // Execute file via command
    return this.runCommand(sandboxId, {
      command: this.getRunCommand(filePath, language),
      workDir: options.workDir,
      envs: options.envs,
      timeout: options.timeout,
    });
  }

  /**
   * Run a shell command in the sandbox
   * @param sandboxId - The sandbox ID
   * @param options - Command execution options
   */
  async runCommand(sandboxId: string, options: ExecuteCommandOptions): Promise<ExecutionResult> {
    const body: Record<string, unknown> = {
      command: options.command,
    };

    if (options.workDir) {
      body.workDir = options.workDir;
    }
    if (options.envs) {
      body.envVars = options.envs;
    }
    if (options.timeout !== undefined) {
      body.timeout = options.timeout;
    }
    if (options.background) {
      body.background = options.background;
    }

    return this.client.post<ExecutionResult>(`/sandboxes/${sandboxId}/commands`, body);
  }

  /**
   * Run a command in the background
   * @param sandboxId - The sandbox ID
   * @param command - The command to run
   */
  async runBackground(sandboxId: string, command: string): Promise<ProcessInfo> {
    return this.client.post<ProcessInfo>(`/sandboxes/${sandboxId}/commands`, {
      command,
      background: true,
    });
  }

  /**
   * List running processes in the sandbox
   * @param sandboxId - The sandbox ID
   */
  async listProcesses(sandboxId: string): Promise<ProcessInfo[]> {
    return this.client.get<ProcessInfo[]>(`/sandboxes/${sandboxId}/processes`);
  }

  /**
   * Kill a process in the sandbox
   * @param sandboxId - The sandbox ID
   * @param pid - Process ID to kill
   */
  async killProcess(sandboxId: string, pid: number): Promise<void> {
    await this.client.delete(`/sandboxes/${sandboxId}/processes/${pid}`);
  }

  /**
   * Get the appropriate run command for a file based on language
   */
  private getRunCommand(filePath: string, language?: string): string {
    switch (language) {
      case 'python':
        return `python3 ${filePath}`;
      case 'javascript':
        return `node ${filePath}`;
      case 'typescript':
        return `npx ts-node ${filePath}`;
      case 'bash':
        return `bash ${filePath}`;
      case 'go':
        return `go run ${filePath}`;
      case 'rust':
        return `rustc ${filePath} -o /tmp/out && /tmp/out`;
      case 'java':
        return `java ${filePath}`;
      case 'php':
        return `php ${filePath}`;
      case 'perl':
        return `perl ${filePath}`;
      case 'dotnet':
        return `dotnet run ${filePath}`;
      default:
        return filePath;
    }
  }
}
