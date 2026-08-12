import React, { useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { sendMessage } from "../../lib/messages.js";
import { previewAsCompatibilityMessage } from "../../lib/message-previews.js";
import { getStore } from "../../lib/store/index.js";
import { SensitiveContentError } from "../../lib/content-safety.js";
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

interface ChatViewSubmitOptions {
  agent: string;
  sessionId?: string;
  recipient?: string;
  channelName?: string;
}

export type ChatViewSubmitResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

function chatViewSendError(error: unknown): string {
  if (error instanceof SensitiveContentError) {
    return "Message blocked by sensitive-content controls.";
  }
  return "Unable to send message.";
}

export function submitChatViewMessage(
  { agent, sessionId, recipient, channelName }: ChatViewSubmitOptions,
  value: string
): ChatViewSubmitResult {
  const content = value.trim();
  if (!content) return { ok: false, error: "" };

  try {
    if (channelName) {
      return {
        ok: true,
        message: sendMessage({
          from: agent,
          to: channelName,
          content,
          channel: channelName,
          session_id: `channel:${channelName}`,
        }),
      };
    }

    return {
      ok: true,
      message: sendMessage({
        from: agent,
        to: recipient || agent,
        content,
        session_id: sessionId,
      }),
    };
  } catch (error) {
    return { ok: false, error: chatViewSendError(error) };
  }
}

export function ChatView({ agent, onBack, sessionId: initialSessionId, recipient, channelName }: ChatViewProps) {
  const store = useMemo(() => getStore(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [detail, setDetail] = useState<Message | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const isChannel = !!channelName;
  const seenIds = useRef<Set<number>>(new Set());

  // Load existing messages + poll for new ones
  useEffect(() => {
    let cancelled = false;
    seenIds.current = new Set();
    const opts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : {};

    // Only load if we have something to query
    if (isChannel || sessionId) {
      void store.readMessagePreviews(opts).then((page) => {
        if (cancelled) return;
        const existing = page.messages.map(previewAsCompatibilityMessage);
        for (const msg of existing) seenIds.current.add(msg.id);
        setMessages(existing);
      });
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

    // `stop()` now resolves once the loop is quiescent, but a React effect
    // destructor must return void — not a promise — so the wait is discarded
    // here deliberately. Unmounting does not need to block on a final read.
    return () => {
      cancelled = true;
      void stop();
    };
  }, [store, sessionId, channelName, isChannel]);

  useInput((keyInput, key) => {
    if (key.escape) {
      if (detail) setDetail(null);
      else onBack();
      return;
    }
    const selected = messages[messages.length - 1];
    if (!selected || input.length > 0) return;
    if (keyInput === "v") {
      void store.getMessageById(selected.id).then(setDetail);
    }
    if (keyInput === "m") {
      void store.markReadByIds([selected.id], agent).then(() => {
        setMessages((current) => current.map((message) => (
          message.id === selected.id ? { ...message, read_at: new Date().toISOString() } : message
        )));
      });
    }
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;

    const result = submitChatViewMessage({ agent, sessionId, recipient, channelName }, value);
    if (!result.ok) {
      setSendError(result.error || "Unable to send message.");
      setInput("");
      return;
    }

    const msg = result.message;
    seenIds.current.add(msg.id);
    setMessages((prev) => [...prev, msg]);
    setSendError(null);
    // For new conversations, capture the real session ID from the first message
    if (!isChannel && !sessionId) {
      setSessionId(msg.session_id);
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
        <Text dimColor>  (v: exact detail, m: mark latest, Esc: back)</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {detail ? (
          <Box flexDirection="column">
            <Text bold>Exact message #{detail.id}</Text>
            <Text>{detail.content}</Text>
          </Box>
        ) : messages.length === 0 ? (
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

      {sendError ? (
        <Box marginTop={1}>
          <Text color="red">{sendError}</Text>
        </Box>
      ) : null}

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
