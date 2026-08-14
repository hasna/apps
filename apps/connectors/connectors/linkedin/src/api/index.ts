import type {
  LinkedInConfig,
  Profile,
  EmailAddress,
  Organization,
  OrganizationAcls,
  Post,
  CreatePostParams,
  UgcPost,
  CreateUgcPostParams,
  RegisterUploadResponse,
  ShareStatistics,
  OrganizationFollowerStatistics,
  OrganizationPageStatistics,
  ConnectionStats,
  Comment,
  CommentListResponse,
  CreateCommentParams,
  Reaction,
  ReactionListResponse,
  CreateReactionParams,
  Visibility,
  ShareMediaCategory,
} from '../types';
import { LinkedInClient } from './client';

export class LinkedIn {
  private readonly client: LinkedInClient;

  constructor(config: LinkedInConfig) {
    this.client = new LinkedInClient(config);
  }

  static fromEnv(): LinkedIn {
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('LINKEDIN_ACCESS_TOKEN environment variable is required');
    }
    return new LinkedIn({ accessToken });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): LinkedInClient {
    return this.client;
  }

  // ============================================
  // Profile Methods
  // ============================================

  async getProfile(projection?: string): Promise<Profile> {
    const params: Record<string, string> = {};
    if (projection) {
      params.projection = projection;
    }
    return this.client.get<Profile>('/me', params);
  }

  async getProfileById(id: string): Promise<Profile> {
    return this.client.get<Profile>(`/people/(id:${id})`);
  }

  async getEmail(): Promise<EmailAddress> {
    return this.client.get<EmailAddress>('/emailAddress', {
      q: 'members',
      projection: '(elements*(handle~))',
    });
  }

  async getProfilePicture(): Promise<Profile> {
    return this.client.get<Profile>('/me', {
      projection: '(id,profilePicture(displayImage~:playableStreams))',
    });
  }

  // ============================================
  // Organization Methods
  // ============================================

  async getOrganization(id: string): Promise<Organization> {
    return this.client.get<Organization>(`/organizations/${id}`);
  }

  async getOrganizationByVanityName(vanityName: string): Promise<{ elements: Organization[] }> {
    return this.client.get<{ elements: Organization[] }>('/organizations', {
      q: 'vanityName',
      vanityName,
    });
  }

  async getOrganizationAcls(params?: { q?: string; role?: string; state?: string; start?: number; count?: number }): Promise<OrganizationAcls> {
    return this.client.get<OrganizationAcls>('/organizationAcls', {
      q: params?.q || 'roleAssignee',
      ...params,
    });
  }

  async getAdministeredOrganizations(): Promise<OrganizationAcls> {
    return this.getOrganizationAcls({ role: 'ADMINISTRATOR', state: 'APPROVED' });
  }

  // ============================================
  // Post/Share Methods (UGC API)
  // ============================================

  async createPost(params: CreatePostParams): Promise<{ id: string }> {
    const body: UgcPost = {
      author: params.author,
      lifecycleState: params.lifecycleState || 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: params.commentary,
          },
          shareMediaCategory: params.shareMediaCategory || 'NONE',
          media: params.media?.map(m => ({
            status: m.status,
            media: m.media,
            originalUrl: m.originalUrl,
            title: m.title ? { text: m.title } : undefined,
            description: m.description ? { text: m.description } : undefined,
          })),
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': params.visibility,
      },
    };
    return this.client.post<{ id: string }>('/ugcPosts', body);
  }

  async getPost(id: string): Promise<Post> {
    return this.client.get<Post>(`/ugcPosts/${id}`);
  }

  async deletePost(id: string): Promise<void> {
    return this.client.delete<void>(`/ugcPosts/${id}`);
  }

  async listPosts(authorId: string, params?: { start?: number; count?: number }): Promise<{ elements: Post[] }> {
    return this.client.get<{ elements: Post[] }>('/ugcPosts', {
      q: 'authors',
      authors: `List(${authorId})`,
      ...params,
    });
  }

  // ============================================
  // Media Upload Methods
  // ============================================

  async registerImageUpload(owner: string): Promise<RegisterUploadResponse> {
    return this.client.post<RegisterUploadResponse>('/assets', {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    }, { action: 'registerUpload' });
  }

  async registerVideoUpload(owner: string): Promise<RegisterUploadResponse> {
    return this.client.post<RegisterUploadResponse>('/assets', {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
        owner,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    }, { action: 'registerUpload' });
  }

  async uploadMedia(uploadUrl: string, fileBuffer: Buffer, contentType: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: fileBuffer,
    });

    if (!response.ok) {
      throw new Error(`Media upload failed: ${response.status} ${response.statusText}`);
    }
  }

  // ============================================
  // Analytics Methods
  // ============================================

  async getShareStatistics(shareId: string): Promise<ShareStatistics> {
    return this.client.get<ShareStatistics>('/socialActions', {
      q: 'statistics',
      share: shareId,
    });
  }

  async getOrganizationFollowerStatistics(organizationId: string, params?: { timeIntervals?: string }): Promise<OrganizationFollowerStatistics> {
    return this.client.get<OrganizationFollowerStatistics>('/organizationalEntityFollowerStatistics', {
      q: 'organizationalEntity',
      organizationalEntity: `urn:li:organization:${organizationId}`,
      ...params,
    });
  }

  async getOrganizationPageStatistics(organizationId: string, params?: { timeIntervals?: string }): Promise<OrganizationPageStatistics> {
    return this.client.get<OrganizationPageStatistics>('/organizationPageStatistics', {
      q: 'organization',
      organization: `urn:li:organization:${organizationId}`,
      ...params,
    });
  }

  async getShareAnalytics(shares: string[]): Promise<{ elements: ShareStatistics[] }> {
    return this.client.get<{ elements: ShareStatistics[] }>('/organizationalEntityShareStatistics', {
      q: 'organizationalEntity',
      shares: `List(${shares.join(',')})`,
    });
  }

  // ============================================
  // Connection Methods
  // ============================================

  async getConnectionStats(): Promise<ConnectionStats> {
    return this.client.get<ConnectionStats>('/networkSizes/urn:li:person:me', {
      edgeType: 'CompanyFollowedByMember',
    });
  }

  // ============================================
  // Comment Methods
  // ============================================

  async createComment(params: CreateCommentParams): Promise<Comment> {
    return this.client.post<Comment>('/socialActions', {
      actor: params.actor,
      object: params.object,
      message: {
        text: params.message,
      },
      parentComment: params.parentComment,
    });
  }

  async listComments(objectId: string, params?: { start?: number; count?: number }): Promise<CommentListResponse> {
    return this.client.get<CommentListResponse>(`/socialActions/${encodeURIComponent(objectId)}/comments`, params);
  }

  async deleteComment(commentId: string): Promise<void> {
    return this.client.delete<void>(`/socialActions/${encodeURIComponent(commentId)}`);
  }

  // ============================================
  // Reaction Methods
  // ============================================

  async createReaction(params: CreateReactionParams): Promise<Reaction> {
    return this.client.post<Reaction>(`/socialActions/${encodeURIComponent(params.object)}/likes`, {
      actor: params.actor,
      object: params.object,
      reactionType: params.reactionType,
    });
  }

  async listReactions(objectId: string, params?: { start?: number; count?: number }): Promise<ReactionListResponse> {
    return this.client.get<ReactionListResponse>(`/socialActions/${encodeURIComponent(objectId)}/likes`, params);
  }

  async deleteReaction(objectId: string, actorId: string): Promise<void> {
    return this.client.delete<void>(`/socialActions/${encodeURIComponent(objectId)}/likes/${encodeURIComponent(actorId)}`);
  }

  // ============================================
  // Share Methods (Legacy - redirects to UGC)
  // ============================================

  async createShare(params: {
    owner: string;
    text: string;
    visibility?: Visibility;
    mediaCategory?: ShareMediaCategory;
    media?: Array<{
      status: 'READY';
      originalUrl?: string;
      title?: string;
      description?: string;
    }>;
  }): Promise<{ id: string }> {
    return this.createPost({
      author: params.owner,
      commentary: params.text,
      visibility: params.visibility || 'PUBLIC',
      shareMediaCategory: params.mediaCategory,
      media: params.media,
    });
  }
}

export { LinkedInClient } from './client';
