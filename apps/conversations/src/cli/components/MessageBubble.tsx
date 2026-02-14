import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../../types.js";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: "red",
  high: "yellow",
  normal: "",
  low: "dim",
};

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const time = message.created_at.slice(11, 19);
  const color = priorityColors[message.priority] || "";

  return (
    <Box
      flexDirection="column"
      alignItems={isOwn ? "flex-end" : "flex-start"}
      marginBottom={0}
    >
      <Box gap={1}>
        <Text dimColor>{time}</Text>
        <Text bold color={isOwn ? "cyan" : "green"}>
          {message.from_agent}
        </Text>
        {message.priority !== "normal" && (
          <Text color={color as any}>[{message.priority}]</Text>
        )}
        {!message.read_at && !isOwn && <Text color="green">*</Text>}
      </Box>
      <Box marginLeft={isOwn ? 2 : 0} marginRight={isOwn ? 0 : 2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  );
}
