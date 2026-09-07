import React, { useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { previewAsCompatibilityMessage } from "../../lib/message-previews.js";
import { getStore } from "../../lib/store/index.js";
import { SensitiveContentError, scanSensitiveContent } from "../../lib/content-safety.js";
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
  | { ok: false; error: string; blocked?: boolean };

function chatViewSendError(blocked: boolean): string {
  if (blocked) {
    return "Message blocked by sensitive-content controls.";
  }
  return "Unable to confirm message send. Check the conversation before retrying.";
}

export async function submitChatViewMessage(
  { agent, sessionId, recipient, channelName }: ChatViewSubmitOptions,
  value: string
): Promise<ChatViewSubmitResult> {
  const content = value.trim();
  if (!content) return { ok: false, error: "" };

  try {
    const store = getStore();
    if (channelName) {
      return {
        ok: true,
        message: await store.sendMessage({
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
      message: await store.sendMessage({
        from: agent,
        to: recipient || agent,
        content,
        session_id: sessionId,
      }),
    };
  } catch (error) {
    const blocked = error instanceof SensitiveContentError || scanSensitiveContent(content).length > 0;
    return { ok: false, error: chatViewSendError(blocked), blocked };
  }
}

export function ChatView({ agent, onBack, sessionId: initialSessionId, recipient, channelName }: ChatViewProps) {
  const store = useMemo(() => { try { return getStore(); } catch { return null; } }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [detail, setDetail] = useState<Message | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(!!initialSessionId || !!channelName);
  const mounted = useRef(true);
  const sendingRef = useRef(false);
  const inputRevision = useRef(0);
  const detailRequest = useRef(0);
  const marking = useRef(false);
  const changeInput = (value: string) => { inputRevision.current++; setInput(value); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; }; }, []);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const sessionIdRef = useRef(initialSessionId);
  const isChannel = !!channelName;
  const seenIds = useRef<Set<number>>(new Set());

  // Load existing messages + poll for new ones
  useEffect(() => {
    let cancelled = false;
    if (!store) { setReadError("Unable to connect to conversations. Check account configuration."); setLoading(false); return; }
    seenIds.current = new Set();
    const opts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : {};

    let historyLoaded = !isChannel && !sessionId;
    let loadRetry: ReturnType<typeof setTimeout> | undefined;
    // Retry initial history separately: a watch cursor intentionally skips old
    // rows and cannot replace a failed history read.
    const loadHistory = () => {
      void store.readMessagePreviews(opts).then((page) => {
        if (cancelled) return;
        const existing = page.messages.map(previewAsCompatibilityMessage);
        for (const msg of existing) seenIds.current.add(msg.id);
        setMessages(current => [...existing, ...current.filter(message => !existing.some(row => row.id === message.id))]);
        historyLoaded = true;
        setReadError(null);
      }).catch(() => {
        if (!cancelled) {
          setReadError("Unable to load messages. Retrying…");
          loadRetry = setTimeout(loadHistory, 1000);
        }
      }).finally(() => { if (!cancelled) setLoading(false); });
    };
    if (isChannel || sessionId) loadHistory();
    else setMessages([]);

    const pollOpts = isChannel
      ? { channel: channelName }
      : sessionId
        ? { session_id: sessionId }
        : null;

    if (!pollOpts) return;

    const { stop } = startPolling({
      ...pollOpts,
      interval_ms: 200,
      store,
      on_poll_error: (line) => {
        if (!cancelled && (!line.includes("RECOVERED") || historyLoaded)) setReadError(line.includes("RECOVERED") ? null : "Unable to refresh messages. Retrying…");
      },
      on_messages: (newMsgs) => {
        if (cancelled) return;
        if (historyLoaded) setReadError(null);
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
      if (loadRetry) clearTimeout(loadRetry);
      void stop();
    };
  }, [store, sessionId, channelName, isChannel]);

  useInput((keyInput, key) => {
    if (key.escape) {
      detailRequest.current++;
      if (detail) setDetail(null);
      else onBack();
      return;
    }
    const selected = messages[messages.length - 1];
    if (!selected || input.length > 0) return;
    if (!store) return;
    if (keyInput === "v") {
      const request = ++detailRequest.current;
      void store.getMessageById(selected.id).then(message => {
        if (!mounted.current || detailRequest.current !== request) return;
        if (!message) { setReadError("Message detail is unavailable."); return; }
        setDetail(message); setReadError(null);
      }).catch(() => { if (mounted.current && detailRequest.current === request) setReadError("Unable to load message detail."); });
    }
    if (keyInput === "m" && !marking.current) {
      marking.current = true;
      void store.markReadByIds([selected.id], agent).then((count) => {
        if (!mounted.current) return;
        if (count !== 1) { setReadError("Read acknowledgement was not confirmed."); return; }
        setReadError(null);
        setMessages((current) => current.map((message) => (
          message.id === selected.id ? { ...message, read_at: new Date().toISOString() } : message
        )));
      }).catch(() => { if (mounted.current) setReadError("Unable to mark message read."); })
        .finally(() => { marking.current = false; });
    }
  });

  const handleSubmit = (value: string) => {
    if (!value.trim() || sendingRef.current) return;
    // The ref closes the same-tick Enter race before React commits state.
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    changeInput("");
    const clearedRevision = inputRevision.current;

    void submitChatViewMessage({ agent, sessionId: sessionIdRef.current, recipient, channelName }, value).then((result) => {
      if (!mounted.current) return;
      if (!result.ok) {
        setSendError(result.error || "Unable to send message.");
        // Keep a newer draft untouched. Never restore content rejected by the
        // sensitive-content guard, and never retry an ambiguous send automatically.
        if (!result.blocked && inputRevision.current === clearedRevision) changeInput(value);
        return;
      }
      const msg = result.message;
      seenIds.current.add(msg.id);
      setMessages((prev) => prev.some(message => message.id === msg.id) ? prev : [...prev, msg]);
      if (!isChannel && !sessionIdRef.current) {
        sessionIdRef.current = msg.session_id;
        setSessionId(msg.session_id);
      }
    }).finally(() => {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    });
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
          <Text dimColor>{loading ? "Loading messages…" : readError ? "Messages unavailable." : "No messages yet. Type below and press Enter."}</Text>
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

      {readError && <Text color="red">{readError}</Text>}
      {sending && <Text dimColor>Sending… You can draft the next message.</Text>}
      {sendError ? (
        <Box marginTop={1}>
          <Text color="red">{sendError}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={isChannel ? "magenta" : "cyan"}>{prompt}: </Text>
        <TextInput
          value={input}
          onChange={changeInput}
          onSubmit={handleSubmit}
          placeholder="Type a message..."
        />
      </Box>
    </Box>
  );
}
