import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface BenchPaths {
  home: string;
  dbPath: string;
  runsDir: string;
  artifactsDir: string;
}

export function resolveBenchHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HASNA_BENCH_HOME || join(env.HOME || ".", ".hasna", "bench");
}

export function resolveBenchPaths(env: NodeJS.ProcessEnv = process.env): BenchPaths {
  const home = resolveBenchHome(env);
  return {
    home,
    dbPath: env.HASNA_BENCH_DB_PATH || join(home, "bench.db"),
    runsDir: join(home, "runs"),
    artifactsDir: join(home, "artifacts")
  };
}

export async function ensureBenchDirs(paths: BenchPaths = resolveBenchPaths()): Promise<BenchPaths> {
  await mkdir(paths.home, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  return paths;
}
