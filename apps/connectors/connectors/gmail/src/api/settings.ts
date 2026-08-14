import type { GmailClient } from './client';

// ============================================
// Settings API Types
// ============================================

export interface GetSettingsOptions {
  format?: 'full' | 'minimal';
}

export interface GmailSettings {
  autoForwardAddresses?: AutoForwardingAddress[];
  displayName: string;
  emailAddress: string;
  hasAGoogleAppsDomain?: boolean;
  language: string;
  replyToAddresses?: string[];
  signatures: Signature[];
  vacationResponder: VacationResponder;
  autoDeleteChats?: AutoDeleteChatsValue[];
  keyboardShortcuts?: boolean;
  locale: string;
  markImportantEmailsAsRead?: boolean;
  useExternalCalendarInvites?: boolean;
  conversationView?: boolean;
  defaultSnippets?: boolean;
  externalBodyContent?: boolean;
  imagesInEmails?: ImagesInEmailsValue;
  unreadMessageIcon?: UnreadMessageIconValue;
  indicators?: string[];
  dateStampFormat?: number;
  defaultInboxStyle?: string;
  dotsInEmails?: string;
  autoAdvance?: AutoAdvanceValue;
  allowCustomFrom?: boolean;
  fontSize?: string;
  defaultCccPref?: boolean;
  autoCreateContacts?: boolean;
  allowMailToLinks?: boolean;
  replyFromAddress: ReplyFromAddress;
}

export interface AutoForwardingAddress {
  forwardingEmailAddress: string;
  verificationStatus: string;
  disposition: string;
}

export interface Signature {
  sendAsEmail: string;
  signature: string;
  isDefault: boolean;
}

export interface VacationResponder {
  enableAutoReply: boolean;
  responseBodyHtml: string;
  responseBodyPlainText: string;
  subject: string;
  startTime: string;
  endTime: string;
  restrictToContacts: boolean;
  restrictToDomain: boolean;
}

export interface ReplyFromAddress {
  treatAsAlias: boolean;
  sendAsEmail: string;
}

export type AutoDeleteChatsValue = 'autoDeleteForever' | 'autoDeleteNever' | 'autoDeleteAfter30Days';
export type ImagesInEmailsValue = 'displayExternal' | 'alwaysDisplay';
export type UnreadMessageIconValue = 'number' | 'dot' | 'nothing';
export type AutoAdvanceValue = 'goToNext' | 'goToPrev' | 'goToInbox';

export interface AutoForwarding {
  enabled: boolean;
  emailAddress: string;
  disposition: 'leaveInInbox' | 'archive' | 'trash' | 'markRead' | 'leaveInInboxAndMarkRead';
}

export interface PopSettings {
  accessWindow: 'disabled' | 'fromNowOn' | 'allMail';
  disposition: 'archive' | 'trash' | 'leaveInInbox';
}

export interface ImapSettings {
  enabled: boolean;
  autoExpunge: boolean;
  expungeBehavior: 'archive' | 'trash' | 'markRead';
  maxFolderSize: number;
}

export interface LanguageSettings {
  displayLanguage: string;
  writeLanguage: string;
}

export interface SendAsEmail {
  sendAsEmail: string;
  displayName: string;
  replyToAddress: string;
  signature: string;
  isPrimary: boolean;
  isDefault: boolean;
  treatAsAlias: boolean;
  smtpMsa?: {
    host: string;
    port: number;
    username: string;
    securityMode: 'none' | 'ssl' | 'starttls';
  };
  verificationStatus: 'accepted' | 'pending';
}

export interface CreateSendAsOptions {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  treatAsAlias?: boolean;
  isDefault?: boolean;
}

export interface UpdateSendAsOptions {
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  treatAsAlias?: boolean;
  isDefault?: boolean;
}

export interface CreateSmtpMsaOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  securityMode: 'none' | 'ssl' | 'starttls';
}

/**
 * Settings API module - Gmail account settings, send-as, POP, IMAP, forwarding
 */
export class SettingsApi {
  constructor(private readonly client: GmailClient) {}

  /**
   * Get user's Gmail settings
   */
  async get(options: GetSettingsOptions = {}): Promise<GmailSettings> {
    const params: Record<string, string> = {};
    if (options.format) params.format = options.format;
    return this.client.get<GmailSettings>('/v1/users/me/settings', params);
  }

  /**
   * Get auto-forwarding settings
   */
  async getAutoForwarding(): Promise<AutoForwarding> {
    return this.client.get<AutoForwarding>('/v1/users/me/settings/autoForwarding');
  }

  /**
   * Update auto-forwarding settings
   */
  async updateAutoForwarding(forwarding: Omit<AutoForwarding, 'emailAddress'> & { emailAddress: string }): Promise<AutoForwarding> {
    return this.client.put<AutoForwarding>('/v1/users/me/settings/autoForwarding', forwarding as unknown as unknown as Record<string, unknown>);
  }

  /**
   * Get POP settings
   */
  async getPop(): Promise<PopSettings> {
    return this.client.get<PopSettings>('/v1/users/me/settings/pop');
  }

  /**
   * Update POP settings
   */
  async updatePop(pop: PopSettings): Promise<PopSettings> {
    return this.client.put<PopSettings>('/v1/users/me/settings/pop', pop as unknown as Record<string, unknown>);
  }

  /**
   * Get IMAP settings
   */
  async getImap(): Promise<ImapSettings> {
    return this.client.get<ImapSettings>('/v1/users/me/settings/imap');
  }

  /**
   * Update IMAP settings
   */
  async updateImap(imap: ImapSettings): Promise<ImapSettings> {
    return this.client.put<ImapSettings>('/v1/users/me/settings/imap', imap as unknown as Record<string, unknown>);
  }

  /**
   * Get language settings
   */
  async getLanguage(): Promise<LanguageSettings> {
    return this.client.get<LanguageSettings>('/v1/users/me/settings/language');
  }

  /**
   * Update language settings
   */
  async updateLanguage(language: LanguageSettings): Promise<LanguageSettings> {
    return this.client.put<LanguageSettings>('/v1/users/me/settings/language', language as unknown as Record<string, unknown>);
  }

  /**
   * List all send-as addresses
   */
  async listSendAs(): Promise<{ sendAs: SendAsEmail[] }> {
    return this.client.get('/v1/users/me/settings/sendAs');
  }

  /**
   * Get a specific send-as address
   */
  async getSendAs(sendAsEmail: string): Promise<SendAsEmail> {
    const encoded = encodeURIComponent(sendAsEmail);
    return this.client.get<SendAsEmail>(`/v1/users/me/settings/sendAs/${encoded}`);
  }

  /**
   * Create a new send-as alias
   */
  async createSendAs(options: CreateSendAsOptions): Promise<SendAsEmail> {
    const body: Record<string, unknown> = { sendAsEmail: options.sendAsEmail };
    if (options.displayName !== undefined) body.displayName = options.displayName;
    if (options.replyToAddress !== undefined) body.replyToAddress = options.replyToAddress;
    if (options.signature !== undefined) body.signature = options.signature;
    if (options.treatAsAlias !== undefined) body.treatAsAlias = options.treatAsAlias;
    if (options.isDefault !== undefined) body.isDefault = options.isDefault;

    return this.client.post<SendAsEmail>('/v1/users/me/settings/sendAs', body);
  }

  /**
   * Update a send-as alias
   */
  async updateSendAs(sendAsEmail: string, options: UpdateSendAsOptions): Promise<SendAsEmail> {
    const encoded = encodeURIComponent(sendAsEmail);
    return this.client.put<SendAsEmail>(`/v1/users/me/settings/sendAs/${encoded}`, options as unknown as Record<string, unknown>);
  }

  /**
   * Delete a send-as alias
   */
  async deleteSendAs(sendAsEmail: string): Promise<void> {
    const encoded = encodeURIComponent(sendAsEmail);
    await this.client.delete(`/v1/users/me/settings/sendAs/${encoded}`);
  }

  /**
   * Set SMTP MSA for a send-as alias (for third-party SMTP)
   */
  async setSendAsSmtpMsa(sendAsEmail: string, smtp: CreateSmtpMsaOptions): Promise<SendAsEmail> {
    const encoded = encodeURIComponent(sendAsEmail);
    return this.client.put<SendAsEmail>(`/v1/users/me/settings/sendAs/${encoded}/smtpMsa`, smtp as unknown as Record<string, unknown>);
  }

  /**
   * Delete SMTP MSA for a send-as alias (revert to Gmail's servers)
   */
  async deleteSendAsSmtpMsa(sendAsEmail: string): Promise<SendAsEmail> {
    const encoded = encodeURIComponent(sendAsEmail);
    return this.client.delete<SendAsEmail>(`/v1/users/me/settings/sendAs/${encoded}/smtpMsa`);
  }

  /**
   * Request verification for a send-as alias
   */
  async verifySendAs(sendAsEmail: string): Promise<void> {
    const encoded = encodeURIComponent(sendAsEmail);
    await this.client.post(`/v1/users/me/settings/sendAs/${encoded}/verify`);
  }
}
