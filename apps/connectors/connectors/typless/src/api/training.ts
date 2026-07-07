import type { ConnectorClient } from './client';
import type {
  AddDocumentFeedbackRequest,
  AddDocumentRequest,
  StartTrainingRequest,
} from '../types';

export class TrainingApi {
  constructor(private readonly client: ConnectorClient) {}

  /** Add a labeled document to the training dataset (POST /api/v1/add-document). */
  async addDocument(payload: AddDocumentRequest): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/api/v1/add-document', payload);
  }

  /** Add document feedback for continuous learning (POST /api/v1/add-document-feedback). */
  async addDocumentFeedback(payload: AddDocumentFeedbackRequest): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/api/v1/add-document-feedback', payload);
  }

  /** Start training for a document type (POST /api/v1/start-training). */
  async startTraining(payload: StartTrainingRequest): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/api/v1/start-training', payload);
  }
}
