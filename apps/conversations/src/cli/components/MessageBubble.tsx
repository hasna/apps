import React from "react";
import { Box, Text } from "ink";
import type { MessagePreview } from "../../types.js";

interface MessageBubbleProps {
  message: MessagePreview;
  isOwn: boolean;
  selected?: boolean;
}

export function MessageBubble({ message, isOwn, selected = false }: MessageBubbleProps) {
  const time = message.created_at.slice(11, 19);

  return (
    <Box>
      <Text color={selected ? "yellow" : undefined}>{selected ? "› " : "  "}</Text>
      <Text dimColor>{time} </Text>
      <Text bold color={isOwn ? "cyan" : "green"}>
        {message.from_agent}
      </Text>
      {message.priority !== "normal" && (
        <Text color={message.priority === "urgent" ? "red" : "yellow"}> [{message.priority}]</Text>
      )}
      <Text>: {message.preview}</Text>
      {message.unread && <Text color="yellow"> [unread]</Text>}
    </Box>
  );
}
