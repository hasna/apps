// WATI API Types

export interface WatiConfig {
  apiKey: string;
  baseUrl: string;
}

export type OutputFormat = 'json' | 'pretty';

export type MessageEventType = 'sent' | 'delivered' | 'read' | 'received';
export type MessageDirection = 'inbound' | 'outbound';
export type ChatStatus = 'PENDING' | 'OPEN' | 'EXPIRED' | 'RESOLVED' | 'BOT';
export type AttributeType = 'Text' | 'Number' | 'Date' | 'DateTime' | 'List';

export interface CustomParam {
  name: string;
  value: string;
}

export interface GetContactsParams {
  pageSize?: number;
  pageNumber?: number;
  name?: string;
  createdDate?: string;
  attribute?: string;
}

export interface AddContactParams {
  whatsappNumber: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customParams?: CustomParam[];
}

export interface UpdateContactAttributesParams {
  whatsappNumber: string;
  customParams: CustomParam[];
}

export interface SendSessionMessageParams {
  whatsappNumber: string;
  messageText: string;
}

export interface SendSessionFileParams {
  whatsappNumber: string;
  fileUrl: string;
  caption?: string;
}

export interface SendTemplateMessageParams {
  whatsappNumber: string;
  templateName: string;
  broadcastName?: string;
  parameters?: CustomParam[];
  channelNumber?: string;
}

export interface TemplateReceiver {
  whatsappNumber: string;
  customParams?: CustomParam[];
}

export interface SendTemplateMessagesParams {
  templateName: string;
  broadcastName: string;
  receivers: TemplateReceiver[];
  channelNumber?: string;
}

export interface InteractiveHeader {
  type: 'Text' | 'Image' | 'Video' | 'Document';
  text?: string;
  mediaUrl?: string;
}

export interface InteractiveButton {
  text: string;
}

export interface SendInteractiveButtonsMessageParams {
  whatsappNumber: string;
  header?: InteractiveHeader;
  body: string;
  footer?: string;
  buttons: InteractiveButton[];
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title?: string;
  rows: InteractiveListRow[];
}

export interface SendInteractiveListMessageParams {
  whatsappNumber: string;
  header?: string;
  body: string;
  footer?: string;
  buttonText: string;
  sections: InteractiveListSection[];
}

export interface GetMessagesParams {
  whatsappNumber: string;
  pageSize?: number;
  pageNumber?: number;
  createdDate?: string;
  eventType?: MessageEventType;
  messageDirection?: MessageDirection;
}

export interface GetMediaFileParams {
  fileName: string;
}

export interface AssignOperatorParams {
  whatsappNumber: string;
  email: string;
}

export interface UnassignOperatorParams {
  whatsappNumber: string;
}

export interface UpdateChatStatusParams {
  whatsappNumber: string;
  status: ChatStatus;
}

export interface PaginationParams {
  pageSize?: number;
  pageNumber?: number;
}

export interface AddLabelsParams {
  whatsappNumber: string;
  labels: string[];
}

export interface RemoveLabelsParams {
  whatsappNumber: string;
  labels: string[];
}

export interface CreateCustomAttributeParams {
  name: string;
  type: AttributeType;
}

export interface GetBroadcastDetailsParams {
  broadcastName: string;
  pageSize?: number;
  pageNumber?: number;
}

export interface WatiApiResponse {
  result?: boolean;
  info?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export class WatiApiError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'WatiApiError';
    this.statusCode = statusCode;
  }
}
