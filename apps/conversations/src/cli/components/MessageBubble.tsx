import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../../types.js";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const time = message.created_at.slice(11, 19);

  return (
    <Box>
      <Text dimColor>{time} </Text>
      <Text bold color={isOwn ? "cyan" : "green"}>
        {message.from_agent}
      </Text>
      {message.priority !== "normal" && (
        <Text color={message.priority === "urgent" ? "red" : "yellow"}> [{message.priority}]</Text>
      )}
      <Text>: {message.content}</Text>
    </Box>
  );
}
