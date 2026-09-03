import { readMessages } from "./messages.js";
import { listSessions } from "./sessions.js";

// Define inline to avoid a hard dependency on the (now internal) brains package
type GatherTrainingDataFn = (options?: { limit?: number; since?: Date }) => Promise<{
  source: string;
  examples: Array<{ messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }>;
  count: number;
}>;

const SYSTEM_PROMPT =
  "You are a collaborative AI agent participating in multi-agent conversations.";

interface TrainingExample {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

function windowToExample(
  window: Array<{ from_agent: string; to_agent: string | null; channel: string | null; content: string }>
): TrainingExample | null {
  if (window.length < 2) return null;

  const messages: TrainingExample["messages"] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  for (let i = 0; i < window.length - 1; i++) {
    const msg = window[i];
    if (!msg) continue;
    const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
    messages.push({
      role,
      content: `[${msg.from_agent} → ${msg.to_agent ?? msg.channel ?? "all"}]: ${msg.content}`,
    });
  }

  const last = window[window.length - 1];
  if (!last) return null;
  messages.push({
    role: "assistant",
    content: `[${last.from_agent} → ${last.to_agent ?? last.channel ?? "all"}]: ${last.content}`,
  });

  return { messages };
}

export const gatherTrainingData: GatherTrainingDataFn = async (options = {}) => {
  const { limit, since } = options;

  // Load all sessions
  const sessions = listSessions();
  const examples: TrainingExample[] = [];
  const windowSize = 4;

  for (const session of sessions) {
    // Fetch messages for this session
    const msgs = readMessages({
      session_id: session.session_id,
      since: since?.toISOString(),
      limit: 10000,
      order: "asc",
    });

    if (msgs.length < 2) continue;

    // Sliding window across session messages
    for (let start = 0; start <= msgs.length - 2; start++) {
      const end = Math.min(start + windowSize, msgs.length);
      const windowMsgs = msgs.slice(start, end);
      const example = windowToExample(windowMsgs);
      if (example) examples.push(example);
    }
  }

  const finalExamples = limit ? examples.slice(0, limit) : examples;

  return {
    source: "conversations",
    examples: finalExamples,
    count: finalExamples.length,
  };
};
