// Fleet-standard agent coordination primitives (register_agent, heartbeat,
// set_focus, send_feedback). These are process-local (in-memory) coordination
// helpers with identical semantics across the fleet; they do NOT authenticate a
// caller — naming an agent is not authorization.

export interface AgentRecord {
  agent_id: string;
  name: string;
  registered_at: string;
  last_heartbeat_at: string | null;
  focus: string | null;
}

const agents = new Map<string, AgentRecord>();
const feedback: Array<{ agent_id: string; message: string; sentiment: string; at: string }> = [];

export function registerAgent(name: string): AgentRecord {
  const now = new Date().toISOString();
  const existing = agents.get(name);
  if (existing) {
    existing.last_heartbeat_at = now;
    return existing;
  }
  const record: AgentRecord = {
    agent_id: name,
    name,
    registered_at: now,
    last_heartbeat_at: now,
    focus: null,
  };
  agents.set(name, record);
  return record;
}

export function heartbeat(name: string): { agent_id: string; last_heartbeat_at: string } {
  const record = registerAgent(name);
  record.last_heartbeat_at = new Date().toISOString();
  return { agent_id: record.agent_id, last_heartbeat_at: record.last_heartbeat_at };
}

export function setFocus(name: string, focus: string): AgentRecord {
  const record = registerAgent(name);
  record.focus = focus;
  return record;
}

export function sendFeedback(name: string, message: string, sentiment = "neutral"): { ok: true; recorded_at: string } {
  const at = new Date().toISOString();
  feedback.push({ agent_id: name, message, sentiment, at });
  return { ok: true, recorded_at: at };
}

export function listFeedback(): ReadonlyArray<{ agent_id: string; message: string; sentiment: string; at: string }> {
  return feedback;
}
