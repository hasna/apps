import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { registerAgent, listAgents, getAgent, heartbeatAgent, setAgentFocus } from "./agents.js"
import { createProject } from "./projects.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("registerAgent", () => {
  test("creates a new agent", () => {
    const agent = registerAgent("test-agent", "A test agent")
    expect(agent.id).toMatch(/^AGT-[a-z0-9]{8}$/)
    expect(agent.name).toBe("test-agent")
    expect(agent.description).toBe("A test agent")
  })

  test("returns existing agent on re-register", () => {
    const a1 = registerAgent("my-agent")
    const a2 = registerAgent("my-agent")
    expect(a1.id).toBe(a2.id)
  })

  test("updates description on re-register", () => {
    registerAgent("my-agent", "old desc")
    const a2 = registerAgent("my-agent", "new desc")
    expect(a2.description).toBe("new desc")
  })

  test("registers agent without description", () => {
    const agent = registerAgent("no-desc-agent")
    expect(agent.description).toBeNull()
  })
})

describe("listAgents", () => {
  test("returns empty list when no agents", () => {
    expect(listAgents()).toHaveLength(0)
  })

  test("returns all registered agents", () => {
    registerAgent("agent-1")
    registerAgent("agent-2")
    expect(listAgents()).toHaveLength(2)
  })
})

describe("getAgent", () => {
  test("returns null for unknown agent", () => {
    expect(getAgent("unknown")).toBeNull()
  })

  test("finds by name", () => {
    registerAgent("my-agent")
    const agent = getAgent("my-agent")
    expect(agent).not.toBeNull()
    expect(agent!.name).toBe("my-agent")
  })

  test("finds by id", () => {
    const created = registerAgent("my-agent")
    const found = getAgent(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })
})

describe("heartbeatAgent", () => {
  test("returns null for unknown agent", () => {
    expect(heartbeatAgent("ghost")).toBeNull()
  })

  test("updates last_seen_at", () => {
    const agent = registerAgent("active-agent")
    const updated = heartbeatAgent(agent.id)
    expect(updated).not.toBeNull()
    expect(updated!.id).toBe(agent.id)
  })
})

describe("setAgentFocus", () => {
  test("returns null for unknown agent", () => {
    expect(setAgentFocus("ghost", null)).toBeNull()
  })

  test("sets active project", () => {
    const agent = registerAgent("focused-agent")
    const project = createProject({ name: "My Project" })
    const updated = setAgentFocus(agent.id, project.id)
    expect(updated).not.toBeNull()
  })

  test("clears active project with null", () => {
    const agent = registerAgent("focused-agent")
    const project = createProject({ name: "My Project" })
    setAgentFocus(agent.id, project.id)
    const cleared = setAgentFocus(agent.id, null)
    expect(cleared).not.toBeNull()
  })
})
