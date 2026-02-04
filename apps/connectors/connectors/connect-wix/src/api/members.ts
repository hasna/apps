import type { WixClient } from './client';
import type { Member, MemberContact, MemberProfile, MemberPhoto, MemberAddress } from '../types';

export interface ListMembersOptions {
  limit?: number;
  offset?: number;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
  filter?: Record<string, unknown>;
}

/**
 * Wix Members API
 * Endpoint: /members/v1/members
 */
export class MembersApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List members
   */
  async list(options: ListMembersOptions = {}): Promise<Member[]> {
    const response = await this.client.request<{ members: Record<string, unknown>[] }>(
      '/members/v1/members/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
            sort: options.sort,
            filter: options.filter,
          },
        },
      }
    );

    return this.transformMembers(response.members || []);
  }

  /**
   * Get a single member by ID
   */
  async get(memberId: string): Promise<Member> {
    const response = await this.client.request<{ member: Record<string, unknown> }>(
      `/members/v1/members/${memberId}`,
      {
        params: {
          fieldsets: 'FULL',
        },
      }
    );

    return this.transformMember(response.member);
  }

  /**
   * Get current member (requires member auth context)
   */
  async getCurrentMember(): Promise<Member> {
    const response = await this.client.request<{ member: Record<string, unknown> }>(
      '/members/v1/members/my',
      {
        params: {
          fieldsets: 'FULL',
        },
      }
    );

    return this.transformMember(response.member);
  }

  /**
   * Get member count
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    const response = await this.client.request<{ members: Record<string, unknown>[]; pagingMetadata?: { total?: number } }>(
      '/members/v1/members/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: { limit: 1, offset: 0 },
            filter,
          },
        },
      }
    );

    return response.pagingMetadata?.total || response.members?.length || 0;
  }

  /**
   * Transform API response to our types
   */
  private transformMember(member: Record<string, unknown>): Member {
    const contact = member.contact as Record<string, unknown> | undefined;
    const profile = member.profile as Record<string, unknown> | undefined;

    return {
      id: member.id as string || member._id as string || '',
      loginEmail: member.loginEmail as string | undefined,
      loginEmailVerified: member.loginEmailVerified as boolean | undefined,
      status: (member.status as Member['status']) || 'UNKNOWN',
      contact: contact ? this.transformContact(contact) : undefined,
      profile: profile ? this.transformProfile(profile) : undefined,
      privacyStatus: member.privacyStatus as Member['privacyStatus'] | undefined,
      activityStatus: member.activityStatus as Member['activityStatus'] | undefined,
      createdDate: member.createdDate as string | member._createdDate as string | undefined,
      updatedDate: member.updatedDate as string | member._updatedDate as string | undefined,
      lastLoginDate: member.lastLoginDate as string | undefined,
    };
  }

  private transformMembers(members: Record<string, unknown>[]): Member[] {
    return members.map(m => this.transformMember(m));
  }

  private transformContact(contact: Record<string, unknown>): MemberContact {
    const addresses = contact.addresses as Record<string, unknown>[] | undefined;

    return {
      contactId: contact.contactId as string | undefined,
      firstName: contact.firstName as string | undefined,
      lastName: contact.lastName as string | undefined,
      phones: contact.phones as string[] | undefined,
      emails: contact.emails as string[] | undefined,
      addresses: addresses?.map(a => this.transformAddress(a)),
      birthdate: contact.birthdate as string | undefined,
      company: contact.company as string | undefined,
      jobTitle: contact.jobTitle as string | undefined,
      customFields: contact.customFields as Record<string, unknown> | undefined,
    };
  }

  private transformAddress(address: Record<string, unknown>): MemberAddress {
    return {
      id: address.id as string | address._id as string | undefined,
      addressLine: address.addressLine as string | undefined,
      addressLine2: address.addressLine2 as string | undefined,
      city: address.city as string | undefined,
      subdivision: address.subdivision as string | undefined,
      country: address.country as string | undefined,
      postalCode: address.postalCode as string | undefined,
    };
  }

  private transformProfile(profile: Record<string, unknown>): MemberProfile {
    const photo = profile.photo as Record<string, unknown> | undefined;
    const coverPhoto = profile.coverPhoto as Record<string, unknown> | undefined;

    return {
      nickname: profile.nickname as string | undefined,
      slug: profile.slug as string | undefined,
      photo: photo ? this.transformPhoto(photo) : undefined,
      coverPhoto: coverPhoto ? this.transformPhoto(coverPhoto) : undefined,
      title: profile.title as string | undefined,
    };
  }

  private transformPhoto(photo: Record<string, unknown>): MemberPhoto {
    return {
      id: photo.id as string | photo._id as string | undefined,
      url: photo.url as string | undefined,
      height: photo.height as number | undefined,
      width: photo.width as number | undefined,
      offsetX: photo.offsetX as number | undefined,
      offsetY: photo.offsetY as number | undefined,
    };
  }
}
