import { TextItClient } from "./client";
import type {
  TextItConfig,
  TextItContact,
  TextItFlow,
  TextItFlowStart,
  TextItListResponse,
  TextItMessage,
} from "../types";

export { TextItClient, jsonPath } from "./client";

export class TextIt {
  private readonly client: TextItClient;

  constructor(config: TextItConfig) {
    this.client = new TextItClient(config);
  }

  static fromEnv(): TextIt {
    const apiToken = process.env.TEXTIT_API_TOKEN;
    if (!apiToken) {
      throw new Error("TEXTIT_API_TOKEN environment variable is required");
    }
    return new TextIt({
      apiToken,
      baseUrl: process.env.TEXTIT_BASE_URL,
      tokenPrefix: process.env.TEXTIT_TOKEN_PREFIX,
    });
  }

  async listContacts(options?: {
    page?: number;
    page_size?: number;
    group?: string;
    query?: string;
  }): Promise<TextItListResponse<TextItContact>> {
    return this.client.request<TextItListResponse<TextItContact>>("contacts", {
      params: {
        page: options?.page,
        page_size: options?.page_size,
        group: options?.group,
        query: options?.query,
      },
    });
  }

  async createContact(contact: Record<string, unknown>): Promise<TextItContact> {
    return this.client.request<TextItContact>("contacts", {
      method: "POST",
      body: contact,
    });
  }

  async listMessages(options?: {
    page?: number;
    page_size?: number;
    contact?: string;
    flow?: string;
    before?: string;
    after?: string;
  }): Promise<TextItListResponse<TextItMessage>> {
    return this.client.request<TextItListResponse<TextItMessage>>("messages", {
      params: {
        page: options?.page,
        page_size: options?.page_size,
        contact: options?.contact,
        flow: options?.flow,
        before: options?.before,
        after: options?.after,
      },
    });
  }

  async sendMessage(message: Record<string, unknown>): Promise<TextItMessage> {
    return this.client.request<TextItMessage>("messages", {
      method: "POST",
      body: message,
    });
  }

  async listFlows(options?: {
    page?: number;
    page_size?: number;
    archived?: boolean;
  }): Promise<TextItListResponse<TextItFlow>> {
    return this.client.request<TextItListResponse<TextItFlow>>("flows", {
      params: {
        page: options?.page,
        page_size: options?.page_size,
        archived: options?.archived,
      },
    });
  }

  async startFlow(flowStart: Record<string, unknown>): Promise<TextItFlowStart> {
    return this.client.request<TextItFlowStart>("flow_starts", {
      method: "POST",
      body: flowStart,
    });
  }

  async rawRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    return this.client.rawRequest<T>(path, options);
  }

  getClient(): TextItClient {
    return this.client;
  }
}
