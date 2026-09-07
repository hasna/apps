import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { getStore } from "../../lib/store/index.js";
import type { Session, ChannelInfo } from "../../types.js";

interface SessionListProps {
  agent: string;
  onSelect: (session: Session) => void;
  onSelectChannel: (channelName: string) => void;
  onNew: () => void;
}

export function SessionList({ agent, onSelect, onSelectChannel, onNew }: SessionListProps) {
  const store = getStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // The TUI is Store-backed like every other surface: whichever store the
  // resolver selected (hosted API or the on-box SQLite store) answers these
  // lists, so the same UI works in either transport.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [sessionList, channelList, unreadRows] = await Promise.all([
          store.listSessions(agent),
          store.listChannels(),
          store.listUnreadCounts(agent),
        ]);
        if (cancelled) return;
        setSessions(sessionList);
        setChannels(channelList);
        const byChannel: Record<string, number> = {};
        for (const row of unreadRows) {
          if (!row.channel) continue;
          byChannel[row.channel] = Number(row.unread_count) || 0;
        }
        setChannelUnread(byChannel);
      } catch (error) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) setLoading(false);
    };
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [store, agent]);

  useInput((input) => {
    if (input === "n") onNew();
  });

  const channelItems = channels.map((sp) => {
    const unread = channelUnread[sp.name] ?? 0;
    const unreadBadge = unread > 0 ? ` (${unread} unread)` : "";
    return {
      label: `#${sp.name}${sp.description ? ` — ${sp.description}` : ""}  ${sp.message_count} msgs${unreadBadge}`,
      value: `channel:${sp.name}`,
    };
  });

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

  if (loading && allItems.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Conversations</Text>
        <Text dimColor>  as <Text color="yellow">{agent}</Text></Text>
        <Box marginTop={1}>
          <Text dimColor>Loading…</Text>
        </Box>
      </Box>
    );
  }

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
            onSelectChannel(item.value.slice(6));
          } else {
            const session = dmSessions.find((s) => s.session_id === item.value);
            if (session) onSelect(session);
          }
        }}
      />
    </Box>
  );
}