import type {
  V0Config,
  User,
  UserScopesResponse,
  Project,
  ListProjectsParams,
  CreateProjectRequest,
  UpdateProjectRequest,
  PaginatedResponse,
  Chat,
  ListChatsParams,
  CreateChatRequest,
  InitChatRequest,
  ChatMessage,
  ListChatMessagesParams,
  SendChatMessageRequest,
  Deployment,
  CreateDeploymentRequest,
  ListDeploymentsParams,
  ChatCompletionRequest,
  ChatCompletionResponse,
  RawRequestOptions,
} from '../types';
import { V0Client } from './client';

export class V0 {
  private readonly client: V0Client;

  constructor(config: V0Config) {
    this.client = new V0Client(config);
  }

  static fromEnv(): V0 {
    const apiKey = process.env.V0_API_KEY;
    if (!apiKey) {
      throw new Error('V0_API_KEY environment variable is required');
    }
    return new V0({
      apiKey,
      baseUrl: process.env.V0_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): V0Client {
    return this.client;
  }

  async getUser(): Promise<User> {
    return this.client.get<User>('/user');
  }

  async getUserScopes(): Promise<UserScopesResponse> {
    return this.client.get<UserScopesResponse>('/user/scopes');
  }

  async listProjects(params?: ListProjectsParams): Promise<PaginatedResponse<Project>> {
    return this.client.get<PaginatedResponse<Project>>('/projects', params);
  }

  async createProject(request: CreateProjectRequest): Promise<Project> {
    return this.client.post<Project>('/projects', request);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/projects/${encodeURIComponent(projectId)}`);
  }

  async updateProject(projectId: string, request: UpdateProjectRequest): Promise<Project> {
    return this.client.put<Project>(`/projects/${encodeURIComponent(projectId)}`, request);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${encodeURIComponent(projectId)}`);
  }

  async listChats(params?: ListChatsParams): Promise<PaginatedResponse<Chat>> {
    return this.client.get<PaginatedResponse<Chat>>('/chats', params);
  }

  async createChat(request: CreateChatRequest): Promise<Chat> {
    return this.client.post<Chat>('/chats', request);
  }

  async initChat(request: InitChatRequest): Promise<Chat> {
    return this.client.post<Chat>('/chats', request);
  }

  async getChat(chatId: string): Promise<Chat> {
    return this.client.get<Chat>(`/chats/${encodeURIComponent(chatId)}`);
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.client.delete(`/chats/${encodeURIComponent(chatId)}`);
  }

  async listChatMessages(chatId: string, params?: ListChatMessagesParams): Promise<PaginatedResponse<ChatMessage>> {
    return this.client.get<PaginatedResponse<ChatMessage>>(
      `/chats/${encodeURIComponent(chatId)}/messages`,
      params,
    );
  }

  async getChatMessage(chatId: string, messageId: string): Promise<ChatMessage> {
    return this.client.get<ChatMessage>(
      `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    );
  }

  async sendChatMessage(chatId: string, request: SendChatMessageRequest): Promise<ChatMessage> {
    return this.client.post<ChatMessage>(
      `/chats/${encodeURIComponent(chatId)}/messages`,
      request,
    );
  }

  async createDeployment(request: CreateDeploymentRequest): Promise<Deployment> {
    return this.client.post<Deployment>('/deployments', request);
  }

  async listDeployments(params?: ListDeploymentsParams): Promise<PaginatedResponse<Deployment>> {
    return this.client.get<PaginatedResponse<Deployment>>('/deployments', params);
  }

  async getDeployment(deploymentId: string): Promise<Deployment> {
    return this.client.get<Deployment>(`/deployments/${encodeURIComponent(deploymentId)}`);
  }

  async chatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.client.post<ChatCompletionResponse>('/chat/completions', request);
  }

  async streamChatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.client.post<ChatCompletionResponse>('/chat/completions', { ...request, stream: true });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { V0Client, DEFAULT_BASE_URL } from './client';
