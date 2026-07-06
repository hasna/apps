import type { ConnectorClient } from './client';
import type {
  SendScoringFileParams,
  ScoringFileStatusParams,
  FileStatusResult,
  GetFileParams,
  DeleteFileParams,
  BulkFileActionResult,
  SendFileResult,
  AiScoringScoreParams,
  AiScoringScoreResult,
} from '../types';

function toUploadBlob(file: Blob | Uint8Array): Blob {
  if (file instanceof Blob) {
    return file;
  }
  return new Blob([file as unknown as BlobPart], { type: 'text/csv' });
}

export class ScoringApi {
  constructor(private readonly client: ConnectorClient) {}

  async sendScoringFile(params: SendScoringFileParams): Promise<SendFileResult> {
    if (!params.file) {
      throw new Error('file is required');
    }
    if (!params.email_address_column) {
      throw new Error('email_address_column is required');
    }

    const form = new FormData();
    const blob = toUploadBlob(params.file);
    form.append('file', blob, params.fileName);
    form.append('email_address_column', String(params.email_address_column));

    if (params.return_url) {
      form.append('return_url', params.return_url);
    }

    return this.client.postForm<SendFileResult>('/v2/scoring/sendfile', form);
  }

  async getScoringFileStatus(params: ScoringFileStatusParams): Promise<FileStatusResult> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<FileStatusResult>('/v2/scoring/filestatus', {
      file_id: params.file_id,
    });
  }

  async getScoringFile(params: GetFileParams): Promise<string> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<string>('/v2/scoring/getfile', {
      file_id: params.file_id,
    });
  }

  async deleteScoringFile(params: DeleteFileParams): Promise<BulkFileActionResult> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<BulkFileActionResult>('/v2/scoring/deletefile', {
      file_id: params.file_id,
    });
  }

  async aiScoringScore(params: AiScoringScoreParams): Promise<AiScoringScoreResult> {
    if (!params.email) {
      throw new Error('email is required');
    }

    return this.client.get<AiScoringScoreResult>('/v2/scoring/score', {
      email: params.email,
      ip_address: params.ip_address,
    });
  }
}
