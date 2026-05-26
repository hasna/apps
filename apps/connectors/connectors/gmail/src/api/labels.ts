import type { GmailClient } from './client';
import type { GmailLabel } from '../types';

export interface CreateLabelOptions {
  name: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  backgroundColor?: string;
  textColor?: string;
}

export interface UpdateLabelOptions {
  name?: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  backgroundColor?: string;
  textColor?: string;
}

export class LabelsApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * List all labels in the user's mailbox
   */
  async list(): Promise<{ labels: GmailLabel[] }> {
    return this.client.get<{ labels: GmailLabel[] }>(
      `/users/${this.client.getUserId()}/labels`
    );
  }

  /**
   * Get a specific label by ID
   */
  async get(labelId: string): Promise<GmailLabel> {
    return this.client.get<GmailLabel>(
      `/users/${this.client.getUserId()}/labels/${labelId}`
    );
  }

  /**
   * Create a new label
   */
  async create(options: CreateLabelOptions): Promise<GmailLabel> {
    const body: Record<string, unknown> = {
      name: options.name,
    };

    if (options.messageListVisibility) {
      body.messageListVisibility = options.messageListVisibility;
    }

    if (options.labelListVisibility) {
      body.labelListVisibility = options.labelListVisibility;
    }

    if (options.backgroundColor || options.textColor) {
      body.color = {
        backgroundColor: options.backgroundColor,
        textColor: options.textColor,
      };
    }

    return this.client.post<GmailLabel>(
      `/users/${this.client.getUserId()}/labels`,
      body
    );
  }

  /**
   * Update an existing label
   */
  async update(labelId: string, options: UpdateLabelOptions): Promise<GmailLabel> {
    const body: Record<string, unknown> = {
      id: labelId,
    };

    if (options.name) {
      body.name = options.name;
    }

    if (options.messageListVisibility) {
      body.messageListVisibility = options.messageListVisibility;
    }

    if (options.labelListVisibility) {
      body.labelListVisibility = options.labelListVisibility;
    }

    if (options.backgroundColor || options.textColor) {
      body.color = {
        backgroundColor: options.backgroundColor,
        textColor: options.textColor,
      };
    }

    return this.client.patch<GmailLabel>(
      `/users/${this.client.getUserId()}/labels/${labelId}`,
      body
    );
  }

  /**
   * Delete a label
   */
  async delete(labelId: string): Promise<void> {
    await this.client.delete(
      `/users/${this.client.getUserId()}/labels/${labelId}`
    );
  }

  /**
   * Get label by name
   */
  async getByName(name: string): Promise<GmailLabel | undefined> {
    const { labels } = await this.list();
    return labels.find(label => label.name.toLowerCase() === name.toLowerCase());
  }
}
