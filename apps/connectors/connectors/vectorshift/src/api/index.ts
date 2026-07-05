import type {
  VectorShiftConfig,
  ListPipelinesOptions,
  RunPipelineRequest,
  RunPipelineResponse,
  ListResponse,
  ListChatbotsOptions,
  RunChatbotRequest,
  RunChatbotResponse,
  CreateChatbotRequest,
  CreateChatbotResponse,
} from '../types';
import { VectorShiftClient } from './client';

export class VectorShift {
  private readonly client: VectorShiftClient;

  constructor(config: VectorShiftConfig) {
    this.client = new VectorShiftClient(config);
  }

  static fromEnv(): VectorShift {
    const apiKey = process.env.VECTORSHIFT_API_KEY;
    if (!apiKey) {
      throw new Error('VECTORSHIFT_API_KEY environment variable is required');
    }
    return new VectorShift({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listPipelines(options: ListPipelinesOptions = {}): Promise<ListResponse> {
    return this.client.get<ListResponse>('/pipelines', {
      include_shared: options.includeShared,
      verbose: options.verbose,
    });
  }

  async runPipeline(pipelineId: string, request: RunPipelineRequest = {}): Promise<RunPipelineResponse> {
    return this.client.post<RunPipelineResponse>(`/pipeline/${encodeURIComponent(pipelineId)}/run`, {
      inputs: request.inputs ?? {},
    });
  }

  async listChatbots(options: ListChatbotsOptions = {}): Promise<ListResponse> {
    return this.client.get<ListResponse>('/chatbots', {
      include_shared: options.includeShared,
      verbose: options.verbose,
    });
  }

  async runChatbot(chatbotId: string, request: RunChatbotRequest): Promise<RunChatbotResponse> {
    return this.client.post<RunChatbotResponse>(`/chatbot/${encodeURIComponent(chatbotId)}/run`, request);
  }

  async createChatbot(request: CreateChatbotRequest): Promise<CreateChatbotResponse> {
    return this.client.post<CreateChatbotResponse>('/chatbot', {
      pipeline: request.pipeline,
      name: request.name,
      description: request.description,
      deployment_options: request.deployment_options ?? {},
      access_config: request.access_config ?? {},
      twilio_config: request.twilio_config ?? {},
      slack_config: request.slack_config ?? {},
      deployed: request.deployed ?? true,
      input: request.input,
      output: request.output,
    });
  }

  getClient(): VectorShiftClient {
    return this.client;
  }
}

export { VectorShiftClient } from './client';
