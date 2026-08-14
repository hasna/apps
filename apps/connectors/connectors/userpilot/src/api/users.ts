import type {
  BatchUser,
  GroupUserOptions,
  IdentifyUserOptions,
  ListUsersOptions,
  TrackEventOptions,
} from '../types';
import type { UserpilotClient } from './client';

export class UsersApi {
  constructor(private readonly client: UserpilotClient) {}

  identify(options: IdentifyUserOptions): Promise<unknown> {
    return this.client.post('/identify', options);
  }

  batchIdentify(users: BatchUser[]): Promise<unknown> {
    return this.client.post('/identify-batch', { users });
  }

  group(options: GroupUserOptions): Promise<unknown> {
    return this.client.post('/group', options);
  }

  track(options: TrackEventOptions): Promise<unknown> {
    return this.client.post('/track', options);
  }

  batchTrack(events: TrackEventOptions[]): Promise<unknown> {
    return this.client.post('/track-batch', { events });
  }

  delete(userId: string): Promise<unknown> {
    return this.client.delete(`/users/${encodeURIComponent(userId)}`);
  }

  list(options: ListUsersOptions = {}): Promise<unknown> {
    return this.client.get('/users', options);
  }

  get(userId: string): Promise<unknown> {
    return this.client.get(`/users/${encodeURIComponent(userId)}`);
  }
}
