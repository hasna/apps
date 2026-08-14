import { createReadStream } from "fs";
import { createInterface } from "readline";
import type { EvalCase } from "../types/index.js";

export interface LoadOptions {
  /** Fail hard on malformed lines instead of warning and skipping */
  strict?: boolean;
  /** Filter by tags */
  tags?: string[];
}

export interface LoadResult {
  cases: EvalCase[];
  warnings: string[];
  totalLines: number;
  skipped: number;
}

/** Load eval cases from a JSONL or JSON file (or glob pattern) */
export async function loadDataset(pathOrGlob: string, opts: LoadOptions = {}): Promise<LoadResult> {
  // Expand glob
  const paths: string[] = [];
  if (pathOrGlob.includes("*") || pathOrGlob.includes("?")) {
    const glob = new Bun.Glob(pathOrGlob);
    for await (const p of glob.scan(".")) paths.push(p);
    if (paths.length === 0) throw new Error(`No files matched: ${pathOrGlob}`);
  } else {
    paths.push(pathOrGlob);
  }

  const allCases: EvalCase[] = [];
  const allWarnings: string[] = [];
  let totalLines = 0;
  let skipped = 0;

  for (const path of paths) {
    const result = path.endsWith(".json")
      ? await loadJsonFile(path, opts)
      : await loadJsonlFile(path, opts);

    allCases.push(...result.cases);
    allWarnings.push(...result.warnings);
    totalLines += result.totalLines;
    skipped += result.skipped;
  }

  // Filter by tags if provided
  const filtered = opts.tags && opts.tags.length > 0
    ? allCases.filter((c) => c.tags?.some((t) => opts.tags!.includes(t)))
    : allCases;

  return { cases: filtered, warnings: allWarnings, totalLines, skipped };
}

async function loadJsonlFile(path: string, opts: LoadOptions): Promise<LoadResult> {
  const cases: EvalCase[] = [];
  const warnings: string[] = [];
  let lineNum = 0;
  let skipped = 0;

  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue; // skip blank/comment lines

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const validated = validateEvalCase(parsed, `${path}:${lineNum}`);
      if (validated) cases.push(validated);
    } catch (err) {
      const msg = `${path}:${lineNum}: ${err instanceof Error ? err.message : String(err)}`;
      if (opts.strict) throw new Error(msg);
      warnings.push(msg);
      skipped++;
    }
  }

  return { cases, warnings, totalLines: lineNum, skipped };
}

async function loadJsonFile(path: string, opts: LoadOptions): Promise<LoadResult> {
  const warnings: string[] = [];
  let skipped = 0;

  const text = await Bun.file(path).text();
  const parsed = JSON.parse(text) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: JSON file must be an array of eval cases`);
  }

  const cases: EvalCase[] = [];
  for (let i = 0; i < parsed.length; i++) {
    try {
      const validated = validateEvalCase(parsed[i], `${path}[${i}]`);
      if (validated) cases.push(validated);
    } catch (err) {
      const msg = `${path}[${i}]: ${err instanceof Error ? err.message : String(err)}`;
      if (opts.strict) throw new Error(msg);
      warnings.push(msg);
      skipped++;
    }
  }

  return { cases, warnings, totalLines: parsed.length, skipped };
}

function validateEvalCase(raw: unknown, location: string): EvalCase | null {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Expected object, got ${typeof raw}`);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj["id"] !== "string" || !obj["id"]) {
    throw new Error(`Missing required field "id" at ${location}`);
  }

  // Must have either input (string) or turns (array)
  if (!obj["input"] && !obj["turns"]) {
    throw new Error(`Must have "input" or "turns" at ${location}`);
  }

  if (obj["turns"] !== undefined && !Array.isArray(obj["turns"])) {
    throw new Error(`"turns" must be an array at ${location}`);
  }

  // Cast — runtime validation is sufficient here
  return obj as unknown as EvalCase;
}

/** Stream large JSONL files case-by-case (for very large datasets) */
export async function* streamDataset(path: string, opts: LoadOptions = {}): AsyncGenerator<EvalCase> {
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const validated = validateEvalCase(parsed, `${path}:${lineNum}`);
      if (validated) {
        if (!opts.tags || opts.tags.length === 0 || validated.tags?.some((t) => opts.tags!.includes(t))) {
          yield validated;
        }
      }
    } catch (err) {
      if (opts.strict) throw err;
      // skip silently in stream mode
    }
  }
}
