/**
 * open-conversations integration — prevent duplicate scraping across agents.
 * Announces navigation, checks if another agent is already working on a URL.
 */

const SPACE_NAME = "browser";
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Conversations SDK wrapper ────────────────────────────────────────────────

async function getConversationsSDK() {
  try {
    const mod = await import("@hasna/conversations");
    return mod;
  } catch {
    return null;
  }
}

// In-memory fallback registry
const activeNavigations = new Map<string, { agentName: string; timestamp: number }>();

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DuplicateCheck {
  is_duplicate: boolean;
  by_agent?: string;
  started_at?: string;
}

export async function announceNavigation(
  url: string,
  sessionId: string,
  agentName = "browser-agent"
): Promise<void> {
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  // Try conversations SDK
  const sdk = await getConversationsSDK();
  if (sdk?.sendMessage) {
    try {
      await (sdk.sendMessage as any)(SPACE_NAME, `🌐 Navigating to ${hostname} (session: ${sessionId.slice(0, 8)})`);
    } catch {}
  }

  // Always update in-memory registry
  activeNavigations.set(hostname, { agentName, timestamp: Date.now() });
}

export async function checkDuplicate(url: string): Promise<DuplicateCheck> {
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;

  // Check in-memory
  const entry = activeNavigations.get(hostname);
  if (entry && entry.timestamp > cutoff) {
    return {
      is_duplicate: true,
      by_agent: entry.agentName,
      started_at: new Date(entry.timestamp).toISOString(),
    };
  }

  // Try conversations SDK to check recent messages
  const sdk = await getConversationsSDK();
  if (sdk?.readMessages) {
    try {
      const messages = await (sdk.readMessages as any)(SPACE_NAME, { limit: 20 });
      const recent = ((messages as any)?.messages ?? messages ?? []).filter((m: any) =>
        m.content?.includes(hostname) &&
        new Date(m.created_at).getTime() > cutoff
      );
      if (recent.length > 0) {
        return {
          is_duplicate: true,
          by_agent: recent[0].sender_name ?? "unknown",
          started_at: recent[0].created_at,
        };
      }
    } catch {}
  }

  return { is_duplicate: false };
}
