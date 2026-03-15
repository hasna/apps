// Process supervisor — manages background processes for agents and humans

import { spawn, type ChildProcess } from "child_process";
import { createConnection } from "net";

export interface ManagedProcess {
  pid: number;
  command: string;
  cwd: string;
  port?: number;
  startedAt: number;
  lastOutput: string[];
  exitCode?: number;
}

const processes = new Map<number, { proc: ChildProcess; meta: ManagedProcess }>();

/** Auto-detect port from common commands */
function detectPort(command: string): number | undefined {
  // "next dev -p 3001", "vite --port 4000", etc.
  const portMatch = command.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
  if (portMatch) return parseInt(portMatch[1] ?? portMatch[2] ?? portMatch[3]);

  // Common defaults
  if (/\bnext\s+dev\b/.test(command)) return 3000;
  if (/\bvite\b/.test(command)) return 5173;
  if (/\bnuxt\s+dev\b/.test(command)) return 3000;
  if (/\bremix\s+dev\b/.test(command)) return 5173;
  return undefined;
}

/** Start a background process */
export function bgStart(command: string, cwd?: string): ManagedProcess {
  const workDir = cwd ?? process.cwd();
  const proc = spawn("/bin/zsh", ["-c", command], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const meta: ManagedProcess = {
    pid: proc.pid!,
    command,
    cwd: workDir,
    port: detectPort(command),
    startedAt: Date.now(),
    lastOutput: [],
  };

  const pushOutput = (d: Buffer) => {
    const lines = d.toString().split("\n").filter(l => l.trim());
    meta.lastOutput.push(...lines);
    // Keep last 50 lines
    if (meta.lastOutput.length > 50) {
      meta.lastOutput = meta.lastOutput.slice(-50);
    }
  };

  proc.stdout?.on("data", pushOutput);
  proc.stderr?.on("data", pushOutput);
  proc.on("close", (code) => {
    meta.exitCode = code ?? 0;
  });

  processes.set(proc.pid!, { proc, meta });
  return meta;
}

/** List all managed processes */
export function bgStatus(): ManagedProcess[] {
  const result: ManagedProcess[] = [];
  for (const [pid, { proc, meta }] of processes) {
    // Check if still alive
    try {
      process.kill(pid, 0);
      result.push({ ...meta, lastOutput: meta.lastOutput.slice(-5) });
    } catch {
      // Process is dead
      result.push({ ...meta, exitCode: meta.exitCode ?? -1, lastOutput: meta.lastOutput.slice(-5) });
    }
  }
  return result;
}

/** Stop a background process */
export function bgStop(pid: number): boolean {
  const entry = processes.get(pid);
  if (!entry) return false;
  try {
    entry.proc.kill("SIGTERM");
    processes.delete(pid);
    return true;
  } catch {
    return false;
  }
}

/** Get logs for a background process */
export function bgLogs(pid: number, tail: number = 20): string[] {
  const entry = processes.get(pid);
  if (!entry) return [];
  return entry.meta.lastOutput.slice(-tail);
}

/** Wait for a port to be ready */
export function bgWaitPort(port: number, timeoutMs: number = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }

      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.on("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        sock.destroy();
        setTimeout(check, 500);
      });
    };

    check();
  });
}
