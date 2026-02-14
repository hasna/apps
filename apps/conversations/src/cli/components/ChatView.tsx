import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useMessages } from "../../lib/poll.js";
import { sendMessage, markSessionRead } from "../../lib/messages.js";
import { MessageBubble } from "./MessageBubble.js";

interface ChatViewProps {
  sessionId: string;
  agent: string;
  participants: string[];
  onBack: () => void;
}

export function ChatView({ sessionId, agent, participants, onBack }: ChatViewProps) {
  const messages = useMessages(sessionId, agent);
  const [input, setInput] = useState("");

  const others = participants.filter((p) => p !== agent);
  const recipient = others[0] || agent;

  // Mark messages as read when viewing
  React.useEffect(() => {
    markSessionRead(sessionId, agent);
  }, [messages.length, sessionId, agent]);

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;

    sendMessage({
      from: agent,
      to: recipient,
      content: value.trim(),
      session_id: sessionId,
    });

    setInput("");
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={1}>
        <Text bold color="cyan">Chat: {others.join(", ") || "self"}</Text>
        <Text dimColor>(Esc: back)</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 ? (
          <Text dimColor>No messages yet. Start typing below.</Text>
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
        <Text color="cyan">{agent} → {recipient}: </Text>
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
