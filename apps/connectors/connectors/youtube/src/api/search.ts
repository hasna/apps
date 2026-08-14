import type { YouTubeClient } from './client';
import type {
  SearchResult,
  SearchParams,
  ListResponse,
} from '../types';

export class SearchApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * Search for videos, channels, and playlists
   * Quota cost: 100 units per request
   */
  async search(params: SearchParams): Promise<ListResponse<SearchResult>> {
    return this.client.get<ListResponse<SearchResult>>('/search', {
      part: params.part,
      channelId: params.channelId,
      channelType: params.channelType,
      eventType: params.eventType,
      forContentOwner: params.forContentOwner,
      forDeveloper: params.forDeveloper,
      forMine: params.forMine,
      location: params.location,
      locationRadius: params.locationRadius,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      order: params.order,
      pageToken: params.pageToken,
      publishedAfter: params.publishedAfter,
      publishedBefore: params.publishedBefore,
      q: params.q,
      regionCode: params.regionCode,
      relevanceLanguage: params.relevanceLanguage,
      safeSearch: params.safeSearch,
      topicId: params.topicId,
      type: params.type,
      videoCaption: params.videoCaption,
      videoCategoryId: params.videoCategoryId,
      videoDefinition: params.videoDefinition,
      videoDimension: params.videoDimension,
      videoDuration: params.videoDuration,
      videoEmbeddable: params.videoEmbeddable,
      videoLicense: params.videoLicense,
      videoPaidProductPlacement: params.videoPaidProductPlacement,
      videoSyndicated: params.videoSyndicated,
      videoType: params.videoType,
    });
  }

  /**
   * Search for videos only
   */
  async videos(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for channels only
   */
  async channels(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['channel'],
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for playlists only
   */
  async playlists(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['playlist'],
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for live broadcasts
   */
  async live(
    query?: string,
    options: Partial<Omit<SearchParams, 'part' | 'type' | 'eventType'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      eventType: 'live',
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for upcoming live broadcasts
   */
  async upcoming(
    query?: string,
    options: Partial<Omit<SearchParams, 'part' | 'type' | 'eventType'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      eventType: 'upcoming',
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search within a channel's videos
   */
  async inChannel(
    channelId: string,
    query?: string,
    options: Partial<Omit<SearchParams, 'part' | 'channelId'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      channelId,
      q: query,
      type: options.type || ['video'],
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for HD videos
   */
  async hdVideos(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type' | 'videoDefinition'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoDefinition: 'high',
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for videos with captions
   */
  async captionedVideos(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type' | 'videoCaption'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoCaption: 'closedCaption',
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search for Creative Commons licensed videos
   */
  async creativeCommons(
    query: string,
    options: Partial<Omit<SearchParams, 'part' | 'q' | 'type' | 'videoLicense'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoLicense: 'creativeCommon',
      maxResults: options.maxResults || 25,
      ...options,
    });
  }

  /**
   * Search by location
   */
  async byLocation(
    latitude: number,
    longitude: number,
    radius: string,
    query?: string,
    options: Partial<Omit<SearchParams, 'part' | 'location' | 'locationRadius'>> = {}
  ): Promise<ListResponse<SearchResult>> {
    return this.search({
      part: ['snippet'],
      q: query,
      type: ['video'],
      location: `${latitude},${longitude}`,
      locationRadius: radius,
      maxResults: options.maxResults || 25,
      ...options,
    });
  }
}
