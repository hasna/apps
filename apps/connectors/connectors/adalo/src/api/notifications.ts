import type { ConnectorClient } from './client';

export class NotificationsApi {
  constructor(private readonly client: ConnectorClient) {}

  private getAppId(appId?: string): string {
    const id = appId || this.client.appId;
    if (!id) {
      throw new Error('App ID is required. Set ADALO_APP_ID or pass --app-id.');
    }
    return id;
  }

  async send(userId: string, title: string, body: string, appId?: string): Promise<unknown> {
    const aid = this.getAppId(appId);
    return this.client.post<unknown>('/notifications', {
      appId: aid,
      audience: { id: userId },
      notification: { titleText: title, bodyText: body },
    });
  }
}
