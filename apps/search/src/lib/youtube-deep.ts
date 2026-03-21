import type { SearchOptions, SearchResult, SearchProviderName } from "../types/index.js";
import { getProvider } from "./providers/index.js";
import { transcribeVideo, searchTranscripts, isTranscriberAvailable } from "./providers/transcriber.js";

interface DeepSearchResult {
  videoResults: SearchResult[];
  transcriptMatches: Array<{
    videoUrl: string;
    videoTitle: string;
    snippet: string;
    score?: number;
  }>;
  transcriptionErrors: Array<{ url: string; error: string }>;
}

export async function youtubeDeepSearch(
  query: string,
  opts: {
    limit?: number;
    transcribeTop?: number;
    searchOptions?: SearchOptions;
  } = {},
): Promise<DeepSearchResult> {
  const transcribeTop = opts.transcribeTop ?? 3;

  // Step 1: Search YouTube
  const youtubeProvider = getProvider("youtube" as SearchProviderName);
  const rawResults = await youtubeProvider.search(query, {
    limit: opts.limit ?? 10,
    ...opts.searchOptions,
  });

  const videoResults: SearchResult[] = rawResults.map((r, i) => ({
    id: `yt-${i}`,
    searchId: "",
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: "youtube" as SearchProviderName,
    provider: "YouTube",
    rank: i + 1,
    score: r.score ?? null,
    publishedAt: r.publishedAt ?? null,
    thumbnail: r.thumbnail ?? null,
    metadata: r.metadata ?? {},
    createdAt: new Date().toISOString(),
  }));

  // Step 2: Check if transcriber is available
  const available = await isTranscriberAvailable();
  if (!available) {
    return { videoResults, transcriptMatches: [], transcriptionErrors: [] };
  }

  // Step 3: Transcribe top N videos
  const toTranscribe = videoResults.slice(0, transcribeTop);
  const transcriptionErrors: Array<{ url: string; error: string }> = [];

  for (const video of toTranscribe) {
    try {
      await transcribeVideo(video.url);
    } catch (err) {
      transcriptionErrors.push({
        url: video.url,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // Step 4: Search within transcripts
  const transcriptResults = await searchTranscripts(query);

  const transcriptMatches = transcriptResults.map((tr) => ({
    videoUrl: tr.sourceUrl,
    videoTitle: tr.title,
    snippet: tr.snippet,
    score: tr.score,
  }));

  return { videoResults, transcriptMatches, transcriptionErrors };
}
