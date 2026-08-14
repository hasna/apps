// YouTube Data API v3 and Analytics API Types

// ============================================
// Configuration
// ============================================

export interface YouTubeConfig {
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  uploadUrl?: string;
  analyticsUrl?: string;
}

// ============================================
// OAuth2 Types
// ============================================

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  userEmail?: string;
  userName?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PageInfo {
  totalResults: number;
  resultsPerPage: number;
}

export interface ListResponse<T> {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: PageInfo;
  items: T[];
}

// ISO 8601 date string
export type DateString = string;

// ============================================
// Thumbnail Types
// ============================================

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface ThumbnailDetails {
  default?: Thumbnail;
  medium?: Thumbnail;
  high?: Thumbnail;
  standard?: Thumbnail;
  maxres?: Thumbnail;
}

// ============================================
// Localized Types
// ============================================

export interface LocalizedText {
  title: string;
  description: string;
}

// ============================================
// Channel Types
// ============================================

export interface ChannelSnippet {
  title: string;
  description: string;
  customUrl?: string;
  publishedAt: DateString;
  thumbnails: ThumbnailDetails;
  defaultLanguage?: string;
  localized?: LocalizedText;
  country?: string;
}

export interface ChannelContentDetails {
  relatedPlaylists: {
    likes?: string;
    favorites?: string;
    uploads?: string;
    watchHistory?: string;
    watchLater?: string;
  };
}

export interface ChannelStatistics {
  viewCount: string;
  subscriberCount: string;
  hiddenSubscriberCount: boolean;
  videoCount: string;
}

export interface ChannelStatus {
  privacyStatus: 'public' | 'unlisted' | 'private';
  isLinked: boolean;
  longUploadsStatus: 'allowed' | 'eligible' | 'disallowed';
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
}

export interface ChannelBrandingSettings {
  channel: {
    title?: string;
    description?: string;
    keywords?: string;
    trackingAnalyticsAccountId?: string;
    moderateComments?: boolean;
    unsubscribedTrailer?: string;
    defaultLanguage?: string;
    country?: string;
  };
  image?: {
    bannerExternalUrl?: string;
  };
}

export interface Channel {
  kind: 'youtube#channel';
  etag: string;
  id: string;
  snippet?: ChannelSnippet;
  contentDetails?: ChannelContentDetails;
  statistics?: ChannelStatistics;
  status?: ChannelStatus;
  brandingSettings?: ChannelBrandingSettings;
  topicDetails?: {
    topicIds?: string[];
    topicCategories?: string[];
  };
}

export interface ChannelSection {
  kind: 'youtube#channelSection';
  etag: string;
  id: string;
  snippet?: {
    type: string;
    channelId: string;
    title?: string;
    position?: number;
    defaultLanguage?: string;
    localized?: LocalizedText;
  };
  contentDetails?: {
    playlists?: string[];
    channels?: string[];
  };
}

// ============================================
// Video Types
// ============================================

export type VideoPrivacyStatus = 'public' | 'private' | 'unlisted';

export interface VideoSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  thumbnails: ThumbnailDetails;
  channelTitle: string;
  tags?: string[];
  categoryId: string;
  liveBroadcastContent: 'none' | 'upcoming' | 'live';
  defaultLanguage?: string;
  localized?: LocalizedText;
  defaultAudioLanguage?: string;
}

export interface VideoContentDetails {
  duration: string;
  dimension: '2d' | '3d';
  definition: 'hd' | 'sd';
  caption: 'true' | 'false';
  licensedContent: boolean;
  regionRestriction?: {
    allowed?: string[];
    blocked?: string[];
  };
  contentRating?: Record<string, string>;
  projection: 'rectangular' | '360';
  hasCustomThumbnail?: boolean;
}

export interface VideoStatus {
  uploadStatus: 'deleted' | 'failed' | 'processed' | 'rejected' | 'uploaded';
  failureReason?: string;
  rejectionReason?: string;
  privacyStatus: VideoPrivacyStatus;
  publishAt?: DateString;
  license: 'creativeCommon' | 'youtube';
  embeddable: boolean;
  publicStatsViewable: boolean;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
}

export interface VideoStatistics {
  viewCount: string;
  likeCount?: string;
  dislikeCount?: string;
  favoriteCount: string;
  commentCount?: string;
}

export interface VideoPlayer {
  embedHtml?: string;
  embedHeight?: number;
  embedWidth?: number;
}

export interface VideoTopicDetails {
  topicIds?: string[];
  relevantTopicIds?: string[];
  topicCategories?: string[];
}

export interface VideoRecordingDetails {
  recordingDate?: DateString;
}

export interface VideoFileDetails {
  fileName?: string;
  fileSize?: string;
  fileType?: string;
  container?: string;
  videoStreams?: Array<{
    widthPixels?: number;
    heightPixels?: number;
    frameRateFps?: number;
    aspectRatio?: number;
    codec?: string;
    bitrateBps?: string;
    rotation?: string;
    vendor?: string;
  }>;
  audioStreams?: Array<{
    channelCount?: number;
    codec?: string;
    bitrateBps?: string;
    vendor?: string;
  }>;
  durationMs?: string;
  bitrateBps?: string;
  creationTime?: string;
}

export interface VideoProcessingDetails {
  processingStatus?: string;
  processingProgress?: {
    partsTotal?: string;
    partsProcessed?: string;
    timeLeftMs?: string;
  };
  processingFailureReason?: string;
  fileDetailsAvailability?: string;
  processingIssuesAvailability?: string;
  tagSuggestionsAvailability?: string;
  editorSuggestionsAvailability?: string;
  thumbnailsAvailability?: string;
}

export interface VideoSuggestions {
  processingErrors?: string[];
  processingWarnings?: string[];
  processingHints?: string[];
  tagSuggestions?: Array<{
    tag: string;
    categoryRestricts?: string[];
  }>;
  editorSuggestions?: string[];
}

export interface VideoLiveStreamingDetails {
  actualStartTime?: DateString;
  actualEndTime?: DateString;
  scheduledStartTime?: DateString;
  scheduledEndTime?: DateString;
  concurrentViewers?: string;
  activeLiveChatId?: string;
}

export interface Video {
  kind: 'youtube#video';
  etag: string;
  id: string;
  snippet?: VideoSnippet;
  contentDetails?: VideoContentDetails;
  status?: VideoStatus;
  statistics?: VideoStatistics;
  player?: VideoPlayer;
  topicDetails?: VideoTopicDetails;
  recordingDetails?: VideoRecordingDetails;
  fileDetails?: VideoFileDetails;
  processingDetails?: VideoProcessingDetails;
  suggestions?: VideoSuggestions;
  liveStreamingDetails?: VideoLiveStreamingDetails;
}

export interface VideoListParams {
  part: string[];
  chart?: 'mostPopular';
  id?: string | string[];
  myRating?: 'like' | 'dislike';
  hl?: string;
  maxHeight?: number;
  maxResults?: number;
  maxWidth?: number;
  onBehalfOfContentOwner?: string;
  pageToken?: string;
  regionCode?: string;
  videoCategoryId?: string;
}

export interface VideoInsertParams {
  part: string[];
  autoLevels?: boolean;
  notifySubscribers?: boolean;
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
  stabilize?: boolean;
}

export interface VideoUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export interface VideoRating {
  videoId: string;
  rating: 'like' | 'dislike' | 'none';
}

export interface VideoRatingListResponse {
  kind: 'youtube#videoGetRatingResponse';
  etag: string;
  items: VideoRating[];
}

export interface VideoAbuseReportReason {
  kind: 'youtube#videoAbuseReportReason';
  etag: string;
  id: string;
  snippet: {
    label: string;
    secondaryReasons?: Array<{
      id: string;
      label: string;
    }>;
  };
}

// ============================================
// Playlist Types
// ============================================

export interface PlaylistSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  thumbnails: ThumbnailDetails;
  channelTitle: string;
  defaultLanguage?: string;
  localized?: LocalizedText;
}

export interface PlaylistStatus {
  privacyStatus: VideoPrivacyStatus;
}

export interface PlaylistContentDetails {
  itemCount: number;
}

export interface PlaylistPlayer {
  embedHtml?: string;
}

export interface Playlist {
  kind: 'youtube#playlist';
  etag: string;
  id: string;
  snippet?: PlaylistSnippet;
  status?: PlaylistStatus;
  contentDetails?: PlaylistContentDetails;
  player?: PlaylistPlayer;
}

export interface PlaylistListParams {
  part: string[];
  channelId?: string;
  id?: string | string[];
  mine?: boolean;
  hl?: string;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
  pageToken?: string;
}

// ============================================
// Playlist Item Types
// ============================================

export interface PlaylistItemSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  thumbnails: ThumbnailDetails;
  channelTitle: string;
  videoOwnerChannelTitle?: string;
  videoOwnerChannelId?: string;
  playlistId: string;
  position: number;
  resourceId: {
    kind: string;
    videoId?: string;
  };
}

export interface PlaylistItemContentDetails {
  videoId: string;
  startAt?: string;
  endAt?: string;
  note?: string;
  videoPublishedAt?: DateString;
}

export interface PlaylistItemStatus {
  privacyStatus: VideoPrivacyStatus;
}

export interface PlaylistItem {
  kind: 'youtube#playlistItem';
  etag: string;
  id: string;
  snippet?: PlaylistItemSnippet;
  contentDetails?: PlaylistItemContentDetails;
  status?: PlaylistItemStatus;
}

export interface PlaylistItemListParams {
  part: string[];
  id?: string | string[];
  playlistId?: string;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  pageToken?: string;
  videoId?: string;
}

// ============================================
// Search Types
// ============================================

export type SearchResourceType = 'video' | 'channel' | 'playlist';
export type SearchOrder = 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount';
export type SafeSearch = 'moderate' | 'none' | 'strict';
export type VideoCaption = 'any' | 'closedCaption' | 'none';
export type VideoDefinition = 'any' | 'high' | 'standard';
export type VideoDimension = 'any' | '2d' | '3d';
export type VideoDuration = 'any' | 'long' | 'medium' | 'short';
export type VideoEmbeddable = 'any' | 'true';
export type VideoLicense = 'any' | 'creativeCommon' | 'youtube';
export type VideoSyndicated = 'any' | 'true';
export type VideoType = 'any' | 'episode' | 'movie';
export type ChannelType = 'any' | 'show';
export type EventType = 'completed' | 'live' | 'upcoming';

export interface SearchResultSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  thumbnails: ThumbnailDetails;
  channelTitle: string;
  liveBroadcastContent: 'none' | 'upcoming' | 'live';
}

export interface SearchResult {
  kind: 'youtube#searchResult';
  etag: string;
  id: {
    kind: string;
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet?: SearchResultSnippet;
}

export interface SearchParams {
  part: string[];
  channelId?: string;
  channelType?: ChannelType;
  eventType?: EventType;
  forContentOwner?: boolean;
  forDeveloper?: boolean;
  forMine?: boolean;
  location?: string;
  locationRadius?: string;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  order?: SearchOrder;
  pageToken?: string;
  publishedAfter?: DateString;
  publishedBefore?: DateString;
  q?: string;
  regionCode?: string;
  relevanceLanguage?: string;
  safeSearch?: SafeSearch;
  topicId?: string;
  type?: SearchResourceType[];
  videoCaption?: VideoCaption;
  videoCategoryId?: string;
  videoDefinition?: VideoDefinition;
  videoDimension?: VideoDimension;
  videoDuration?: VideoDuration;
  videoEmbeddable?: VideoEmbeddable;
  videoLicense?: VideoLicense;
  videoPaidProductPlacement?: 'any' | 'true';
  videoSyndicated?: VideoSyndicated;
  videoType?: VideoType;
}

// ============================================
// Comment Types
// ============================================

export interface CommentSnippet {
  authorDisplayName: string;
  authorProfileImageUrl: string;
  authorChannelUrl: string;
  authorChannelId?: {
    value: string;
  };
  channelId?: string;
  videoId?: string;
  textDisplay: string;
  textOriginal: string;
  parentId?: string;
  canRate: boolean;
  viewerRating: 'like' | 'none';
  likeCount: number;
  moderationStatus?: 'heldForReview' | 'likelySpam' | 'published' | 'rejected';
  publishedAt: DateString;
  updatedAt: DateString;
}

export interface Comment {
  kind: 'youtube#comment';
  etag: string;
  id: string;
  snippet: CommentSnippet;
}

export interface CommentListParams {
  part: string[];
  id?: string | string[];
  parentId?: string;
  maxResults?: number;
  pageToken?: string;
  textFormat?: 'html' | 'plainText';
}

// ============================================
// Comment Thread Types
// ============================================

export interface CommentThreadSnippet {
  channelId: string;
  videoId?: string;
  topLevelComment: Comment;
  canReply: boolean;
  totalReplyCount: number;
  isPublic: boolean;
}

export interface CommentThreadReplies {
  comments: Comment[];
}

export interface CommentThread {
  kind: 'youtube#commentThread';
  etag: string;
  id: string;
  snippet: CommentThreadSnippet;
  replies?: CommentThreadReplies;
}

export interface CommentThreadListParams {
  part: string[];
  allThreadsRelatedToChannelId?: string;
  channelId?: string;
  id?: string | string[];
  videoId?: string;
  maxResults?: number;
  moderationStatus?: 'heldForReview' | 'likelySpam' | 'published';
  order?: 'relevance' | 'time';
  pageToken?: string;
  searchTerms?: string;
  textFormat?: 'html' | 'plainText';
}

// ============================================
// Subscription Types
// ============================================

export interface SubscriptionSnippet {
  publishedAt: DateString;
  title: string;
  description: string;
  resourceId: {
    kind: string;
    channelId: string;
  };
  channelId: string;
  thumbnails: ThumbnailDetails;
}

export interface SubscriptionContentDetails {
  totalItemCount: number;
  newItemCount: number;
  activityType: 'all' | 'uploads';
}

export interface SubscriberSnippet {
  title: string;
  description: string;
  channelId: string;
  thumbnails: ThumbnailDetails;
}

export interface Subscription {
  kind: 'youtube#subscription';
  etag: string;
  id: string;
  snippet?: SubscriptionSnippet;
  contentDetails?: SubscriptionContentDetails;
  subscriberSnippet?: SubscriberSnippet;
}

export interface SubscriptionListParams {
  part: string[];
  channelId?: string;
  id?: string | string[];
  mine?: boolean;
  myRecentSubscribers?: boolean;
  mySubscribers?: boolean;
  forChannelId?: string;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
  order?: 'alphabetical' | 'relevance' | 'unread';
  pageToken?: string;
}

// ============================================
// Caption Types
// ============================================

export interface CaptionSnippet {
  videoId: string;
  lastUpdated: DateString;
  trackKind: 'ASR' | 'forced' | 'standard';
  language: string;
  name: string;
  audioTrackType: 'commentary' | 'descriptive' | 'primary' | 'unknown';
  isCC: boolean;
  isLarge: boolean;
  isEasyReader: boolean;
  isDraft: boolean;
  isAutoSynced: boolean;
  status: 'failed' | 'serving' | 'syncing';
  failureReason?: 'processingFailed' | 'unknownFormat' | 'unsupportedFormat';
}

export interface Caption {
  kind: 'youtube#caption';
  etag: string;
  id: string;
  snippet: CaptionSnippet;
}

export interface CaptionListParams {
  part: string[];
  videoId: string;
  id?: string | string[];
  onBehalfOf?: string;
  onBehalfOfContentOwner?: string;
}

// ============================================
// Video Category Types
// ============================================

export interface VideoCategorySnippet {
  channelId: string;
  title: string;
  assignable: boolean;
}

export interface VideoCategory {
  kind: 'youtube#videoCategory';
  etag: string;
  id: string;
  snippet: VideoCategorySnippet;
}

export interface VideoCategoryListParams {
  part: string[];
  id?: string | string[];
  regionCode?: string;
  hl?: string;
}

// ============================================
// I18n Types
// ============================================

export interface I18nLanguageSnippet {
  hl: string;
  name: string;
}

export interface I18nLanguage {
  kind: 'youtube#i18nLanguage';
  etag: string;
  id: string;
  snippet: I18nLanguageSnippet;
}

export interface I18nRegionSnippet {
  gl: string;
  name: string;
}

export interface I18nRegion {
  kind: 'youtube#i18nRegion';
  etag: string;
  id: string;
  snippet: I18nRegionSnippet;
}

// ============================================
// Live Broadcast Types
// ============================================

export type LiveBroadcastStatus = 'complete' | 'created' | 'live' | 'liveStarting' | 'ready' | 'revoked' | 'testStarting' | 'testing';
export type LiveBroadcastPrivacy = 'private' | 'public' | 'unlisted';

export interface LiveBroadcastSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  thumbnails: ThumbnailDetails;
  scheduledStartTime: DateString;
  scheduledEndTime?: DateString;
  actualStartTime?: DateString;
  actualEndTime?: DateString;
  isDefaultBroadcast: boolean;
  liveChatId?: string;
}

export interface LiveBroadcastStatusDetails {
  lifeCycleStatus: LiveBroadcastStatus;
  privacyStatus: LiveBroadcastPrivacy;
  recordingStatus: 'notRecording' | 'recorded' | 'recording';
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
}

export interface LiveBroadcastContentDetails {
  boundStreamId?: string;
  boundStreamLastUpdateTimeMs?: string;
  monitorStream?: {
    enableMonitorStream: boolean;
    broadcastStreamDelayMs?: number;
    embedHtml?: string;
  };
  enableEmbed?: boolean;
  enableDvr?: boolean;
  enableContentEncryption?: boolean;
  startWithSlate?: boolean;
  recordFromStart?: boolean;
  enableClosedCaptions?: boolean;
  closedCaptionsType?: 'closedCaptionsDisabled' | 'closedCaptionsHttpPost' | 'closedCaptionsEmbedded';
  projection?: 'rectangular' | '360' | 'mesh';
  enableLowLatency?: boolean;
  latencyPreference?: 'normal' | 'low' | 'ultraLow';
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
}

export interface LiveBroadcast {
  kind: 'youtube#liveBroadcast';
  etag: string;
  id: string;
  snippet?: LiveBroadcastSnippet;
  status?: LiveBroadcastStatusDetails;
  contentDetails?: LiveBroadcastContentDetails;
  statistics?: {
    totalChatCount?: string;
  };
}

export interface LiveBroadcastListParams {
  part: string[];
  broadcastStatus?: 'active' | 'all' | 'completed' | 'upcoming';
  broadcastType?: 'all' | 'event' | 'persistent';
  id?: string | string[];
  mine?: boolean;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
  pageToken?: string;
}

// ============================================
// Live Stream Types
// ============================================

export interface LiveStreamSnippet {
  publishedAt: DateString;
  channelId: string;
  title: string;
  description: string;
  isDefaultStream: boolean;
}

export interface LiveStreamCdn {
  ingestionType: 'rtmp' | 'dash' | 'webrtc' | 'hls';
  ingestionInfo: {
    streamName: string;
    ingestionAddress: string;
    backupIngestionAddress?: string;
    rtmpsIngestionAddress?: string;
    rtmpsBackupIngestionAddress?: string;
  };
  resolution?: string;
  frameRate?: string;
}

export interface LiveStreamStatusDetails {
  streamStatus: 'active' | 'created' | 'error' | 'inactive' | 'ready';
  healthStatus?: {
    status?: 'good' | 'ok' | 'bad' | 'noData';
    lastUpdateTimeSeconds?: string;
    configurationIssues?: Array<{
      type: string;
      severity: string;
      reason: string;
      description: string;
    }>;
  };
}

export interface LiveStreamContentDetails {
  closedCaptionsIngestionUrl?: string;
  isReusable: boolean;
}

export interface LiveStream {
  kind: 'youtube#liveStream';
  etag: string;
  id: string;
  snippet?: LiveStreamSnippet;
  cdn?: LiveStreamCdn;
  status?: LiveStreamStatusDetails;
  contentDetails?: LiveStreamContentDetails;
}

export interface LiveStreamListParams {
  part: string[];
  id?: string | string[];
  mine?: boolean;
  maxResults?: number;
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
  pageToken?: string;
}

// ============================================
// Live Chat Types
// ============================================

export interface LiveChatMessageSnippet {
  type: 'chatEndedEvent' | 'messageDeletedEvent' | 'newSponsorEvent' | 'sponsorOnlyModeEndedEvent' | 'sponsorOnlyModeStartedEvent' | 'superChatEvent' | 'superStickerEvent' | 'textMessageEvent' | 'tombstone' | 'userBannedEvent';
  liveChatId: string;
  authorChannelId: string;
  publishedAt: DateString;
  hasDisplayContent: boolean;
  displayMessage?: string;
  textMessageDetails?: {
    messageText: string;
  };
  superChatDetails?: {
    amountMicros: string;
    currency: string;
    amountDisplayString: string;
    userComment?: string;
    tier: number;
  };
  superStickerDetails?: {
    superStickerMetadata: {
      stickerId: string;
      altText: string;
      language: string;
    };
    amountMicros: string;
    currency: string;
    amountDisplayString: string;
    tier: number;
  };
}

export interface LiveChatMessageAuthorDetails {
  channelId: string;
  channelUrl: string;
  displayName: string;
  profileImageUrl: string;
  isVerified: boolean;
  isChatOwner: boolean;
  isChatSponsor: boolean;
  isChatModerator: boolean;
}

export interface LiveChatMessage {
  kind: 'youtube#liveChatMessage';
  etag: string;
  id: string;
  snippet?: LiveChatMessageSnippet;
  authorDetails?: LiveChatMessageAuthorDetails;
}

export interface LiveChatMessageListParams {
  liveChatId: string;
  part: string[];
  hl?: string;
  maxResults?: number;
  pageToken?: string;
  profileImageSize?: number;
}

export interface LiveChatMessageListResponse extends ListResponse<LiveChatMessage> {
  pollingIntervalMillis: number;
  offlineAt?: DateString;
}

export interface LiveChatBanSnippet {
  liveChatId: string;
  type: 'permanent' | 'temporary';
  banDurationSeconds?: string;
  bannedUserDetails: {
    channelId: string;
    channelUrl: string;
    displayName: string;
    profileImageUrl: string;
  };
}

export interface LiveChatBan {
  kind: 'youtube#liveChatBan';
  etag: string;
  id: string;
  snippet: LiveChatBanSnippet;
}

export interface LiveChatModeratorSnippet {
  liveChatId: string;
  moderatorDetails: {
    channelId: string;
    channelUrl: string;
    displayName: string;
    profileImageUrl: string;
  };
}

export interface LiveChatModerator {
  kind: 'youtube#liveChatModerator';
  etag: string;
  id: string;
  snippet: LiveChatModeratorSnippet;
}

// ============================================
// Watermark Types
// ============================================

export interface WatermarkTiming {
  type: 'offsetFromEnd' | 'offsetFromStart';
  offsetMs: string;
  durationMs?: string;
}

export interface WatermarkPosition {
  type: 'corner';
  cornerPosition: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}

export interface InvideoBranding {
  targetChannelId: string;
  position: WatermarkPosition;
  timing: WatermarkTiming;
  imageUrl?: string;
  imageBytes?: string;
}

// ============================================
// Membership Types
// ============================================

export interface MemberSnippet {
  creatorChannelId: string;
  memberDetails: {
    channelId: string;
    channelUrl: string;
    displayName: string;
    profileImageUrl: string;
  };
  membershipsDetails: {
    highestAccessibleLevel: string;
    highestAccessibleLevelDisplayName: string;
    membershipsDuration?: {
      memberSince: DateString;
      memberTotalDurationMonths: number;
    };
    accessibleLevels: string[];
  };
}

export interface Member {
  kind: 'youtube#member';
  etag: string;
  snippet: MemberSnippet;
}

export interface MemberListParams {
  part: string[];
  mode?: 'all_current' | 'updates';
  maxResults?: number;
  pageToken?: string;
  hasAccessToLevel?: string;
  filterByMemberChannelId?: string;
}

export interface MembershipsLevelSnippet {
  creatorChannelId: string;
  levelDetails: {
    displayName: string;
  };
}

export interface MembershipsLevel {
  kind: 'youtube#membershipsLevel';
  etag: string;
  id: string;
  snippet: MembershipsLevelSnippet;
}

export interface MembershipsLevelListParams {
  part: string[];
}

// ============================================
// Analytics Types
// ============================================

export interface AnalyticsReportParams {
  ids: string;
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  maxResults?: number;
  sort?: string;
  startIndex?: number;
  currency?: string;
  includeHistoricalChannelData?: boolean;
}

export interface AnalyticsReportColumnHeader {
  name: string;
  columnType: 'DIMENSION' | 'METRIC';
  dataType: string;
}

export interface AnalyticsReport {
  kind: 'youtubeAnalytics#resultTable';
  columnHeaders: AnalyticsReportColumnHeader[];
  rows?: (string | number)[][];
}

export interface AnalyticsGroupSnippet {
  publishedAt: DateString;
  title: string;
}

export interface AnalyticsGroupContentDetails {
  itemCount: string;
  itemType: string;
}

export interface AnalyticsGroup {
  kind: 'youtube#group';
  etag: string;
  id: string;
  snippet: AnalyticsGroupSnippet;
  contentDetails: AnalyticsGroupContentDetails;
}

export interface AnalyticsGroupItem {
  kind: 'youtube#groupItem';
  etag: string;
  id: string;
  groupId: string;
  resource: {
    kind: string;
    id: string;
  };
}

export interface AnalyticsGroupListParams {
  id?: string;
  mine?: boolean;
  onBehalfOfContentOwner?: string;
  pageToken?: string;
}

export interface AnalyticsGroupItemListParams {
  groupId: string;
  onBehalfOfContentOwner?: string;
}

// ============================================
// API Error Types
// ============================================

export interface YouTubeApiErrorDetail {
  domain: string;
  reason: string;
  message: string;
  locationType?: string;
  location?: string;
}

export interface YouTubeApiErrorResponse {
  error: {
    code: number;
    message: string;
    errors: YouTubeApiErrorDetail[];
  };
}

export class YouTubeApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: YouTubeApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: YouTubeApiErrorDetail[]) {
    super(message);
    this.name = 'YouTubeApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Upload Types
// ============================================

export interface ResumableUploadInitResponse {
  uploadUrl: string;
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}
