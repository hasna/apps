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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve current credentials for each refresh, without tying the effect
  // lifecycle to a newly constructed client on every render.
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || cancelled) return;
      refreshing = true;
      try {
        const store = getStore();
        const results = await Promise.allSettled([
          store.listSessions(agent),
          store.listChannels(),
          store.listUnreadCounts(agent),
        ]);
        if (cancelled) return;
        // A fast failure must not release the refresh gate while sibling
        // requests are still running.
        const [sessionResult, channelResult, unreadResult] = results;
        if (sessionResult.status === "rejected") throw sessionResult.reason;
        if (channelResult.status === "rejected") throw channelResult.reason;
        if (unreadResult.status === "rejected") throw unreadResult.reason;
        const sessionList = sessionResult.value;
        const channelList = channelResult.value;
        const unreadRows = unreadResult.value;
        setSessions(sessionList);
        setChannels(channelList);
        const byChannel: Record<string, number> = {};
        for (const row of unreadRows) {
          if (!row.channel) continue;
          byChannel[row.channel] = Number(row.unread_count) || 0;
        }
        setChannelUnread(byChannel);
        setError(null);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Unable to load conversations.");
      } finally {
        refreshing = false;
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agent]);

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

  if (error && allItems.length === 0) {
    return <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Conversations</Text>
      <Text color="red">Unable to load conversations: {error}</Text>
      <Text dimColor>Retrying… Press q to quit.</Text>
    </Box>;
  }

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
      {error && <Text color="red">Refresh failed: {error} — retrying…</Text>}
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
