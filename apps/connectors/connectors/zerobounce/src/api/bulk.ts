import type { ConnectorClient } from './client';
import type {
  SendFileParams,
  SendFileResult,
  FileStatusParams,
  FileStatusResult,
  GetFileParams,
  DeleteFileParams,
  BulkFileActionResult,
} from '../types';

function toUploadBlob(file: Blob | Uint8Array): Blob {
  if (file instanceof Blob) {
    return file;
  }
  return new Blob([file as unknown as BlobPart], { type: 'text/csv' });
}

export class BulkApi {
  constructor(private readonly client: ConnectorClient) {}

  async sendFile(params: SendFileParams): Promise<SendFileResult> {
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

    if (params.first_name_column !== undefined) {
      form.append('first_name_column', String(params.first_name_column));
    }
    if (params.last_name_column !== undefined) {
      form.append('last_name_column', String(params.last_name_column));
    }
    if (params.gender_column !== undefined) {
      form.append('gender_column', String(params.gender_column));
    }
    if (params.ip_address_column !== undefined) {
      form.append('ip_address_column', String(params.ip_address_column));
    }
    if (params.has_header_row !== undefined) {
      form.append('has_header_row', String(params.has_header_row));
    }
    if (params.remove_duplicate !== undefined) {
      form.append('remove_duplicate', String(params.remove_duplicate));
    }
    if (params.allow_phase_2 !== undefined) {
      form.append('allow_phase_2', String(params.allow_phase_2));
    }
    if (params.return_url) {
      form.append('return_url', params.return_url);
    }

    return this.client.postForm<SendFileResult>('/v2/sendfile', form);
  }

  async getFileStatus(params: FileStatusParams): Promise<FileStatusResult> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<FileStatusResult>('/v2/filestatus', {
      file_id: params.file_id,
    });
  }

  async getFile(params: GetFileParams): Promise<string> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<string>('/v2/getfile', {
      file_id: params.file_id,
    });
  }

  async deleteFile(params: DeleteFileParams): Promise<BulkFileActionResult> {
    if (!params.file_id) {
      throw new Error('file_id is required');
    }

    return this.client.getBulk<BulkFileActionResult>('/v2/deletefile', {
      file_id: params.file_id,
    });
  }
}
