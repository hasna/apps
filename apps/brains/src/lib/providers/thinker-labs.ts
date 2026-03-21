// Thinker Labs fine-tuning API adapter
// API key from env: THINKER_LABS_API_KEY
// Base URL from env: THINKER_LABS_BASE_URL (default: https://api.thinkerlabs.ai/v1)
// Note: Adapter based on standard fine-tuning REST conventions. Update endpoints when official docs are available.

import { getConfigValue } from "../config.js";
import { withRetry } from "../retry.js";

const DEFAULT_BASE_URL = "https://api.thinkerlabs.ai/v1";

function getConfig() {
  const apiKey = getConfigValue("THINKER_LABS_API_KEY");
  const baseUrl = getConfigValue("THINKER_LABS_BASE_URL") ?? DEFAULT_BASE_URL;
  if (!apiKey) throw new Error("THINKER_LABS_API_KEY is not set. Run: brains config set THINKER_LABS_API_KEY <key>");
  return { apiKey, baseUrl };
}

async function request<T>(method: string, path: string, body?: unknown, file?: { name: string; data: string }): Promise<T> {
  return withRetry(async () => {
    const { apiKey, baseUrl } = getConfig();
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };

    let fetchBody: BodyInit | undefined;
    if (file) {
      const form = new FormData();
      form.append("file", new Blob([file.data], { type: "text/plain" }), file.name);
      if (body) {
        for (const [k, v] of Object.entries(body as Record<string, string>)) {
          form.append(k, v);
        }
      }
      fetchBody = form;
    } else if (body) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: fetchBody });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Thinker Labs API error ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  });
}

export async function uploadTrainingData(filePath: string): Promise<{ datasetId: string }> {
  const fileContent = await Bun.file(filePath).text();
  const fileName = filePath.split("/").pop() ?? "training.jsonl";
  const result = await request<{ id: string }>("POST", "/datasets/upload", undefined, { name: fileName, data: fileContent });
  return { datasetId: result.id };
}

export async function startFineTune(
  datasetId: string,
  baseModel: string,
  name?: string
): Promise<{ jobId: string; status: string }> {
  const result = await request<{ id: string; status: string }>("POST", "/fine-tunes", {
    dataset_id: datasetId,
    base_model: baseModel,
    ...(name ? { name } : {}),
  });
  return { jobId: result.id, status: result.status };
}

export async function getStatus(jobId: string): Promise<{
  jobId: string;
  status: string;
  modelId?: string;
  error?: string;
}> {
  const result = await request<{ id: string; status: string; model_id?: string; error?: string }>(
    "GET",
    `/fine-tunes/${jobId}`
  );
  return {
    jobId: result.id,
    status: result.status,
    modelId: result.model_id,
    error: result.error,
  };
}

export async function listModels(): Promise<
  Array<{ id: string; name: string; status: string; baseModel: string; createdAt: number }>
> {
  const result = await request<{
    data: Array<{ id: string; name: string; status: string; base_model: string; created_at: number }>;
  }>("GET", "/fine-tunes");
  return (result.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    baseModel: m.base_model,
    createdAt: m.created_at,
  }));
}

export async function cancelJob(jobId: string): Promise<void> {
  await request<void>("DELETE", `/fine-tunes/${jobId}`);
}

export class ThinkerLabsProvider {
  uploadTrainingData = uploadTrainingData;
  startFineTune = startFineTune;
  getStatus = getStatus;
  listModels = listModels;
  cancelJob = cancelJob;

  // Aliases matching OpenAIProvider interface for polymorphic use
  async uploadTrainingFile(filePath: string): Promise<{ fileId: string }> {
    const { datasetId } = await uploadTrainingData(filePath);
    return { fileId: datasetId };
  }
  async createFineTuneJob(fileId: string, baseModel: string, suffix?: string): Promise<{ jobId: string; status: string }> {
    return startFineTune(fileId, baseModel, suffix);
  }
  async getFineTuneStatus(jobId: string): Promise<{ jobId: string; status: string; fineTunedModel?: string; baseModel?: string; error?: string }> {
    const result = await getStatus(jobId);
    return { jobId: result.jobId, status: result.status, fineTunedModel: result.modelId, error: result.error };
  }
  async listFineTunedModels(): Promise<Array<{ id: string; model: string; status: string; created: number }>> {
    const models = await listModels();
    return models.map((m) => ({ id: m.id, model: m.baseModel, status: m.status, created: m.createdAt }));
  }
  async cancelFineTuneJob(jobId: string): Promise<void> {
    return cancelJob(jobId);
  }
}
