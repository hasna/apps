import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { SessionList } from "./SessionList.js";
import { ChatView } from "./ChatView.js";
import type { Session } from "../../types.js";

type View = "sessions" | "chat" | "channel" | "new";

interface AppProps {
  agent: string;
}

export function App({ agent }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("sessions");
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [currentChannel, setCurrentChannel] = useState<string | null>(null);
  const [newTo, setNewTo] = useState("");

  useInput((input, key) => {
    if (input === "q" && view === "sessions") {
      exit();
    }
    if (key.escape && view === "new") {
      setNewTo("");
      setView("sessions");
    }
  });

  const handleSelectSession = (session: Session) => {
    setCurrentSession(session);
    setView("chat");
  };

  const handleSelectChannel = (channelName: string) => {
    setCurrentChannel(channelName);
    setView("channel");
  };

  const handleNewConversation = () => {
    setView("new");
  };

  const handleStartNew = (to: string) => {
    if (!to.trim()) return;
    setCurrentSession({
      session_id: "",
      participants: [agent, to.trim()],
      last_message_at: "",
      message_count: 0,
      unread_count: 0,
    });
    setNewTo("");
    setView("chat");
  };

  const handleBack = () => {
    setCurrentSession(null);
    setCurrentChannel(null);
    setView("sessions");
  };

  if (view === "new") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">New Conversation</Text>
        <Box marginTop={1}>
          <Text>Send to agent: </Text>
          <TextInput
            value={newTo}
            onChange={setNewTo}
            onSubmit={handleStartNew}
            placeholder="agent-id"
          />
        </Box>
        <Text dimColor>Enter to start, Esc to cancel</Text>
      </Box>
    );
  }

  if (view === "channel" && currentChannel) {
    return (
      <ChatView
        agent={agent}
        channelName={currentChannel}
        onBack={handleBack}
      />
    );
  }

  if (view === "chat" && currentSession) {
    const others = currentSession.participants.filter((p) => p !== agent);
    return (
      <ChatView
        agent={agent}
        sessionId={currentSession.session_id || undefined}
        recipient={others[0] || agent}
        onBack={handleBack}
      />
    );
  }

  return (
    <SessionList
      agent={agent}
      onSelect={handleSelectSession}
      onSelectChannel={handleSelectChannel}
      onNew={handleNewConversation}
    />
  );
}
