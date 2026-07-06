import type { TwitchConfig } from '../types';
import { TwitchClient } from './client';
import { UsersApi } from './users';
import { ChannelsApi } from './channels';
import { StreamsApi } from './streams';
import { SearchApi } from './search';
import { ChatApi } from './chat';
import { FollowersApi } from './followers';

export class Twitch {
  private readonly client: TwitchClient;

  public readonly users: UsersApi;
  public readonly channels: ChannelsApi;
  public readonly streams: StreamsApi;
  public readonly search: SearchApi;
  public readonly chat: ChatApi;
  public readonly followers: FollowersApi;

  constructor(config: TwitchConfig) {
    this.client = new TwitchClient(config);
    this.users = new UsersApi(this.client);
    this.channels = new ChannelsApi(this.client);
    this.streams = new StreamsApi(this.client);
    this.search = new SearchApi(this.client);
    this.chat = new ChatApi(this.client);
    this.followers = new FollowersApi(this.client);
  }

  static fromEnv(): Twitch {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId) throw new Error('TWITCH_CLIENT_ID environment variable is required');
    if (!clientSecret) throw new Error('TWITCH_CLIENT_SECRET environment variable is required');
    return new Twitch({
      clientId,
      clientSecret,
      accessToken: process.env.TWITCH_ACCESS_TOKEN,
      refreshToken: process.env.TWITCH_REFRESH_TOKEN,
    });
  }

  getClient(): TwitchClient {
    return this.client;
  }

  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scopes: string[],
    state: string,
  ): string {
    return TwitchClient.getAuthorizationUrl(clientId, redirectUri, scopes, state);
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope: string[];
  }> {
    const response = await TwitchClient.exchangeCode(clientId, clientSecret, code, redirectUri);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }
}

export { TwitchClient } from './client';
export { UsersApi } from './users';
export { ChannelsApi } from './channels';
export { StreamsApi } from './streams';
export { SearchApi } from './search';
export { ChatApi } from './chat';
export { FollowersApi } from './followers';
