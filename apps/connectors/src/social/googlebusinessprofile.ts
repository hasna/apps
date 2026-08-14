/**
 * Google Business Profile adapter for the stateless social SDK.
 *
 * The connectors/googlebusinessprofile scaffold is an empty template, so we
 * implement a minimal raw-fetch transport here against the Business Profile APIs
 * with a Bearer access token. Bundle-safe (fetch + Buffer only).
 *
 *   account.me   GET    https://mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   post.create  POST   https://mybusiness.googleapis.com/v4/{name}/localPosts   (accountId + locationId)
 *   post.delete  DELETE https://mybusiness.googleapis.com/v4/{localPostName}
 *   media.upload POST   .../localPosts media (or accounts/locations media create)
 */
import { ConnectorOperationNotSupported } from "./errors";
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

export interface GoogleBusinessProfileCredentials {
  accessToken: string;
  accountId?: string;
  locationId?: string;
}

/** Google Business Profile `post.create` extras (accountId + locationId required). */
export interface GoogleBusinessProfilePostExtras {
  accountId?: string;
  locationId?: string;
  /** Call-to-action, e.g. { actionType: "LEARN_MORE", url: "https://..." }. */
  cta?: { actionType: string; url?: string };
}

/** Google Business Profile `media.upload` extras. */
export interface GoogleBusinessProfileMediaExtras {
  accountId?: string;
  locationId?: string;
  /** Public URL of the image to attach (GBP media items are created from a URL). */
  sourceUrl?: string;
}

const ACCT_MGMT = "https://mybusinessaccountmanagement.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";

export class GoogleBusinessProfileAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly defaultAccountId?: string;
  private readonly defaultLocationId?: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: GoogleBusinessProfileCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("googlebusinessprofile credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.defaultAccountId = creds.accountId;
    this.defaultLocationId = creds.locationId;
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(
    creds: GoogleBusinessProfileCredentials,
    fetchImpl?: FetchLike,
  ): GoogleBusinessProfileAdapter {
    return new GoogleBusinessProfileAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, ...(extra ?? {}) };
  }

  private resolveIds(input: GoogleBusinessProfilePostExtras): { accountId: string; locationId: string } {
    const accountId = input.accountId ?? this.defaultAccountId;
    const locationId = input.locationId ?? this.defaultLocationId;
    if (!accountId) throw new Error("googlebusinessprofile requires `accountId` (in input or credentials)");
    if (!locationId) throw new Error("googlebusinessprofile requires `locationId` (in input or credentials)");
    return { accountId, locationId };
  }

  async accountMe(): Promise<AccountMeResult> {
    const res = await jsonRequest<{
      accounts?: Array<{ name?: string; accountName?: string; type?: string }>;
    }>(this.fetchImpl, `${ACCT_MGMT}/accounts`, { headers: this.headers(), errorLabel: "GoogleBusinessProfile" });
    const account = res.accounts?.[0];
    if (!account) {
      throw new Error("googlebusinessprofile account.me: no accounts found for the authenticated user");
    }
    const id = (account.name ?? "").replace(/^accounts\//, "");
    return {
      id,
      username: account.accountName,
      displayName: account.accountName,
      url: undefined,
    };
  }

  async postCreate(input: PostCreateInput & GoogleBusinessProfilePostExtras): Promise<PostCreateResult> {
    const { accountId, locationId } = this.resolveIds(input);
    const parent = `accounts/${accountId}/locations/${locationId}`;
    const body: Record<string, unknown> = {
      languageCode: "en-US",
      summary: input.text,
      topicType: "STANDARD",
    };
    if (input.cta) {
      body.callToAction = { actionType: input.cta.actionType, url: input.cta.url };
    }
    if (input.mediaIds && input.mediaIds.length > 0) {
      body.media = input.mediaIds.map((m) => ({ mediaFormat: "PHOTO", sourceUrl: m }));
    }
    const post = await jsonRequest<{ name: string; searchUrl?: string }>(
      this.fetchImpl,
      `${V4}/${parent}/localPosts`,
      { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body, errorLabel: "GoogleBusinessProfile" },
    );
    return { id: post.name, url: post.searchUrl };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${V4}/${input.id}`, {
      method: "DELETE",
      headers: this.headers(),
      errorLabel: "GoogleBusinessProfile",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput & GoogleBusinessProfileMediaExtras): Promise<MediaUploadResult> {
    // GBP media items are created from a public `sourceUrl`; the binary-data
    // resumable path is a separate Google upload service not modeled here. We
    // create the media item against the location and return its resource name.
    if (!input.sourceUrl) {
      throw new ConnectorOperationNotSupported(
        "googlebusinessprofile",
        "media.upload (provide a public `sourceUrl`; raw binary upload uses a separate resumable service)",
      );
    }
    const { accountId, locationId } = this.resolveIds(input);
    const parent = `accounts/${accountId}/locations/${locationId}`;
    const media = await jsonRequest<{ name: string }>(this.fetchImpl, `${V4}/${parent}/media`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: {
        mediaFormat: "PHOTO",
        locationAssociation: { category: "ADDITIONAL" },
        sourceUrl: input.sourceUrl,
      },
      errorLabel: "GoogleBusinessProfile",
    });
    return { mediaId: media.name };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "googlebusinessprofile",
      "mentions.list (no mentions concept; reviews are a separate surface)",
    );
  }

  async analyticsPost(_input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    throw new ConnectorOperationNotSupported(
      "googlebusinessprofile",
      "analytics.post (per-localPost insights are not exposed; use location-level Performance API)",
    );
  }
}
