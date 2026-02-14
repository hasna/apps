import { useState, useEffect, useRef } from "react";
import { readMessages } from "./messages.js";
import type { Message } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  interval_ms?: number;
  on_messages: (messages: Message[]) => void;
}

/**
 * Start polling for new messages. Returns a stop function.
 */
export function startPolling(opts: PollOptions): { stop: () => void } {
  const interval = opts.interval_ms ?? 200;
  let lastSeen = new Date().toISOString();
  let stopped = false;

  const poll = () => {
    if (stopped) return;

    const messages = readMessages({
      session_id: opts.session_id,
      to: opts.to_agent,
      since: lastSeen,
    });

    if (messages.length > 0) {
      lastSeen = messages[messages.length - 1].created_at;
      opts.on_messages(messages);
    }
  };

  const timer = setInterval(poll, interval);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * React hook for polling messages in a session.
 */
export function useMessages(sessionId: string, agent?: string): Message[] {
  const [messages, setMessages] = useState<Message[]>([]);
  const initialLoad = useRef(false);

  useEffect(() => {
    // Load existing messages on mount
    if (!initialLoad.current) {
      const existing = readMessages({ session_id: sessionId });
      setMessages(existing);
      initialLoad.current = true;
    }

    const { stop } = startPolling({
      session_id: sessionId,
      interval_ms: 200,
      on_messages: (newMessages) => {
        setMessages((prev) => [...prev, ...newMessages]);
      },
    });

    return stop;
  }, [sessionId, agent]);

  return messages;
}
