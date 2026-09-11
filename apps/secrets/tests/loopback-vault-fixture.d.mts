export function startLoopbackVault(root: string, options?: { dbPath?: string; keyDir?: string; bun?: string }): Promise<{
  url: string; token: string; dbPath: string; keyDir: string; clientHome: string;
  env(): Record<string,string>; stop(): Promise<void>;
}>;
