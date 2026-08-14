declare module "@hasna/attachments" {
  export interface AttachmentConfig {
    s3: {
      bucket?: string;
      region?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    };
  }

  export interface UploadedAttachment {
    id: string;
    link?: string;
    expiresAt?: string | number | Date | null;
  }

  export function getConfig(): AttachmentConfig;
  export function uploadFile(path: string, options?: Record<string, unknown>): Promise<UploadedAttachment>;
  export function downloadAttachment(attachmentId: string, outputPath: string): Promise<void>;
}
