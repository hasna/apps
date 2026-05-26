import type { ConnectorClient } from './client';
import type {
  AgentResponse,
  GrabWebTextParams,
  InvokeAgentParams,
  ScreenshotParams,
  YouTubeTranscriptParams,
  DomainInfoParams,
  ImageGenerationParams,
  TextToSpeechParams,
  RestApiParams,
} from '../types';

export class ActionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async grabWebText(data: GrabWebTextParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/grab_web_text', data);
  }

  async invokeAgent(data: InvokeAgentParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/invoke_agent', data);
  }

  async screenshot(data: ScreenshotParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/screenshot', data);
  }

  async youtubeTranscript(data: YouTubeTranscriptParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/youtube_transcript', data);
  }

  async domainInfo(data: DomainInfoParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/domain_info', data);
  }

  async generateImage(data: ImageGenerationParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/generate_image', data);
  }

  async textToSpeech(data: TextToSpeechParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/text_to_speech', data);
  }

  async restApi(data: RestApiParams): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/action/rest_api', data);
  }
}
