import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listSessions } from "../../lib/sessions.js";
import { listChannels } from "../../lib/channels.js";
import type { Session } from "../../types.js";

interface SessionListProps {
  agent: string;
  onSelect: (session: Session) => void;
  onSelectChannel: (channelName: string) => void;
  onNew: () => void;
}

export function SessionList({ agent, onSelect, onSelectChannel, onNew }: SessionListProps) {
  const [sessions, setSessions] = useState(() => listSessions(agent));
  const [channels, setChannels] = useState(() => listChannels());

  // Poll for new sessions/channels
  useEffect(() => {
    const timer = setInterval(() => {
      setSessions(listSessions(agent));
      setChannels(listChannels());
    }, 1000);
    return () => clearInterval(timer);
  }, [agent]);

  useInput((input) => {
    if (input === "n") onNew();
  });

  const channelItems = channels.map((ch) => ({
    label: `#${ch.name}${ch.description ? ` — ${ch.description}` : ""}  (${ch.message_count} msgs, ${ch.member_count} members)`,
    value: `channel:${ch.name}`,
  }));

  // Filter out channel sessions — they show up as channel items instead
  const dmSessions = sessions.filter((s) => !s.session_id.startsWith("channel:"));

  const sessionItems = dmSessions.map((s) => {
    const others = s.participants.filter((p) => p !== agent).join(", ") || agent;
    const unread = s.unread_count > 0 ? ` (${s.unread_count} unread)` : "";
    return {
      label: `${others} — ${s.message_count} msgs${unread}`,
      value: s.session_id,
    };
  });

  const allItems = [...channelItems, ...sessionItems];

  if (allItems.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Conversations</Text>
        <Text dimColor>  as <Text color="yellow">{agent}</Text></Text>
        <Box marginTop={1}>
          <Text dimColor>No conversations yet. Press </Text>
          <Text bold>n</Text>
          <Text dimColor> to start one, or </Text>
          <Text bold>q</Text>
          <Text dimColor> to quit.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">Conversations</Text>
        <Text dimColor>  as <Text color="yellow">{agent}</Text>  (n: new, q: quit)</Text>
      </Box>
      <SelectInput
        items={allItems}
        onSelect={(item) => {
          if (item.value.startsWith("channel:")) {
            onSelectChannel(item.value.slice(8));
          } else {
            const session = dmSessions.find((s) => s.session_id === item.value);
            if (session) onSelect(session);
          }
        }}
      />
    </Box>
  );
}
