import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { getStore } from "../../lib/store/index.js";
import { startPolling } from "../../lib/poll.js";
import { MessageBubble } from "./MessageBubble.js";
import type { Message, MessagePreview } from "../../types.js";

interface ChatViewProps {
  agent: string;
  onBack: () => void;
  sessionId?: string;
  recipient?: string;
  channelName?: string;
}

export function ChatView({ agent, onBack, sessionId: initialSessionId, recipient, channelName }: ChatViewProps) {
  const store = useMemo(() => getStore(), []);
  const [messages, setMessages] = useState<MessagePreview[]>([]);
  const [detail, setDetail] = useState<Message | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(true);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const isChannel = !!channelName;
  const seenIds = useRef<Set<number>>(new Set());

  // Broad history is always a bounded preview page. No read state changes here.
  useEffect(() => {
    let cancelled = false;
    seenIds.current = new Set();
    setDetail(null);
    const opts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : null;

    if (!opts) {
      setMessages([]);
      return;
    }

    void store.readMessagePreviews({ ...opts, order: "asc", limit: 100 })
      .then((page) => {
        if (cancelled) return;
        for (const message of page.messages) seenIds.current.add(message.id);
        setMessages(page.messages);
        setSelectedIndex(Math.max(0, page.messages.length - 1));
      });

    const { stop } = startPolling({
      ...opts,
      interval_ms: 200,
      on_messages: (newPreviews) => {
        if (cancelled) return;
        const unseen = newPreviews.filter((message) => !seenIds.current.has(message.id));
        if (unseen.length === 0) return;
        for (const message of unseen) seenIds.current.add(message.id);
        setMessages((previous) => [...previous, ...unseen]);
        setSelectedIndex((previous) => previous + unseen.length);
      },
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [store, sessionId, channelName, isChannel]);

  const selected = messages[selectedIndex] ?? null;

  // Full content and acknowledgement are explicit, exact-id actions only.
  useInput((keyInput, key) => {
    if (key.escape) {
      if (detail) setDetail(null);
      else onBack();
      return;
    }
    if (key.tab && !detail) {
      setInputFocused((focused) => !focused);
      return;
    }
    if (inputFocused || detail) return;
    if (key.upArrow) setSelectedIndex((index) => Math.max(0, index - 1));
    if (key.downArrow) setSelectedIndex((index) => Math.min(Math.max(0, messages.length - 1), index + 1));
    if (keyInput === "v" && selected) {
      void store.getMessageById(selected.id).then((message) => {
        if (message) setDetail(message);
      });
    }
    if (keyInput === "m" && selected) {
      void store.markReadByIds([selected.id], agent).then(() => {
        setMessages((current) => current.map((message) => (
          message.id === selected.id ? { ...message, unread: false } : message
        )));
      });
    }
  });

  const handleSubmit = (value: string) => {
    const content = value.trim();
    if (!content) return;

    void (async () => {
      const sent = await store.sendMessage(isChannel && channelName
        ? {
            from: agent,
            to: channelName,
            content,
            channel: channelName,
            session_id: `channel:${channelName}`,
          }
        : {
            from: agent,
            to: recipient || agent,
            content,
            session_id: sessionId,
          });
      const page = await store.readMessagePreviews({ id: sent.id, limit: 1 });
      const preview = page.messages[0];
      if (preview && !seenIds.current.has(preview.id)) {
        seenIds.current.add(preview.id);
        setMessages((previous) => [...previous, preview]);
        setSelectedIndex((index) => index + 1);
      }
      if (!sessionId) setSessionId(sent.session_id);
    })();
    setInput("");
  };

  const title = isChannel ? `#${channelName}` : recipient || "self";
  const prompt = isChannel ? `${agent} → #${channelName}` : `${agent} → ${recipient || "self"}`;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={isChannel ? "magenta" : "cyan"}>{title}</Text>
        <Text dimColor>  (Tab: type/browse, ↑/↓: select, v: exact detail, m: mark selected, Esc: back)</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {detail ? (
          <Box flexDirection="column">
            <Text bold>Exact message #{detail.id}</Text>
            <Text>{detail.content}</Text>
            <Text dimColor>Esc returns to preview history.</Text>
          </Box>
        ) : messages.length === 0 ? (
          <Text dimColor>No messages yet. Type below and press Enter.</Text>
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.from_agent === agent}
              selected={index === selectedIndex}
            />
          ))
        )}
      </Box>

      {!detail && (
        <Box marginTop={1}>
          <Text color={isChannel ? "magenta" : "cyan"}>{prompt}: </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            focus={inputFocused}
            placeholder="Type a message..."
          />
        </Box>
      )}
    </Box>
  );
}
