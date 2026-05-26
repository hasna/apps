import type { SubstackClient } from './client';
import type { Publication } from '../types';

/**
 * Publication API
 * Get publication/profile information
 */
export class PublicationApi {
  constructor(private readonly client: SubstackClient) {}

  /**
   * Get publication information
   */
  async get(): Promise<Publication> {
    const response = await this.client.request<Record<string, unknown>>('/publication');

    return this.transformPublication(response);
  }

  /**
   * Get publication by subdomain (public endpoint)
   */
  async getBySubdomain(subdomain: string): Promise<Publication> {
    // This can be done without authentication through the public API
    const response = await fetch(`https://${subdomain}.substack.com/api/v1/publication`);

    if (!response.ok) {
      throw new Error(`Failed to get publication: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.transformPublication(data);
  }

  /**
   * Get sections/categories for the publication
   */
  async sections(): Promise<Array<{
    id: number;
    name: string;
    slug: string;
    description?: string;
    post_count?: number;
  }>> {
    const response = await this.client.request<unknown[]>('/sections');

    return (response || []).map((item: unknown) => {
      const data = item as Record<string, unknown>;
      return {
        id: data.id as number,
        name: data.name as string,
        slug: data.slug as string,
        description: data.description as string | undefined,
        post_count: data.post_count as number | undefined,
      };
    });
  }

  /**
   * Get user/author information
   */
  async me(): Promise<{
    id: number;
    name: string;
    email: string;
    handle?: string;
    photo_url?: string;
    bio?: string;
    publications: Publication[];
  }> {
    const response = await this.client.request<Record<string, unknown>>('/user/me');

    const publications = Array.isArray(response.publications)
      ? (response.publications as Record<string, unknown>[]).map(p => this.transformPublication(p))
      : [];

    return {
      id: response.id as number,
      name: response.name as string,
      email: response.email as string,
      handle: response.handle as string | undefined,
      photo_url: response.photo_url as string | undefined,
      bio: response.bio as string | undefined,
      publications,
    };
  }

  private transformPublication(data: Record<string, unknown>): Publication {
    return {
      id: data.id as number,
      subdomain: data.subdomain as string,
      name: data.name as string,
      custom_domain: data.custom_domain as string | undefined,
      custom_domain_optional: data.custom_domain_optional as boolean | undefined,
      logo_url: data.logo_url as string | undefined,
      hero_image: data.hero_image as string | undefined,
      author_id: data.author_id as number,
      copyright: data.copyright as string | undefined,
      created_at: data.created_at as string,
      language: data.language as string | undefined,
      email_from_name: data.email_from_name as string | undefined,
      email_banner_url: data.email_banner_url as string | undefined,
      community_enabled: data.community_enabled as boolean | undefined,
      invite_only: data.invite_only as boolean | undefined,
      default_write_comment_permissions: data.default_write_comment_permissions as string | undefined,
      subscriber_count: data.subscriber_count as number | undefined,
      post_count: data.post_count as number | undefined,
      paid_subscriber_count: data.paid_subscriber_count as number | undefined,
      free_subscriber_count: data.free_subscriber_count as number | undefined,
      homepage_type: data.homepage_type as string | undefined,
      about_page_id: data.about_page_id as number | undefined,
      default_group_coupon_percent_off: data.default_group_coupon_percent_off as number | undefined,
      twitter_share_type: data.twitter_share_type as string | undefined,
      founding_subscribers_enabled: data.founding_subscribers_enabled as boolean | undefined,
      default_show_guest_bios: data.default_show_guest_bios as boolean | undefined,
      apple_pay_disabled: data.apple_pay_disabled as boolean | undefined,
      author: data.author ? {
        id: (data.author as Record<string, unknown>).id as number,
        name: (data.author as Record<string, unknown>).name as string,
        handle: (data.author as Record<string, unknown>).handle as string | undefined,
        photo_url: (data.author as Record<string, unknown>).photo_url as string | undefined,
        bio: (data.author as Record<string, unknown>).bio as string | undefined,
      } : undefined,
    };
  }
}
