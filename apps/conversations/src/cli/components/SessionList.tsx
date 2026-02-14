import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listSessions } from "../../lib/sessions.js";
import type { Session } from "../../types.js";

interface SessionListProps {
  agent: string;
  onSelect: (session: Session) => void;
  onNew: () => void;
}

export function SessionList({ agent, onSelect, onNew }: SessionListProps) {
  const sessions = listSessions(agent);

  useInput((input) => {
    if (input === "n") onNew();
  });

  const items = sessions.map((s) => {
    const others = s.participants.filter((p) => p !== agent).join(", ") || agent;
    const unread = s.unread_count > 0 ? ` (${s.unread_count} unread)` : "";
    return {
      label: `${others} — ${s.message_count} msgs${unread}`,
      value: s.session_id,
      session: s,
    };
  });

  if (items.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Conversations</Text>
        <Text dimColor>No conversations yet.</Text>
        <Text dimColor>Press <Text bold>n</Text> to start a new conversation.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Conversations</Text>
        <Text dimColor>  (n: new, q: quit)</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => {
          const session = sessions.find((s) => s.session_id === item.value);
          if (session) onSelect(session);
        }}
      />
    </Box>
  );
}
