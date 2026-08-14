import { createHash } from 'node:crypto';
import type {
  CreateAttachmentInput,
  CreateItemsResponse,
  UploadAuthResponse,
  UploadFileInput,
} from '../types';
import { ZoteroApiError } from '../types';
import { encodePathSegment, ZoteroClient } from './client';
import { ItemsApi } from './items';

export class AttachmentsApi {
  private readonly items: ItemsApi;

  constructor(private readonly client: ZoteroClient) {
    this.items = new ItemsApi(client);
  }

  async create(input: CreateAttachmentInput): Promise<CreateItemsResponse> {
    const attachment = {
      itemType: 'attachment',
      linkMode: input.linkMode ?? 'imported_url',
      parentItem: input.parentItem,
      title: input.title ?? input.filename ?? input.url,
      url: input.url,
      accessDate: input.accessDate,
      contentType: input.contentType,
      filename: input.filename,
      tags: input.tags ?? [],
      collections: input.collections,
      relations: input.relations ?? {},
    };

    return this.items.create(attachment);
  }

  async uploadFile(input: UploadFileInput): Promise<{
    attachmentKey: string;
    filename: string;
    uploaded?: boolean;
    exists?: boolean;
    md5?: string;
  }> {
    const filename = input.filename;
    const contentType = input.contentType ?? 'application/octet-stream';
    const file = Buffer.from(input.content);
    const mtime = String(input.mtime ?? Date.now());
    const md5 = createHash('md5').update(file).digest('hex');

    let attachmentKey = input.attachmentKey ?? '';

    if (!attachmentKey) {
      if (!input.parentItem) {
        throw new ZoteroApiError('parentItem is required when attachmentKey is not provided', 'missing_parent');
      }

      const created = await this.create({
        parentItem: input.parentItem,
        linkMode: 'imported_file',
        contentType,
        filename,
        title: filename,
      });

      attachmentKey = created.success?.['0'] ?? created.successful?.['0'] ?? '';
      if (!attachmentKey) {
        throw new ZoteroApiError('Attachment item was not created', 'create_failed');
      }
    }

    const prefix = this.client.libraryPrefix();
    const filePath = `${prefix}/items/${encodePathSegment(attachmentKey)}/file`;

    const uploadAuthText = await this.client.requestText(filePath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'If-None-Match': '*',
      },
      body: new URLSearchParams({
        md5,
        filename,
        filesize: String(file.byteLength),
        mtime,
      }),
    });

    const uploadAuth = JSON.parse(uploadAuthText || '{}') as UploadAuthResponse;

    if (uploadAuth.exists) {
      return { attachmentKey, filename, exists: true };
    }

    if (!uploadAuth.url || !uploadAuth.contentType || !uploadAuth.uploadKey) {
      throw new ZoteroApiError('File upload authorization response was incomplete', 'upload_auth_incomplete');
    }

    const uploadBody = Buffer.concat([
      Buffer.from(uploadAuth.prefix ?? ''),
      file,
      Buffer.from(uploadAuth.suffix ?? ''),
    ]);

    const uploadResponse = await fetch(uploadAuth.url, {
      method: 'POST',
      headers: { 'Content-Type': uploadAuth.contentType },
      body: uploadBody,
    });

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      throw new ZoteroApiError(
        `File upload failed (${uploadResponse.status}): ${text.slice(0, 500)}`,
        'upload_failed',
        uploadResponse.status
      );
    }

    await this.client.requestText(filePath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'If-None-Match': '*',
      },
      body: new URLSearchParams({ upload: uploadAuth.uploadKey }),
    });

    return { attachmentKey, filename, uploaded: true, md5 };
  }
}
