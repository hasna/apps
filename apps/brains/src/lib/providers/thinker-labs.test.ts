import { describe, expect, test, mock, spyOn } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync } from "fs";

// Set fake config before importing
process.env.THINKER_LABS_API_KEY = "tl-test-fake-key";
process.env.THINKER_LABS_BASE_URL = "https://mock.thinkerlabs.test/v1";

const {
  uploadTrainingData,
  startFineTune,
  getStatus,
  listModels,
  cancelJob,
  ThinkerLabsProvider,
} = await import("./thinker-labs.js");

function mockFetch(responseData: unknown, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(status === 204 ? null : JSON.stringify(responseData), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  return () => { globalThis.fetch = original; };
}

describe("Thinker Labs provider functions", () => {
  test("uploadTrainingData uploads and returns datasetId", async () => {
    const restore = mockFetch({ id: "ds-abc" });
    const tmpFile = join(tmpdir(), `tl-test-${Date.now()}.jsonl`);
    writeFileSync(tmpFile, '{"messages":[]}');
    try {
      const result = await uploadTrainingData(tmpFile);
      expect(result.datasetId).toBe("ds-abc");
    } finally {
      restore();
    }
  });

  test("startFineTune returns jobId and status", async () => {
    const restore = mockFetch({ id: "ft-job-1", status: "queued" });
    try {
      const result = await startFineTune("ds-abc", "llama-3", "my-model");
      expect(result.jobId).toBe("ft-job-1");
      expect(result.status).toBe("queued");
    } finally {
      restore();
    }
  });

  test("startFineTune without name", async () => {
    const restore = mockFetch({ id: "ft-job-2", status: "queued" });
    try {
      const result = await startFineTune("ds-abc", "llama-3");
      expect(result.jobId).toBe("ft-job-2");
    } finally {
      restore();
    }
  });

  test("getStatus returns job details", async () => {
    const restore = mockFetch({ id: "ft-job-1", status: "succeeded", model_id: "ft-model-1", error: undefined });
    try {
      const result = await getStatus("ft-job-1");
      expect(result.jobId).toBe("ft-job-1");
      expect(result.status).toBe("succeeded");
      expect(result.modelId).toBe("ft-model-1");
    } finally {
      restore();
    }
  });

  test("listModels returns array", async () => {
    const restore = mockFetch({
      data: [{ id: "ft-1", name: "my-model", status: "succeeded", base_model: "llama-3", created_at: 1700000000 }],
    });
    try {
      const models = await listModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models[0]?.id).toBe("ft-1");
      expect(models[0]?.baseModel).toBe("llama-3");
    } finally {
      restore();
    }
  });

  test("listModels handles empty data", async () => {
    const restore = mockFetch({ data: [] });
    try {
      const models = await listModels();
      expect(models).toEqual([]);
    } finally {
      restore();
    }
  });

  test("cancelJob completes without error (204)", async () => {
    const restore = mockFetch(null, 204);
    try {
      await expect(cancelJob("ft-job-1")).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });

  test("throws Thinker Labs API error on non-ok response", async () => {
    const restore = mockFetch("Unauthorized", 401);
    try {
      await expect(getStatus("ft-job-1")).rejects.toThrow("Thinker Labs API error 401");
    } finally {
      restore();
    }
  });
});

describe("ThinkerLabsProvider class aliases", () => {
  test("uploadTrainingFile delegates to uploadTrainingData", async () => {
    const restore = mockFetch({ id: "ds-xyz" });
    const tmpFile = join(tmpdir(), `tl-test2-${Date.now()}.jsonl`);
    writeFileSync(tmpFile, '{"messages":[]}');
    try {
      const provider = new ThinkerLabsProvider();
      const result = await provider.uploadTrainingFile(tmpFile);
      expect(result.fileId).toBe("ds-xyz");
    } finally {
      restore();
    }
  });

  test("createFineTuneJob delegates to startFineTune", async () => {
    const restore = mockFetch({ id: "ft-3", status: "queued" });
    try {
      const provider = new ThinkerLabsProvider();
      const result = await provider.createFineTuneJob("ds-xyz", "llama-3", "suf");
      expect(result.jobId).toBe("ft-3");
    } finally {
      restore();
    }
  });

  test("getFineTuneStatus delegates to getStatus", async () => {
    const restore = mockFetch({ id: "ft-3", status: "running", model_id: undefined, error: undefined });
    try {
      const provider = new ThinkerLabsProvider();
      const result = await provider.getFineTuneStatus("ft-3");
      expect(result.jobId).toBe("ft-3");
      expect(result.status).toBe("running");
    } finally {
      restore();
    }
  });

  test("listFineTunedModels maps to unified format", async () => {
    const restore = mockFetch({ data: [{ id: "ft-4", name: "m", status: "succeeded", base_model: "llama-3", created_at: 100 }] });
    try {
      const provider = new ThinkerLabsProvider();
      const models = await provider.listFineTunedModels();
      expect(models[0]?.model).toBe("llama-3");
      expect(models[0]?.created).toBe(100);
    } finally {
      restore();
    }
  });

  test("cancelFineTuneJob delegates to cancelJob", async () => {
    const restore = mockFetch(null, 204);
    try {
      const provider = new ThinkerLabsProvider();
      await expect(provider.cancelFineTuneJob("ft-4")).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});
