import { spawn } from 'child_process';
import type { ShadcnConfig, CommandResult } from '../types';
import { ShadcnCliError } from '../types';

/**
 * Shadcn CLI Client
 * Wraps the shadcn CLI commands using child_process
 */
export class ShadcnClient {
  private readonly cwd: string;
  private readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';

  constructor(config: ShadcnConfig = {}) {
    this.cwd = config.cwd || process.cwd();
    this.packageManager = config.packageManager || 'npx';
  }

  /**
   * Execute a shadcn CLI command
   */
  async execute(args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const npxArgs = ['shadcn@latest', ...args];

      const child = spawn('npx', npxArgs, {
        cwd: this.cwd,
        shell: true,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Force non-interactive mode
          CI: 'true',
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const exitCode = code ?? 0;
        const result: CommandResult = {
          success: exitCode === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
        };

        if (exitCode !== 0) {
          reject(new ShadcnCliError(
            `Shadcn CLI command failed: ${args.join(' ')}`,
            exitCode,
            stderr.trim()
          ));
        } else {
          resolve(result);
        }
      });

      child.on('error', (error) => {
        reject(new ShadcnCliError(
          `Failed to execute shadcn CLI: ${error.message}`,
          1,
          error.message
        ));
      });
    });
  }

  /**
   * Execute command and return output as string
   */
  async run(args: string[]): Promise<string> {
    const result = await this.execute(args);
    return result.stdout;
  }

  /**
   * Get the current working directory
   */
  getCwd(): string {
    return this.cwd;
  }
}
