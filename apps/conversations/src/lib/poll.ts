import { useState, useEffect } from "react";
import { readMessages } from "./messages.js";
import type { Message } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  channel?: string;
  interval_ms?: number;
  on_messages: (messages: Message[]) => void;
}

/**
 * Start polling for new messages. Returns a stop function.
 */
export function startPolling(opts: PollOptions): { stop: () => void } {
  const interval = opts.interval_ms ?? 200;
  let stopped = false;
  let inFlight = false;
  let lastSeenId = 0;

  const seedLastSeen = () => {
    const latest = readMessages({
      session_id: opts.session_id,
      to: opts.to_agent,
      channel: opts.channel,
      order: "desc",
      limit: 1,
    });
    if (latest.length > 0) {
      lastSeenId = latest[0].id;
    }
  };

  const poll = () => {
    if (stopped || inFlight) return;
    inFlight = true;

    try {
      const messages = readMessages({
        session_id: opts.session_id,
        to: opts.to_agent,
        channel: opts.channel,
        since_id: lastSeenId,
        order: "asc",
      });

      if (messages.length > 0) {
        lastSeenId = messages[messages.length - 1].id;
        try {
          opts.on_messages(messages);
        } catch (error) {
          console.error("Polling callback error:", error);
        }
      }
    } finally {
      inFlight = false;
    }
  };

  seedLastSeen();
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

  useEffect(() => {
    const existing = readMessages({ session_id: sessionId });
    setMessages(existing);

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

/**
 * React hook for polling messages in a channel.
 */
export function useChannelMessages(channelName: string): Message[] {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const existing = readMessages({ channel: channelName });
    setMessages(existing);

    const { stop } = startPolling({
      channel: channelName,
      interval_ms: 200,
      on_messages: (newMessages) => {
        setMessages((prev) => [...prev, ...newMessages]);
      },
    });

    return stop;
  }, [channelName]);

  return messages;
}
