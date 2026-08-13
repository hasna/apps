import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock the OpenAI SDK before importing the provider
const mockJobsCreate = mock(async () => ({
  id: "ftjob-123",
  status: "queued",
  fine_tuned_model: null,
  model: "gpt-4o-mini",
  error: null,
}));
const mockJobsRetrieve = mock(async () => ({
  id: "ftjob-123",
  status: "succeeded",
  fine_tuned_model: "ft:gpt-4o-mini:acct:model:suffix",
  model: "gpt-4o-mini",
  error: null,
}));
const mockJobsList = mock(async () => ({
  data: [
    { id: "ftjob-123", fine_tuned_model: "ft:model", model: "gpt-4o-mini", status: "succeeded", created_at: 1700000000 },
  ],
}));
const mockJobsCancel = mock(async () => ({}));
const mockFilesCreate = mock(async () => ({ id: "file-abc" }));

mock.module("openai", () => ({
  default: class MockOpenAI {
    constructor() {}
    files = { create: mockFilesCreate };
    fineTuning = {
      jobs: {
        create: mockJobsCreate,
        retrieve: mockJobsRetrieve,
        list: mockJobsList,
        cancel: mockJobsCancel,
      },
    };
  },
}));

// Set a fake API key so getClient() doesn't throw
process.env.OPENAI_API_KEY = "sk-test-fake-key";

const { uploadTrainingFile, createFineTuneJob, getFineTuneStatus, listFineTunedModels, cancelFineTuneJob, OpenAIProvider } =
  await import("./openai.js");

describe("OpenAI provider functions", () => {
  test("uploadTrainingFile uploads file and returns fileId", async () => {
    // Create a temp file for the test
    const tmpPath = `/tmp/test-training-${Date.now()}.jsonl`;
    await Bun.write(tmpPath, '{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}');
    const result = await uploadTrainingFile(tmpPath);
    expect(result.fileId).toBe("file-abc");
  });

  test("createFineTuneJob returns jobId and status", async () => {
    const result = await createFineTuneJob("file-abc", "gpt-4o-mini");
    expect(result.jobId).toBe("ftjob-123");
    expect(result.status).toBe("queued");
  });

  test("createFineTuneJob with suffix", async () => {
    const result = await createFineTuneJob("file-abc", "gpt-4o-mini", "my-suffix");
    expect(result.jobId).toBe("ftjob-123");
  });

  test("getFineTuneStatus returns status and model", async () => {
    const result = await getFineTuneStatus("ftjob-123");
    expect(result.jobId).toBe("ftjob-123");
    expect(result.status).toBe("succeeded");
    expect(result.fineTunedModel).toBe("ft:gpt-4o-mini:acct:model:suffix");
    expect(result.baseModel).toBe("gpt-4o-mini");
    expect(result.error).toBeUndefined();
  });

  test("listFineTunedModels returns array", async () => {
    const models = await listFineTunedModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models[0]?.id).toBe("ftjob-123");
  });

  test("cancelFineTuneJob completes without error", async () => {
    await expect(cancelFineTuneJob("ftjob-123")).resolves.toBeUndefined();
  });
});

describe("OpenAIProvider class", () => {
  test("delegates all methods", async () => {
    const provider = new OpenAIProvider();
    expect(typeof provider.uploadTrainingFile).toBe("function");
    expect(typeof provider.createFineTuneJob).toBe("function");
    expect(typeof provider.getFineTuneStatus).toBe("function");
    expect(typeof provider.listFineTunedModels).toBe("function");
    expect(typeof provider.cancelFineTuneJob).toBe("function");
  });

  test("getFineTuneStatus via provider", async () => {
    const provider = new OpenAIProvider();
    const result = await provider.getFineTuneStatus("ftjob-123");
    expect(result.jobId).toBe("ftjob-123");
  });

  test("listFineTunedModels via provider", async () => {
    const provider = new OpenAIProvider();
    const models = await provider.listFineTunedModels();
    expect(Array.isArray(models)).toBe(true);
  });
});

describe("OpenAIProvider class — all methods", () => {
  test("uploadTrainingFile via provider", async () => {
    const tmpPath = `/tmp/test-training-provider-${Date.now()}.jsonl`;
    await Bun.write(tmpPath, '{"messages":[]}');
    const provider = new OpenAIProvider();
    const result = await provider.uploadTrainingFile(tmpPath);
    expect(result.fileId).toBe("file-abc");
  });

  test("createFineTuneJob via provider", async () => {
    const provider = new OpenAIProvider();
    const result = await provider.createFineTuneJob("file-abc", "gpt-4o-mini", "suf");
    expect(result.jobId).toBe("ftjob-123");
  });

  test("cancelFineTuneJob via provider", async () => {
    const provider = new OpenAIProvider();
    await expect(provider.cancelFineTuneJob("ftjob-123")).resolves.toBeUndefined();
  });
});

describe("OpenAI provider error handling", () => {
  test("getClient throws when OPENAI_API_KEY is not set", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(listFineTunedModels()).rejects.toThrow("OPENAI_API_KEY is not set");
    } finally {
      process.env.OPENAI_API_KEY = savedKey;
    }
  });
});
