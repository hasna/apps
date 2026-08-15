import type { SupadataClient } from './client';
import { pollUntilComplete } from './client';
import type {
  YoutubeChannelOptions,
  YoutubeChannel,
  YoutubeChannelVideosOptions,
  YoutubeChannelVideos,
  YoutubePlaylistOptions,
  YoutubePlaylist,
  YoutubePlaylistVideosOptions,
  YoutubePlaylistVideos,
  YoutubeVideoOptions,
  YoutubeVideo,
  YoutubeSearchOptions,
  YoutubeSearchResult,
  YoutubeTranscriptOptions,
  TranscriptResult,
  YoutubeTranslateOptions,
  YoutubeTranscriptBatchOptions,
  YoutubeVideoBatchOptions,
  JobIdResponse,
  YoutubeBatchJobResult,
  PollOptions,
} from '../types';

export class YoutubeApi {
  constructor(private readonly client: SupadataClient) {}

  async channel(options: YoutubeChannelOptions): Promise<YoutubeChannel> {
    return this.client.get<YoutubeChannel>('/youtube/channel', { id: options.id });
  }

  async channelVideos(options: YoutubeChannelVideosOptions): Promise<YoutubeChannelVideos> {
    return this.client.get<YoutubeChannelVideos>('/youtube/channel/videos', {
      id: options.id,
      limit: options.limit,
      type: options.type,
    });
  }

  async playlist(options: YoutubePlaylistOptions): Promise<YoutubePlaylist> {
    return this.client.get<YoutubePlaylist>('/youtube/playlist', { id: options.id });
  }

  async playlistVideos(options: YoutubePlaylistVideosOptions): Promise<YoutubePlaylistVideos> {
    return this.client.get<YoutubePlaylistVideos>('/youtube/playlist/videos', {
      id: options.id,
      limit: options.limit,
    });
  }

  async video(options: YoutubeVideoOptions): Promise<YoutubeVideo> {
    return this.client.get<YoutubeVideo>('/youtube/video', {
      id: options.id,
      url: options.url,
    });
  }

  async search(options: YoutubeSearchOptions): Promise<YoutubeSearchResult> {
    return this.client.get<YoutubeSearchResult>('/youtube/search', {
      query: options.query,
      limit: options.limit,
      type: options.type,
    });
  }

  async transcript(options: YoutubeTranscriptOptions): Promise<TranscriptResult> {
    return this.client.get<TranscriptResult>('/youtube/transcript', {
      url: options.url,
      videoId: options.videoId,
      lang: options.lang,
      text: options.text,
      chunkSize: options.chunkSize,
    });
  }

  async translateTranscript(options: YoutubeTranslateOptions): Promise<TranscriptResult> {
    return this.client.get<TranscriptResult>('/youtube/transcript/translate', {
      url: options.url,
      videoId: options.videoId,
      lang: options.lang,
      text: options.text,
      chunkSize: options.chunkSize,
    });
  }

  async transcriptBatch(options: YoutubeTranscriptBatchOptions): Promise<JobIdResponse> {
    return this.client.post<JobIdResponse>('/youtube/transcript/batch', {
      videoIds: options.videoIds,
      playlistId: options.playlistId,
      channelId: options.channelId,
      limit: options.limit,
      lang: options.lang,
      text: options.text,
    });
  }

  async videoBatch(options: YoutubeVideoBatchOptions): Promise<JobIdResponse> {
    return this.client.post<JobIdResponse>('/youtube/video/batch', {
      videoIds: options.videoIds,
      playlistId: options.playlistId,
      channelId: options.channelId,
      limit: options.limit,
    });
  }

  async getBatchJob(jobId: string): Promise<YoutubeBatchJobResult> {
    return this.client.get<YoutubeBatchJobResult>(`/youtube/batch/${encodeURIComponent(jobId)}`);
  }

  async transcriptBatchAndWait(
    options: YoutubeTranscriptBatchOptions,
    pollOptions?: PollOptions,
  ): Promise<YoutubeBatchJobResult> {
    const { jobId } = await this.transcriptBatch(options);
    return pollUntilComplete(() => this.getBatchJob(jobId), pollOptions);
  }

  async videoBatchAndWait(
    options: YoutubeVideoBatchOptions,
    pollOptions?: PollOptions,
  ): Promise<YoutubeBatchJobResult> {
    const { jobId } = await this.videoBatch(options);
    return pollUntilComplete(() => this.getBatchJob(jobId), pollOptions);
  }
}
