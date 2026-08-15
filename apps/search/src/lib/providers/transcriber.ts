import { getConfig } from "../config.js";

interface TranscriptResult {
  id: string;
  title: string;
  sourceUrl: string;
  status: string;
  transcriptText?: string;
  duration?: number;
  wordCount?: number;
  provider?: string;
}

interface TranscriptSearchResult {
  id: string;
  title: string;
  sourceUrl: string;
  snippet: string;
  score?: number;
}

export async function isTranscriberAvailable(): Promise<boolean> {
  const config = getConfig();
  try {
    const res = await fetch(`${config.transcriber.baseUrl}/api/transcripts/stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    // Try CLI fallback
    try {
      const proc = Bun.spawn([config.transcriber.fallbackCli, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
}

export async function transcribeVideo(
  url: string,
  opts: { provider?: string; language?: string; diarize?: boolean } = {},
): Promise<TranscriptResult> {
  const config = getConfig();

  // Try REST API first
  try {
    const body: Record<string, unknown> = { source: url };
    if (opts.provider) body.provider = opts.provider;
    if (opts.language) body.language = opts.language;
    if (opts.diarize) body.diarize = opts.diarize;

    // Use the CLI to transcribe (REST API is GET-based for transcripts)
    const proc = Bun.spawn(
      [
        config.transcriber.fallbackCli,
        "transcribe",
        url,
        ...(opts.provider ? ["--provider", opts.provider] : []),
        ...(opts.language ? ["--language", opts.language] : []),
        ...(opts.diarize ? ["--diarize"] : []),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      const errOutput = await new Response(proc.stderr).text();
      throw new Error(`Transcriber CLI failed: ${errOutput}`);
    }

    // Parse the output to get transcript ID
    const idMatch = output.match(/(?:id|ID):\s*(\S+)/);
    const id = idMatch?.[1] ?? "unknown";

    return {
      id,
      title: url,
      sourceUrl: url,
      status: "completed",
      transcriptText: output,
    };
  } catch (cliError) {
    // Try REST API as fallback
    try {
      const res = await fetch(`${config.transcriber.baseUrl}/api/transcripts`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Transcriber API error: ${res.status}`);
      const data = (await res.json()) as TranscriptResult[];
      // Return the most recent one matching the URL
      const match = data.find((t) => t.sourceUrl === url);
      if (match) return match;
      throw cliError;
    } catch {
      throw cliError;
    }
  }
}

export async function getTranscript(id: string): Promise<TranscriptResult | null> {
  const config = getConfig();
  try {
    const res = await fetch(`${config.transcriber.baseUrl}/api/transcripts/${id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as TranscriptResult;
  } catch {
    return null;
  }
}

export async function searchTranscripts(query: string): Promise<TranscriptSearchResult[]> {
  const config = getConfig();
  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`${config.transcriber.baseUrl}/api/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return (await res.json()) as TranscriptSearchResult[];
  } catch {
    return [];
  }
}
