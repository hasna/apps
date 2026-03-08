import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { readMessages, sendMessage, markSessionRead, markSpaceRead } from "../../lib/messages.js";
import { startPolling } from "../../lib/poll.js";
import { MessageBubble } from "./MessageBubble.js";
import type { Message } from "../../types.js";

interface ChatViewProps {
  agent: string;
  onBack: () => void;
  // DM mode
  sessionId?: string;
  recipient?: string;
  // Space mode
  spaceName?: string;
}

export function ChatView({ agent, onBack, sessionId: initialSessionId, recipient, spaceName }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const isSpace = !!spaceName;
  const seenIds = useRef<Set<number>>(new Set());

  // Load existing messages + poll for new ones
  useEffect(() => {
    seenIds.current = new Set();
    const opts = isSpace
      ? { space: spaceName }
      : sessionId
        ? { session_id: sessionId }
        : {};

    // Only load if we have something to query
    if (isSpace || sessionId) {
      const existing = readMessages(opts);
      for (const msg of existing) {
        seenIds.current.add(msg.id);
      }
      setMessages(existing);
    } else {
      setMessages([]);
    }

    const pollOpts = isSpace
      ? { space: spaceName }
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
  }, [sessionId, spaceName]);

  // Mark as read
  useEffect(() => {
    if (messages.length === 0) return;
    if (isSpace && spaceName) {
      markSpaceRead(spaceName, agent);
    } else if (sessionId) {
      markSessionRead(sessionId, agent);
    }
  }, [messages.length, isSpace, spaceName, sessionId, agent]);

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;

    if (isSpace && spaceName) {
      const msg = sendMessage({
        from: agent,
        to: spaceName,
        content: value.trim(),
        space: spaceName,
        session_id: `space:${spaceName}`,
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

  const title = isSpace
    ? `#${spaceName}`
    : recipient || "self";

  const prompt = isSpace
    ? `${agent} → #${spaceName}`
    : `${agent} → ${recipient || "self"}`;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={isSpace ? "magenta" : "cyan"}>{title}</Text>
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
        <Text color={isSpace ? "magenta" : "cyan"}>{prompt}: </Text>
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
