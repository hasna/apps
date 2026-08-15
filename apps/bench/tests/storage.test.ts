import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendResultSegment,
  createAttemptRecord,
  createRunRecord,
  DEFAULT_RESULT_SEGMENT_BYTE_LIMIT,
  openBenchStorage,
  recordArtifact,
  recordMetric,
  recordProviderUsage,
  seedBenchmarks,
  sha256Hex,
  syncBenchmarkRegistry
} from "../src/index.js";

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_BENCH_HOME: home,
    HASNA_BENCH_DB_PATH: join(home, "bench.db")
  };
}

describe("@hasna/bench storage", () => {
  it("initializes SQLite schema and seed projections idempotently", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    try {
      const first = await openBenchStorage(isolatedEnv(home));
      const tables = (first.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[])
        .map((row) => row.name);

      expect(tables).toContain("registries");
      expect(tables).toContain("benchmark_versions");
      expect(tables).toContain("runs");
      expect(tables).toContain("attempts");
      expect(tables).toContain("result_segments");
      expect(tables).toContain("metrics");
      expect(tables).toContain("artifacts");
      expect(tables).toContain("provider_usage");
      expect((first.db.prepare("SELECT COUNT(*) as count FROM benchmarks").get() as { count: number } | null)?.count).toBe(13);
      first.close();

      const second = await openBenchStorage(isolatedEnv(home));
      expect((second.db.prepare("SELECT COUNT(*) as count FROM benchmarks").get() as { count: number } | null)?.count).toBe(13);
      expect((second.db.prepare("SELECT COUNT(*) as count FROM benchmark_versions").get() as { count: number } | null)?.count).toBe(13);
      second.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("records run projections while keeping raw segment payloads in JSONL files", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider",
        route: "local-test",
        labels: { purpose: "unit-test" }
      });
      const attempt = createAttemptRecord(storage, run.id, "running");

      const first = await appendResultSegment(storage, {
        runId: run.id,
        attemptId: attempt.id,
        eventType: "raw-result",
        payload: { metric: "accuracy", value: 0.42 }
      });
      const second = await appendResultSegment(storage, {
        runId: run.id,
        attemptId: attempt.id,
        eventType: "parser-warning",
        payload: { warning: "synthetic fixture" }
      });

      recordMetric(storage, {
        runId: run.id,
        attemptId: attempt.id,
        metricId: "accuracy",
        value: 0.42,
        direction: "higher-is-better"
      });
      recordArtifact(storage, {
        runId: run.id,
        attemptId: attempt.id,
        kind: "raw-output",
        path: first.segmentPath
      });
      recordProviderUsage(storage, {
        runId: run.id,
        attemptId: attempt.id,
        provider: "example-provider",
        modelId: "example/model",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.001,
        latencyMs: 123
      });

      expect(first.byteOffset).toBe(0);
      expect(second.byteOffset).toBe(first.byteLength);
      expect(first.recordSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(sha256Hex(readFileSync(first.segmentPath, "utf8").split("\n")[0] + "\n")).toBe(first.recordSha256);

      const lines = readFileSync(first.segmentPath, "utf8").trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).payload).toEqual({ metric: "accuracy", value: 0.42 });

      const segmentRow = storage.db
        .prepare("SELECT byte_offset, byte_length, record_sha256 FROM result_segments WHERE id = ?")
        .get(first.id) as { byte_offset: number; byte_length: number; record_sha256: string } | null;
      expect(segmentRow).toEqual({
        byte_offset: first.byteOffset,
        byte_length: first.byteLength,
        record_sha256: first.recordSha256
      });
      expect((storage.db.prepare("SELECT COUNT(*) as count FROM metrics").get() as { count: number } | null)?.count).toBe(1);
      expect((storage.db.prepare("SELECT COUNT(*) as count FROM artifacts").get() as { count: number } | null)?.count).toBe(1);
      expect((storage.db.prepare("SELECT COUNT(*) as count FROM provider_usage").get() as { count: number } | null)?.count).toBe(1);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("redacts direct raw segment payloads before JSONL persistence", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    const rawCredential = "sk-" + "proj-storage-segment";
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });

      const segment = await appendResultSegment(storage, {
        runId: run.id,
        eventType: "raw-result",
        payload: { nested: { credential: rawCredential } }
      });
      const raw = readFileSync(segment.segmentPath, "utf8");
      expect(raw).toContain("[REDACTED]");
      expect(raw).not.toContain(rawCredential);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });


  it("sets a SQLite busy timeout for concurrent local writers", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const pragma = storage.db.prepare("PRAGMA busy_timeout").get() as { timeout: number } | null;
      expect(pragma?.timeout).toBe(5000);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("serializes concurrent append offsets for one run segment file", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });
      const attempt = createAttemptRecord(storage, run.id);

      const records = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          appendResultSegment(storage, {
            runId: run.id,
            attemptId: attempt.id,
            eventType: "concurrent-probe",
            payload: { index }
          })
        )
      );
      const sorted = [...records].sort((left, right) => left.byteOffset - right.byteOffset);

      expect(new Set(records.map((record) => record.byteOffset)).size).toBe(16);
      expect(sorted[0].byteOffset).toBe(0);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index].byteOffset).toBe(sorted[index - 1].byteOffset + sorted[index - 1].byteLength);
      }
      expect(readFileSync(sorted[0].segmentPath, "utf8").trimEnd().split("\n")).toHaveLength(16);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects cross-run attempt references in result projections", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const firstRun = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model-a",
        provider: "example-provider"
      });
      const secondRun = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model-b",
        provider: "example-provider"
      });
      const firstAttempt = createAttemptRecord(storage, firstRun.id);

      await expect(appendResultSegment(storage, {
        runId: secondRun.id,
        attemptId: firstAttempt.id,
        eventType: "bad",
        payload: {}
      })).rejects.toThrow(/does not belong/);

      expect(() => recordMetric(storage, {
        runId: secondRun.id,
        attemptId: firstAttempt.id,
        metricId: "accuracy",
        value: 1
      })).toThrow(/does not belong/);

      expect(() => recordProviderUsage(storage, {
        runId: secondRun.id,
        attemptId: firstAttempt.id,
        provider: "example-provider",
        modelId: "example/model-b"
      })).toThrow(/does not belong/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects artifact path traversal outside the bench store", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });

      expect(() => recordArtifact(storage, {
        runId: run.id,
        kind: "raw-output",
        path: "../../secrets.txt"
      })).toThrow(/artifacts directory/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects same-version seed registry drift", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const drifted = structuredClone(seedBenchmarks);
      drifted[0].name = "Changed without a manifestVersion bump";

      expect(() => syncBenchmarkRegistry(storage, drifted)).toThrow(/Manifest version drift/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects oversized raw result segment records", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });

      await expect(appendResultSegment(storage, {
        runId: run.id,
        eventType: "too-large",
        payload: { text: "x".repeat(DEFAULT_RESULT_SEGMENT_BYTE_LIMIT + 1) }
      })).rejects.toThrow(/above the .* byte limit/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects non-numeric provider usage values at runtime", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });

      expect(() => recordProviderUsage(storage, {
        runId: run.id,
        provider: "example-provider",
        modelId: "example/model",
        inputTokens: "bad" as unknown as number,
        costUsd: "not-cost" as unknown as number,
        latencyMs: "fast" as unknown as number
      })).toThrow(/inputTokens/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects negative provider usage values and raw credential-shaped run metadata", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-storage-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    const rawCredential = "sk-" + "proj-storage-test";
    try {
      expect(() => createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: rawCredential,
        provider: "example-provider"
      })).toThrow(/raw credential-shaped/);

      const run = createRunRecord(storage, {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });

      expect(() => recordProviderUsage(storage, {
        runId: run.id,
        provider: "example-provider",
        modelId: "example/model",
        inputTokens: -1
      })).toThrow(/inputTokens must be non-negative/);
      expect(() => recordProviderUsage(storage, {
        runId: run.id,
        provider: "example-provider",
        modelId: "example/model",
        costUsd: -0.01
      })).toThrow(/costUsd must be non-negative/);
      expect(() => recordProviderUsage(storage, {
        runId: run.id,
        provider: "example-provider",
        modelId: "example/model",
        latencyMs: -1
      })).toThrow(/latencyMs must be non-negative/);
      expect(() => recordMetric(storage, {
        runId: run.id,
        metricId: rawCredential,
        value: 1
      })).toThrow(/raw credential-shaped/);
      expect(() => recordArtifact(storage, {
        runId: run.id,
        kind: "raw-output",
        path: rawCredential
      })).toThrow(/raw credential-shaped/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
