import type { Database } from "bun:sqlite";
import { findLocal, type FindKind, type FindOptions } from "./find.js";
import { listRoots } from "./indexer.js";

export interface LocalBenchmarkOptions extends Omit<FindOptions, "refresh"> {
  iterations?: number;
  warmups?: number;
  refresh?: boolean;
}

export interface LocalBenchmarkRow {
  query: string;
  kind: FindKind;
  iterations: number;
  resultCount: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface LocalBenchmarkReport {
  roots: number;
  files: number;
  rows: LocalBenchmarkRow[];
}

function clampIterations(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function clampWarmups(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function percentile(sorted: number[], p: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

export function benchmarkLocalSearch(
  queries: string[],
  opts: LocalBenchmarkOptions = {},
  db?: Database,
): LocalBenchmarkReport {
  const filteredQueries = queries.map((query) => query.trim()).filter(Boolean);
  if (filteredQueries.length === 0) throw new Error("At least one benchmark query is required.");

  const iterations = clampIterations(opts.iterations, 5);
  const warmups = clampWarmups(opts.warmups);
  const kind = opts.kind ?? "both";
  const refresh = opts.refresh ?? false;
  const roots = listRoots(db);

  const rows = filteredQueries.map((query) => {
    for (let i = 0; i < warmups; i++) {
      findLocal(query, { ...opts, kind, refresh }, db);
    }

    const durations: number[] = [];
    let resultCount = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const response = findLocal(query, { ...opts, kind, refresh }, db);
      durations.push(performance.now() - start);
      resultCount = response.results.length;
    }

    const sorted = durations.sort((a, b) => a - b);
    return {
      query,
      kind,
      iterations,
      resultCount,
      minMs: roundMs(sorted[0] ?? 0),
      p50Ms: roundMs(percentile(sorted, 0.5)),
      p95Ms: roundMs(percentile(sorted, 0.95)),
      maxMs: roundMs(sorted[sorted.length - 1] ?? 0),
    };
  });

  return {
    roots: roots.length,
    files: roots.reduce((total, root) => total + root.fileCount, 0),
    rows,
  };
}
