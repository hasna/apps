import type {
  VectorShiftConfig,
  ListPipelinesOptions,
  RunPipelineRequest,
  RunPipelineResponse,
  ListResponse,
  ListChatbotsOptions,
  RunChatbotRequest,
  RunChatbotResponse,
  RunChatbotStreamEvent,
  CreateChatbotRequest,
  CreateChatbotResponse,
} from '../types';
import { VectorShiftApiError } from '../types';
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
    if (request.stream) {
      return this.collectChatbotStream(chatbotId, request);
    }

    const { stream: _stream, ...body } = request;
    return this.client.post<RunChatbotResponse>(`/chatbot/${encodeURIComponent(chatbotId)}/run`, body);
  }

  async *runChatbotStream(chatbotId: string, request: RunChatbotRequest): AsyncGenerator<RunChatbotStreamEvent> {
    const body = {
      ...request,
      stream: true,
    };

    for await (const event of this.client.requestStream(`/chatbot/${encodeURIComponent(chatbotId)}/run`, { body })) {
      const parsed = parseStreamData(event.data);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        throw new VectorShiftApiError(extractErrorMessage(parsed), 500);
      }

      yield toChatbotStreamEvent(event.event, parsed);
    }

    yield { type: 'done' };
  }

  private async collectChatbotStream(chatbotId: string, request: RunChatbotRequest): Promise<RunChatbotResponse> {
    let output = '';
    let conversationId = '';
    let followUpQuestions: string[] | undefined;
    let status: RunChatbotResponse['status'] = 'success';

    for await (const event of this.runChatbotStream(chatbotId, request)) {
      if (event.type === 'done') continue;
      if (event.delta) output += event.delta;
      if (event.output_message && !event.delta) output = event.output_message;
      if (event.conversation_id) conversationId = event.conversation_id;
      if (event.follow_up_questions) followUpQuestions = event.follow_up_questions;
      if (event.status) status = event.status;
    }

    return {
      status,
      conversation_id: conversationId,
      output_message: output,
      follow_up_questions: followUpQuestions,
    };
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

function parseStreamData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function extractErrorMessage(data: object): string {
  const error = (data as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(data);
}

function toChatbotStreamEvent(eventName: string | undefined, data: unknown): RunChatbotStreamEvent {
  if (typeof data !== 'object' || data === null) {
    return {
      type: 'message',
      event: eventName,
      data,
      delta: typeof data === 'string' ? data : undefined,
    };
  }

  const record = data as Record<string, unknown>;
  const delta = firstString(record.delta, record.chunk, record.content, record.text, record.message);

  return {
    type: 'message',
    event: eventName,
    data,
    delta,
    status: record.status === 'failed' ? 'failed' : record.status === 'success' ? 'success' : undefined,
    conversation_id: typeof record.conversation_id === 'string' ? record.conversation_id : undefined,
    output_message: typeof record.output_message === 'string' ? record.output_message : undefined,
    follow_up_questions: Array.isArray(record.follow_up_questions)
      ? record.follow_up_questions.filter((question): question is string => typeof question === 'string')
      : undefined,
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}
