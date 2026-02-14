import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { SessionList } from "./SessionList.js";
import { ChatView } from "./ChatView.js";
import type { Session } from "../../types.js";

type View = "sessions" | "chat" | "new";

interface AppProps {
  agent: string;
}

export function App({ agent }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("sessions");
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [newTo, setNewTo] = useState("");

  useInput((input, key) => {
    if (input === "q" && view === "sessions") {
      exit();
    }
  });

  const handleSelectSession = (session: Session) => {
    setCurrentSession(session);
    setView("chat");
  };

  const handleNewConversation = () => {
    setView("new");
  };

  const handleStartNew = (to: string) => {
    if (!to.trim()) return;
    // Create a temporary session object — real session will be created on first message
    const tempSession: Session = {
      session_id: `${[agent, to.trim()].sort().join("-")}-new`,
      participants: [agent, to.trim()],
      last_message_at: new Date().toISOString(),
      message_count: 0,
      unread_count: 0,
    };
    setCurrentSession(tempSession);
    setNewTo("");
    setView("chat");
  };

  const handleBack = () => {
    setCurrentSession(null);
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
        <Text dimColor>Press Enter to start, Esc to cancel</Text>
      </Box>
    );
  }

  if (view === "chat" && currentSession) {
    return (
      <ChatView
        sessionId={currentSession.session_id}
        agent={agent}
        participants={currentSession.participants}
        onBack={handleBack}
      />
    );
  }

  return (
    <SessionList
      agent={agent}
      onSelect={handleSelectSession}
      onNew={handleNewConversation}
    />
  );
}
