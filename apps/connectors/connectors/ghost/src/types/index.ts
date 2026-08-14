export interface GhostConfig { url: string; adminApiKey?: string; contentApiKey?: string; }

export interface GhostPost { id: string; uuid: string; title: string; slug: string; html: string; plaintext: string; feature_image: string | null; featured: boolean; status: 'published' | 'draft' | 'scheduled'; visibility: string; created_at: string; updated_at: string; published_at: string | null; authors: GhostAuthor[]; tags: GhostTag[]; excerpt: string; url: string; }
export interface GhostPostList { posts: GhostPost[]; meta: { pagination: { page: number; limit: number; pages: number; total: number; next: number | null; prev: number | null } }; }
export interface GhostPage { id: string; title: string; slug: string; html: string; status: string; created_at: string; updated_at: string; published_at: string | null; url: string; }
export interface GhostTag { id: string; name: string; slug: string; description: string | null; feature_image: string | null; visibility: string; count?: { posts: number }; }
export interface GhostAuthor { id: string; name: string; slug: string; email: string; profile_image: string | null; bio: string | null; website: string | null; }
export interface GhostMember { id: string; email: string; name: string; status: string; subscribed: boolean; created_at: string; }

export class GhostApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GhostApiError'; this.statusCode = statusCode; }
}
