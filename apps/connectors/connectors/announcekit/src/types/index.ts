export interface AnnounceKitConfig { token: string; }

export interface AKProject { id: string; name: string; slug: string; website: string; image_url: string; created_at: string; locale: string; widget_id: string; }
export interface AKPost { id: string; project_id: string; title: string; body: string; slug: string; visible: boolean; is_draft: boolean; image_url: string | null; created_at: string; updated_at: string; published_at: string | null; expire_at: string | null; labels: string[]; }
export interface AKLabel { id: string; name: string; color: string; project_id: string; }
export interface AKFeedback { id: string; post_id: string; reaction: string; created_at: string; }
export interface AKWidget { id: string; project_id: string; name: string; position: string; created_at: string; }

export class AnnounceKitApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AnnounceKitApiError'; this.statusCode = statusCode; }
}
