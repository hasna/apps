import OpenAI from "openai";
import { readFileSync } from "fs";
import { getConfigValue } from "../config.js";
import { withRetry } from "../retry.js";

function getClient(): OpenAI {
  const apiKey = getConfigValue("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Run: brains config set OPENAI_API_KEY <key>");
  }
  return new OpenAI({ apiKey });
}

export async function uploadTrainingFile(filePath: string): Promise<{ fileId: string }> {
  return withRetry(async () => {
    const client = getClient();
    const fileContent = readFileSync(filePath);
    const blob = new Blob([fileContent], { type: "application/jsonl" });
    const file = new File([blob], filePath.split("/").pop() ?? "training.jsonl", { type: "application/jsonl" });
    const response = await client.files.create({ file, purpose: "fine-tune" });
    return { fileId: response.id };
  });
}

export async function createFineTuneJob(
  fileId: string,
  baseModel: string,
  suffix?: string
): Promise<{ jobId: string; status: string }> {
  return withRetry(async () => {
    const client = getClient();
    const params: OpenAI.FineTuning.JobCreateParams = { training_file: fileId, model: baseModel };
    if (suffix) params.suffix = suffix;
    const response = await client.fineTuning.jobs.create(params);
    return { jobId: response.id, status: response.status };
  });
}

export async function getFineTuneStatus(jobId: string): Promise<{
  jobId: string;
  status: string;
  fineTunedModel?: string;
  baseModel?: string;
  error?: string;
}> {
  return withRetry(async () => {
    const client = getClient();
    const response = await client.fineTuning.jobs.retrieve(jobId);
    return {
      jobId: response.id,
      status: response.status,
      fineTunedModel: response.fine_tuned_model ?? undefined,
      baseModel: response.model ?? undefined,
      error: response.error?.message ?? undefined,
    };
  });
}

export async function listFineTunedModels(): Promise<
  Array<{ id: string; model: string; status: string; created: number }>
> {
  return withRetry(async () => {
    const client = getClient();
    const jobs = await client.fineTuning.jobs.list();
    return jobs.data.map((job) => ({
      id: job.id,
      model: job.fine_tuned_model ?? job.model,
      status: job.status,
      created: job.created_at,
    }));
  });
}

export async function cancelFineTuneJob(jobId: string): Promise<void> {
  return withRetry(async () => {
    const client = getClient();
    await client.fineTuning.jobs.cancel(jobId);
  });
}

export class OpenAIProvider {
  async uploadTrainingFile(filePath: string) {
    return uploadTrainingFile(filePath);
  }

  async createFineTuneJob(fileId: string, baseModel: string, suffix?: string) {
    return createFineTuneJob(fileId, baseModel, suffix);
  }

  async getFineTuneStatus(jobId: string) {
    return getFineTuneStatus(jobId);
  }

  async listFineTunedModels() {
    return listFineTunedModels();
  }

  async cancelFineTuneJob(jobId: string) {
    return cancelFineTuneJob(jobId);
  }
}
