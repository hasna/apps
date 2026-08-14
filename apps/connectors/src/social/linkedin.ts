/**
 * LinkedIn adapter for the stateless social SDK.
 *
 * The connectors/linkedin transport is configured from env / disk and shapes its
 * results differently than the normalized contract, so we implement a minimal
 * raw-fetch transport here against the LinkedIn REST API with a Bearer access
 * token. Bundle-safe (fetch + Buffer only).
 *
 * Endpoints:
 *   account.me   GET  /v2/me
 *   post.create  POST /v2/ugcPosts  (UGC share; commentary = text)
 *   media.upload assets registerUpload + binary PUT
 */
import { ConnectorOperationNotSupported } from "./errors";
import { decodeBase64 } from "./util";
import { jsonRequest, resolveFetch, type FetchLike } from "./http";
import type {
  AccountMeResult,
  AnalyticsPostInput,
  AnalyticsPostResult,
  MediaUploadInput,
  MediaUploadResult,
  MentionsListInput,
  MentionsListResult,
  PostCreateInput,
  PostCreateResult,
  PostDeleteInput,
  PostDeleteResult,
  SocialAdapter,
} from "./types";

export interface LinkedInCredentials {
  accessToken: string;
  /** Author URN, e.g. "urn:li:person:abc123". Resolved from /me if omitted. */
  authorUrn?: string;
  baseUrl?: string;
}

/** LinkedIn `post.create` extras. */
export interface LinkedInPostExtras {
  /** Visibility: PUBLIC (default) or CONNECTIONS. */
  visibility?: "PUBLIC" | "CONNECTIONS";
}

const DEFAULT_BASE = "https://api.linkedin.com";

export class LinkedInAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private authorUrn?: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: LinkedInCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("linkedin credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.authorUrn = creds.authorUrn;
    this.baseUrl = (creds.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: LinkedInCredentials, fetchImpl?: FetchLike): LinkedInAdapter {
    return new LinkedInAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(extra ?? {}),
    };
  }

  private async resolveAuthorUrn(): Promise<string> {
    if (this.authorUrn) return this.authorUrn;
    const me = await jsonRequest<{ id: string }>(this.fetchImpl, `${this.baseUrl}/v2/me`, {
      headers: this.headers(),
      errorLabel: "LinkedIn",
    });
    this.authorUrn = `urn:li:person:${me.id}`;
    return this.authorUrn;
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await jsonRequest<{
      id: string;
      localizedFirstName?: string;
      localizedLastName?: string;
      vanityName?: string;
    }>(this.fetchImpl, `${this.baseUrl}/v2/me`, { headers: this.headers(), errorLabel: "LinkedIn" });
    this.authorUrn = `urn:li:person:${me.id}`;
    const displayName = [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ") || undefined;
    return {
      id: me.id,
      username: me.vanityName ?? me.id,
      displayName,
      url: me.vanityName ? `https://www.linkedin.com/in/${me.vanityName}` : undefined,
    };
  }

  async postCreate(input: PostCreateInput & LinkedInPostExtras): Promise<PostCreateResult> {
    const author = await this.resolveAuthorUrn();
    const visibility = input.visibility ?? "PUBLIC";
    const hasMedia = Boolean(input.mediaIds && input.mediaIds.length > 0);
    const shareContent: Record<string, unknown> = {
      shareCommentary: { text: input.text },
      shareMediaCategory: hasMedia ? "IMAGE" : "NONE",
    };
    if (hasMedia) {
      shareContent.media = input.mediaIds!.map((m) => ({ status: "READY", media: m }));
    }
    const body = {
      author,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": visibility },
    };
    const res = await jsonRequest<{ id: string }>(this.fetchImpl, `${this.baseUrl}/v2/ugcPosts`, {
      method: "POST",
      headers: this.headers(),
      body,
      errorLabel: "LinkedIn",
    });
    return {
      id: res.id,
      url: `https://www.linkedin.com/feed/update/${res.id}`,
    };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${this.baseUrl}/v2/ugcPosts/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      headers: this.headers(),
      errorLabel: "LinkedIn",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const author = await this.resolveAuthorUrn();
    // 1) registerUpload to get an upload URL + asset URN.
    const register = await jsonRequest<{
      value: {
        asset: string;
        uploadMechanism: {
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: string };
        };
      };
    }>(this.fetchImpl, `${this.baseUrl}/v2/assets?action=registerUpload`, {
      method: "POST",
      headers: this.headers(),
      body: {
        registerUploadRequest: {
          owner: author,
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          serviceRelationships: [
            { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
          ],
        },
      },
      errorLabel: "LinkedIn",
    });
    const asset = register.value.asset;
    const uploadUrl =
      register.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
    // 2) PUT the binary to the upload URL.
    const buffer = decodeBase64(input.dataBase64);
    const bytes = Uint8Array.from(buffer);
    const put = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": input.mimeType },
      body: bytes,
    });
    if (!put.ok) {
      throw new Error(`LinkedIn ${put.status}: media upload failed`);
    }
    return { mediaId: asset };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "linkedin",
      "mentions.list (no public mentions/notifications endpoint)",
    );
  }

  async analyticsPost(_input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    throw new ConnectorOperationNotSupported(
      "linkedin",
      "analytics.post (requires organization socialActions scope; not available for member shares)",
    );
  }
}
