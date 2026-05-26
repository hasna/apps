import type { QuoClient } from './client';
import type { Call, CallListResponse, CallRecording, CallSummary, CallTranscription, Voicemail } from '../types';

export interface ListCallsOptions {
  phoneNumberId?: string;
  userId?: string;
  maxResults?: number;
  pageToken?: string;
}

/**
 * Calls API module
 * List calls and get call details, recordings, summaries, and transcriptions
 */
export class CallsApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List calls with optional filters
   */
  async list(options?: ListCallsOptions): Promise<CallListResponse> {
    return this.client.get<CallListResponse>('/calls', {
      phoneNumberId: options?.phoneNumberId,
      userId: options?.userId,
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
    });
  }

  /**
   * Get a call by ID
   */
  async get(callId: string): Promise<{ data: Call }> {
    return this.client.get<{ data: Call }>(`/calls/${callId}`);
  }

  /**
   * Get recordings for a call
   */
  async getRecordings(callId: string): Promise<{ data: CallRecording[] }> {
    return this.client.get<{ data: CallRecording[] }>(`/calls/${callId}/recordings`);
  }

  /**
   * Get summary for a call
   */
  async getSummary(callId: string): Promise<{ data: CallSummary }> {
    return this.client.get<{ data: CallSummary }>(`/calls/${callId}/summary`);
  }

  /**
   * Get transcription for a call
   */
  async getTranscription(callId: string): Promise<{ data: CallTranscription }> {
    return this.client.get<{ data: CallTranscription }>(`/calls/${callId}/transcription`);
  }

  /**
   * Get voicemail for a call
   */
  async getVoicemail(callId: string): Promise<{ data: Voicemail }> {
    return this.client.get<{ data: Voicemail }>(`/calls/${callId}/voicemail`);
  }
}
