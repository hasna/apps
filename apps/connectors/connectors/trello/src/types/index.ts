// Trello Connector Types
// Boards, lists, cards, and checklists management

// ============================================
// Configuration
// ============================================

export interface TrelloConfig {
  apiKey: string;
  token: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Member Types
// ============================================

export interface Member {
  id: string;
  username: string;
  fullName: string;
  initials?: string;
  avatarHash?: string;
  avatarUrl?: string;
  email?: string;
  url?: string;
  confirmed?: boolean;
  memberType?: 'admin' | 'normal' | 'observer';
  status?: string;
  idBoards?: string[];
  idOrganizations?: string[];
}

// ============================================
// Board Types
// ============================================

export interface Board {
  id: string;
  name: string;
  desc?: string;
  descData?: object;
  closed?: boolean;
  idOrganization?: string;
  pinned?: boolean;
  url?: string;
  shortUrl?: string;
  prefs?: BoardPrefs;
  labelNames?: Record<string, string>;
  starred?: boolean;
  memberships?: BoardMembership[];
  shortLink?: string;
  dateLastActivity?: string;
  dateLastView?: string;
}

export interface BoardPrefs {
  permissionLevel?: 'private' | 'org' | 'public';
  voting?: 'disabled' | 'members' | 'observers' | 'org' | 'public';
  comments?: 'disabled' | 'members' | 'observers' | 'org' | 'public';
  invitations?: 'admins' | 'members';
  selfJoin?: boolean;
  cardCovers?: boolean;
  background?: string;
  backgroundColor?: string;
  backgroundImage?: string;
}

export interface BoardMembership {
  id: string;
  idMember: string;
  memberType: 'admin' | 'normal' | 'observer';
  unconfirmed?: boolean;
  deactivated?: boolean;
}

export interface CreateBoardInput {
  name: string;
  desc?: string;
  idOrganization?: string;
  defaultLabels?: boolean;
  defaultLists?: boolean;
  prefs_permissionLevel?: 'private' | 'org' | 'public';
  prefs_voting?: 'disabled' | 'members' | 'observers' | 'org' | 'public';
  prefs_comments?: 'disabled' | 'members' | 'observers' | 'org' | 'public';
  prefs_background?: string;
}

// ============================================
// List Types
// ============================================

export interface List {
  id: string;
  name: string;
  closed?: boolean;
  idBoard?: string;
  pos?: number;
  subscribed?: boolean;
}

export interface CreateListInput {
  name: string;
  idBoard: string;
  pos?: 'top' | 'bottom' | number;
}

// ============================================
// Card Types
// ============================================

export interface Card {
  id: string;
  name: string;
  desc?: string;
  closed?: boolean;
  idBoard?: string;
  idList?: string;
  idMembers?: string[];
  idLabels?: string[];
  idChecklists?: string[];
  idAttachmentCover?: string;
  manualCoverAttachment?: boolean;
  pos?: number;
  shortLink?: string;
  shortUrl?: string;
  url?: string;
  due?: string;
  dueComplete?: boolean;
  start?: string;
  dateLastActivity?: string;
  labels?: Label[];
  badges?: CardBadges;
  subscribed?: boolean;
  cover?: CardCover;
}

export interface CardBadges {
  votes?: number;
  viewingMemberVoted?: boolean;
  subscribed?: boolean;
  fogbugz?: string;
  checkItems?: number;
  checkItemsChecked?: number;
  comments?: number;
  attachments?: number;
  description?: boolean;
  due?: string;
  dueComplete?: boolean;
  start?: string;
}

export interface CardCover {
  idAttachment?: string;
  color?: string;
  idUploadedBackground?: string;
  size?: 'normal' | 'full';
  brightness?: 'dark' | 'light';
}

export interface CreateCardInput {
  name: string;
  idList: string;
  desc?: string;
  pos?: 'top' | 'bottom' | number;
  due?: string;
  start?: string;
  dueComplete?: boolean;
  idMembers?: string[];
  idLabels?: string[];
  urlSource?: string;
}

// ============================================
// Label Types
// ============================================

export interface Label {
  id: string;
  idBoard: string;
  name: string;
  color?: 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'lime' | 'pink' | 'black' | null;
}

export interface CreateLabelInput {
  name: string;
  color: 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'lime' | 'pink' | 'black';
  idBoard: string;
}

// ============================================
// Checklist Types
// ============================================

export interface Checklist {
  id: string;
  name: string;
  idBoard?: string;
  idCard?: string;
  pos?: number;
  checkItems?: CheckItem[];
}

export interface CheckItem {
  id: string;
  name: string;
  state?: 'incomplete' | 'complete';
  pos?: number;
  idChecklist?: string;
  due?: string;
  idMember?: string;
}

export interface CreateChecklistInput {
  name: string;
  idCard: string;
  pos?: 'top' | 'bottom' | number;
}

export interface CreateCheckItemInput {
  name: string;
  pos?: 'top' | 'bottom' | number;
  checked?: boolean;
  due?: string;
  idMember?: string;
}

// ============================================
// Comment Types
// ============================================

export interface Action {
  id: string;
  idMemberCreator: string;
  data?: {
    text?: string;
    card?: { id: string; name: string };
    board?: { id: string; name: string };
    list?: { id: string; name: string };
  };
  type: string;
  date?: string;
  memberCreator?: Member;
}

// ============================================
// Attachment Types
// ============================================

export interface Attachment {
  id: string;
  name: string;
  url?: string;
  bytes?: number;
  date?: string;
  edgeColor?: string;
  idMember?: string;
  isUpload?: boolean;
  mimeType?: string;
  pos?: number;
  previews?: AttachmentPreview[];
}

export interface AttachmentPreview {
  id?: string;
  url?: string;
  width?: number;
  height?: number;
  bytes?: number;
  scaled?: boolean;
}

// ============================================
// Organization Types
// ============================================

export interface Organization {
  id: string;
  name: string;
  displayName?: string;
  desc?: string;
  url?: string;
  website?: string;
  logoHash?: string;
  products?: number[];
  powerUps?: number[];
}

// ============================================
// API Error Types
// ============================================

export interface TrelloErrorDetail {
  message: string;
  error?: string;
}

export class TrelloApiError extends Error {
  public readonly statusCode: number;
  public readonly errorInfo?: string;

  constructor(message: string, statusCode: number, errorInfo?: string) {
    super(message);
    this.name = 'TrelloApiError';
    this.statusCode = statusCode;
    this.errorInfo = errorInfo;
  }
}
