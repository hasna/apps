import { UpdownIoClient, encodePathToken } from "./client";
import type {
  UpdownCheck,
  UpdownDowntime,
  UpdownIoConfig,
  UpdownMetrics,
  UpdownNodeMap,
} from "../types";

export { UpdownIoClient, encodePathToken } from "./client";

export class UpdownIo {
  private readonly client: UpdownIoClient;

  constructor(config: UpdownIoConfig) {
    this.client = new UpdownIoClient(config);
  }

  static fromEnv(): UpdownIo {
    const apiKey = process.env.UPDOWN_IO_API_KEY;
    if (!apiKey) throw new Error("UPDOWN_IO_API_KEY is required");
    return new UpdownIo({ apiKey });
  }

  async listChecks(): Promise<UpdownCheck[]> {
    return this.client.request<UpdownCheck[]>("/checks");
  }

  async getCheck(
    token: string,
    options?: { metrics?: boolean; results?: boolean },
  ): Promise<UpdownCheck> {
    if (!token) throw new Error("check token is required");
    const encoded = encodePathToken(token);
    return this.client.request<UpdownCheck>(`/checks/${encoded}`, {
      params: {
        metrics: options?.metrics,
        results: options?.results,
      },
    });
  }

  async listDowntimes(
    token: string,
    options?: { page?: number; results?: boolean },
  ): Promise<UpdownDowntime[]> {
    if (!token) throw new Error("check token is required");
    const encoded = encodePathToken(token);
    return this.client.request<UpdownDowntime[]>(`/checks/${encoded}/downtimes`, {
      params: {
        page: options?.page,
        results: options?.results,
      },
    });
  }

  async listMetrics(
    token: string,
    options?: { from?: string; to?: string; group?: string },
  ): Promise<UpdownMetrics> {
    if (!token) throw new Error("check token is required");
    const encoded = encodePathToken(token);
    return this.client.request<UpdownMetrics>(`/checks/${encoded}/metrics`, {
      params: {
        from: options?.from,
        to: options?.to,
        group: options?.group,
      },
    });
  }

  async listNodes(): Promise<UpdownNodeMap> {
    return this.client.request<UpdownNodeMap>("/nodes", { requireAuth: false });
  }

  async listNodeIps(format: "json" | "txt" = "json"): Promise<string[] | string> {
    const suffix = format === "txt" ? ".txt" : "";
    return this.client.request<string[] | string>(`/nodes/ips${suffix}`, {
      requireAuth: false,
      textResponse: format === "txt",
    });
  }

  getClient(): UpdownIoClient {
    return this.client;
  }
}
