import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { readMessages, sendMessage, markSessionRead, markChannelRead } from "../../lib/messages.js";
import { startPolling } from "../../lib/poll.js";
import { MessageBubble } from "./MessageBubble.js";
import type { Message } from "../../types.js";

interface ChatViewProps {
  agent: string;
  onBack: () => void;
  // DM mode
  sessionId?: string;
  recipient?: string;
  // Channel mode
  channelName?: string;
}

export function ChatView({ agent, onBack, sessionId: initialSessionId, recipient, channelName }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const isChannel = !!channelName;
  const seenIds = useRef<Set<number>>(new Set());

  // Load existing messages + poll for new ones
  useEffect(() => {
    seenIds.current = new Set();
    const opts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : {};

    // Only load if we have something to query
    if (isChannel || sessionId) {
      const existing = readMessages(opts);
      for (const msg of existing) {
        seenIds.current.add(msg.id);
      }
      setMessages(existing);
    } else {
      setMessages([]);
    }

    const pollOpts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : null;

    if (!pollOpts) return;

    const { stop } = startPolling({
      ...pollOpts,
      interval_ms: 200,
      on_messages: (newMsgs) => {
        const unseen = newMsgs.filter((msg) => !seenIds.current.has(msg.id));
        if (unseen.length === 0) return;
        for (const msg of unseen) {
          seenIds.current.add(msg.id);
        }
        setMessages((prev) => [...prev, ...unseen]);
      },
    });

    return stop;
  }, [sessionId, channelName]);

  // Mark as read
  useEffect(() => {
    if (messages.length === 0) return;
    if (isChannel && channelName) {
      markChannelRead(channelName, agent);
    } else if (sessionId) {
      markSessionRead(sessionId, agent);
    }
  }, [messages.length, isChannel, channelName, sessionId, agent]);

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;

    if (isChannel && channelName) {
      const msg = sendMessage({
        from: agent,
        to: channelName,
        content: value.trim(),
        channel: channelName,
        session_id: `channel:${channelName}`,
      });
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
    } else {
      const to = recipient || agent;
      const msg = sendMessage({
        from: agent,
        to,
        content: value.trim(),
        session_id: sessionId,
      });
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      // For new conversations, capture the real session ID from the first message
      if (!sessionId) {
        setSessionId(msg.session_id);
      }
    }

    setInput("");
  };

  const title = isChannel
    ? `#${channelName}`
    : recipient || "self";

  const prompt = isChannel
    ? `${agent} → #${channelName}`
    : `${agent} → ${recipient || "self"}`;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={isChannel ? "magenta" : "cyan"}>{title}</Text>
        <Text dimColor>  (Esc: back)</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 ? (
          <Text dimColor>No messages yet. Type below and press Enter.</Text>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.from_agent === agent}
            />
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={isChannel ? "magenta" : "cyan"}>{prompt}: </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type a message..."
        />
      </Box>
    </Box>
  );
}
