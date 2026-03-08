import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listSessions } from "../../lib/sessions.js";
import { listSpaces } from "../../lib/spaces.js";
import { getDb } from "../../lib/db.js";
import type { Session, SpaceInfo } from "../../types.js";

function getSpaceUnreadCount(spaceName: string, agent: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE space = ? AND from_agent != ? AND read_at IS NULL"
  ).get(spaceName, agent) as { count: number };
  return row.count;
}

interface SessionListProps {
  agent: string;
  onSelect: (session: Session) => void;
  onSelectSpace: (spaceName: string) => void;
  onNew: () => void;
}

export function SessionList({ agent, onSelect, onSelectSpace, onNew }: SessionListProps) {
  const [sessions, setSessions] = useState(() => listSessions(agent));
  const [spaces, setSpaces] = useState(() => listSpaces());

  // Poll for new sessions/spaces
  useEffect(() => {
    const timer = setInterval(() => {
      setSessions(listSessions(agent));
      setSpaces(listSpaces());
    }, 1000);
    return () => clearInterval(timer);
  }, [agent]);

  useInput((input) => {
    if (input === "n") onNew();
  });

  // Build hierarchical space tree: top-level spaces at root, children indented below
  const topLevel = spaces.filter((sp) => !sp.parent_id);
  const children = spaces.filter((sp) => sp.parent_id);

  const spaceItems: Array<{ label: string; value: string }> = [];
  for (const sp of topLevel) {
    const unread = getSpaceUnreadCount(sp.name, agent);
    const unreadBadge = unread > 0 ? ` (${unread} unread)` : "";
    spaceItems.push({
      label: `#${sp.name}${sp.description ? ` — ${sp.description}` : ""}  ${sp.message_count} msgs${unreadBadge}`,
      value: `space:${sp.name}`,
    });

    // Add direct children indented
    const directChildren = children.filter((c) => c.parent_id === sp.name);
    for (const child of directChildren) {
      const childUnread = getSpaceUnreadCount(child.name, agent);
      const childBadge = childUnread > 0 ? ` (${childUnread} unread)` : "";
      spaceItems.push({
        label: `  └ #${child.name}${child.description ? ` — ${child.description}` : ""}  ${child.message_count} msgs${childBadge}`,
        value: `space:${child.name}`,
      });

      // Add grandchildren (level 3)
      const grandChildren = children.filter((gc) => gc.parent_id === child.name);
      for (const gc of grandChildren) {
        const gcUnread = getSpaceUnreadCount(gc.name, agent);
        const gcBadge = gcUnread > 0 ? ` (${gcUnread} unread)` : "";
        spaceItems.push({
          label: `    └ #${gc.name}${gc.description ? ` — ${gc.description}` : ""}  ${gc.message_count} msgs${gcBadge}`,
          value: `space:${gc.name}`,
        });
      }
    }
  }

  // Filter out space sessions — they show up as space items instead
  const dmSessions = sessions.filter((s) => !s.session_id.startsWith("space:"));

  const sessionItems = dmSessions.map((s) => {
    const others = s.participants.filter((p) => p !== agent).join(", ") || agent;
    const unread = s.unread_count > 0 ? ` (${s.unread_count} unread)` : "";
    return {
      label: `${others} — ${s.message_count} msgs${unread}`,
      value: s.session_id,
    };
  });

  const allItems = [...spaceItems, ...sessionItems];

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
          if (item.value.startsWith("space:")) {
            onSelectSpace(item.value.slice(6));
          } else {
            const session = dmSessions.find((s) => s.session_id === item.value);
            if (session) onSelect(session);
          }
        }}
      />
    </Box>
  );
}
